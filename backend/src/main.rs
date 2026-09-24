mod fingrid_client;
mod influx;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use fingrid_client::{FingridClient, Dataset};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use chrono::{DateTime, Utc, Duration as ChronoDuration};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// App State
// ---------------------------------------------------------------------------

struct AppState {
    api_key:          Option<String>,
    datasets_cache:   Option<Vec<Dataset>>,
    /// Last sync that wrote to InfluxDB.
    influx_last_sync: Option<DateTime<Utc>>,
    /// Last sync started, successful or not — the schedule runs from this, so
    /// a failing sync waits out the interval instead of retrying every tick.
    influx_last_attempt: Option<DateTime<Utc>>,
    influx_error:     Option<String>,
}

/// Held for the whole of a sync, so a manual sync and the background one
/// never query Fingrid at the same time and break its rate limit.
static SYNC_LOCK: Mutex<()> = Mutex::const_new(());

// ---------------------------------------------------------------------------
// Request / Response structures
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct LoginRequest {
    #[serde(rename = "apiKey")]
    api_key: String,
}

#[derive(Serialize)]
struct StatusResponse {
    logged_in: bool,
    api_key:   Option<String>,
}

#[derive(Serialize)]
struct InfluxStatusResponse {
    enabled:       bool,
    last_sync:     Option<chrono::DateTime<Utc>>,
    next_sync:     Option<chrono::DateTime<Utc>>,
    error:         Option<String>,
}

#[derive(Serialize)]
struct InfluxSyncResponse {
    ok:      bool,
    points:  usize,
    message: String,
}

#[derive(Deserialize)]
struct DataQuery {
    #[serde(rename = "startTime")]
    start_time: String,
    #[serde(rename = "endTime")]
    end_time: String,
}

// ---------------------------------------------------------------------------
// Persistence helper functions
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct SavedCredentials {
    api_key: String,
}

fn credentials_path() -> PathBuf { PathBuf::from("credentials.json") }

fn save_credentials(api_key: &str) {
    let creds = SavedCredentials { api_key: api_key.to_string() };
    if let Ok(json) = serde_json::to_string_pretty(&creds) {
        if let Err(e) = std::fs::write(credentials_path(), json) {
            tracing::warn!("Could not save credentials: {}", e);
        } else {
            tracing::info!("Credentials saved to {}", credentials_path().display());
        }
    }
}

fn load_credentials() -> Option<SavedCredentials> {
    let data = std::fs::read_to_string(credentials_path()).ok()?;
    serde_json::from_str(&data).ok()
}

fn active_datasets_path() -> PathBuf { PathBuf::from("active_datasets.json") }

fn save_active_datasets(ids: &[i32]) {
    if let Ok(json) = serde_json::to_string_pretty(&ids) {
        if let Err(e) = std::fs::write(active_datasets_path(), json) {
            tracing::warn!("Could not save active datasets: {}", e);
        }
    }
}

fn load_active_datasets() -> Vec<i32> {
    let data = std::fs::read_to_string(active_datasets_path()).ok().unwrap_or_else(|| "[]".to_string());
    serde_json::from_str(&data).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Main Entrypoint
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let mut api_key = None;
    let mut datasets_cache = None;

    // Load API key from file on startup. Only a key Fingrid actually rejects is
    // dropped: after a reboot the network or Fingrid may not be up yet, and
    // treating that as a bad key would stop the collector until someone
    // logged in again.
    if let Some(creds) = load_credentials() {
        tracing::info!("Found saved Fingrid API Key, validating...");
        if let Ok(client) = FingridClient::new(&creds.api_key) {
            match client.verify_api_key().await {
                Ok(true) => {
                    tracing::info!("API Key successfully validated");
                    api_key = Some(creds.api_key.clone());
                    // Pre-fetch dataset catalog to cache
                    match client.get_datasets().await {
                        Ok(list) => {
                            tracing::info!("Pre-fetched {} Fingrid datasets to cache", list.len());
                            datasets_cache = Some(list);
                        }
                        Err(e) => tracing::warn!("Failed to pre-fetch datasets: {}", e),
                    }
                }
                Ok(false) => tracing::warn!("Saved API Key was rejected by Fingrid"),
                Err(e) => {
                    tracing::warn!("Could not validate saved API Key, keeping it: {}", e);
                    api_key = Some(creds.api_key.clone());
                }
            }
        }
    }

    let shared_state = Arc::new(Mutex::new(AppState {
        api_key,
        datasets_cache,
        influx_last_sync:    None,
        influx_last_attempt: None,
        influx_error:        None,
    }));

    // ── Background Sync Loop ──────────────────────────────────────────────────
    {
        let s = Arc::clone(&shared_state);
        tokio::spawn(async move {
            let tick = tokio::time::Duration::from_secs(30);
            loop {
                tokio::time::sleep(tick).await;

                let cfg = influx::load_config();
                if !cfg.enabled { continue; }

                let should_sync = {
                    let st = s.lock().await;
                    sync_due(st.influx_last_attempt, cfg.interval_minutes, Utc::now())
                };

                if !should_sync { continue; }

                tracing::info!("Background Collector: Starting Fingrid sync...");
                match run_sync_all_datasets(&s, &cfg).await {
                    Ok(pts) => tracing::info!("Background Collector: Wrote {} points to InfluxDB", pts),
                    Err(e)  => tracing::error!("Background Collector Error: {}", e),
                }
            }
        });
    }

    let app = Router::new()
        .route("/api/login",            post(login_handler))
        .route("/api/status",           get(status_handler))
        .route("/api/version",          get(version_handler))
        .route("/api/datasets",         get(datasets_handler))
        .route("/api/datasets/active",  get(get_active_handler).post(post_active_handler))
        .route("/api/datasets/{id}/data", get(dataset_data_handler))
        .route("/api/influx/config",    get(get_influx_config_handler).post(post_influx_config_handler))
        .route("/api/influx/status",    get(get_influx_status_handler))
        .route("/api/influx/test",      post(influx_test_handler))
        .route("/api/influx/sync",      post(influx_sync_handler))
        // No CORS layer: the UI is served from this same origin (and the Vite
        // dev server proxies /api). A permissive one let any web page the user
        // opened read /api/status and /api/influx/config, keys included.
        .fallback_service(tower_http::services::ServeDir::new("dist"))
        .with_state(shared_state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

// ---------------------------------------------------------------------------
// Sync Logic (Fingrid to InfluxDB)
// ---------------------------------------------------------------------------

/// Whether the background collector should start a sync now.
fn sync_due(last_attempt: Option<DateTime<Utc>>, interval_minutes: u64, now: DateTime<Utc>) -> bool {
    last_attempt.is_none_or(|t| now - t >= ChronoDuration::minutes(interval_minutes.max(1) as i64))
}

/// How far back each sync queries. Two hours catches Fingrid's late-reported
/// values; a longer interval widens it so consecutive windows still overlap
/// rather than leaving a gap between syncs.
fn sync_window(interval_minutes: u64) -> ChronoDuration {
    ChronoDuration::hours(2).max(ChronoDuration::minutes(interval_minutes as i64 + 60))
}

/// Runs one sync and records its outcome for `/api/influx/status`. Both the
/// background loop and the manual "Sync now" go through here.
async fn run_sync_all_datasets(
    state: &Arc<Mutex<AppState>>,
    cfg:   &influx::InfluxConfig,
) -> anyhow::Result<usize> {
    let _running = SYNC_LOCK.lock().await;
    state.lock().await.influx_last_attempt = Some(Utc::now());

    let result = sync_all_datasets(state, cfg).await;

    let mut st = state.lock().await;
    match &result {
        Ok(_) => {
            st.influx_last_sync = Some(Utc::now());
            st.influx_error     = None;
        }
        Err(e) => st.influx_error = Some(e.to_string()),
    }
    result
}

/// The dataset catalog, fetched from Fingrid on first use and cached. The
/// state lock is not held across the request, so a slow Fingrid does not
/// stall every other route.
async fn cached_datasets(state: &Arc<Mutex<AppState>>, api_key: &str) -> anyhow::Result<Vec<Dataset>> {
    if let Some(list) = state.lock().await.datasets_cache.clone() {
        return Ok(list);
    }
    let list = FingridClient::new(api_key)?.get_datasets().await?;
    state.lock().await.datasets_cache = Some(list.clone());
    Ok(list)
}

async fn sync_all_datasets(
    state: &Arc<Mutex<AppState>>,
    cfg:   &influx::InfluxConfig,
) -> anyhow::Result<usize> {
    let api_key = state.lock().await.api_key.clone()
        .ok_or_else(|| anyhow::anyhow!("Fingrid API Key not configured"))?;

    let active_ids = load_active_datasets();
    if active_ids.is_empty() {
        tracing::info!("No active datasets configured for sync. Skipping.");
        return Ok(0);
    }

    // Load datasets list (needed to get the unit and English name for line protocol tags)
    let datasets = cached_datasets(state, &api_key).await?;

    let client = FingridClient::new(&api_key)?;

    let stop_time = Utc::now();
    let start_time = stop_time - sync_window(cfg.interval_minutes);

    let stop_str = stop_time.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let start_str = start_time.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let mut total_points_written = 0;
    let mut accumulated_lines = String::new();

    for (index, id) in active_ids.iter().enumerate() {
        // Find dataset metadata
        let d = match datasets.iter().find(|x| x.id == *id) {
            Some(metadata) => metadata,
            None => {
                tracing::warn!("Dataset ID {} not found in catalog. Skipping.", id);
                continue;
            }
        };

        // Sleep to respect the 1 call per 2 seconds rate limit (except for the first call)
        if index > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(2100)).await;
        }

        tracing::info!("Syncing dataset ID {} ({})...", id, d.nameEn);
        match client.get_dataset_data(*id, &start_str, &stop_str).await {
            Ok(points) => {
                if !points.is_empty() {
                    let name = &d.nameEn;
                    let unit = d.unitEn.as_deref().unwrap_or("Value");
                    let lines = influx::to_line_protocol(*id, name, unit, &points);
                    if !lines.is_empty() {
                        if !accumulated_lines.is_empty() { accumulated_lines.push('\n'); }
                        accumulated_lines.push_str(&lines);
                    }
                }
            }
            Err(e) => {
                tracing::warn!("Failed to query dataset ID {}: {}", id, e);
            }
        }
    }

    if !accumulated_lines.is_empty() {
        total_points_written = influx::write_points(cfg, &accumulated_lines).await?;
    }

    Ok(total_points_written)
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct VersionResponse {
    version: &'static str,
}

async fn version_handler() -> Json<VersionResponse> {
    let version = option_env!("VERSION").unwrap_or(env!("CARGO_PKG_VERSION"));
    Json(VersionResponse { version })
}

async fn status_handler(
    State(state): State<Arc<Mutex<AppState>>>,
) -> Json<StatusResponse> {
    let state = state.lock().await;
    Json(StatusResponse {
        logged_in: state.api_key.is_some(),
        api_key:   state.api_key.clone(),
    })
}

async fn login_handler(
    State(state): State<Arc<Mutex<AppState>>>,
    Json(payload): Json<LoginRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!("Validating new Fingrid API Key...");
    let client = FingridClient::new(&payload.api_key)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    // Verify key by making a request to Fingrid
    match client.verify_api_key().await {
        Ok(true) => {}
        Ok(false) => return Err((StatusCode::UNAUTHORIZED, "Fingrid rejected the API key".to_string())),
        Err(e) => return Err((StatusCode::BAD_GATEWAY, e.to_string())),
    }

    // Try to retrieve and cache the full datasets list
    let datasets = match client.get_datasets().await {
        Ok(list) => Some(list),
        Err(e) => {
            tracing::warn!("Could not fetch datasets list during login: {}", e);
            None
        }
    };

    let mut state = state.lock().await;
    state.api_key = Some(payload.api_key.clone());
    if datasets.is_some() {
        state.datasets_cache = datasets;
    }
    
    save_credentials(&payload.api_key);
    tracing::info!("Fingrid API Key saved successfully");
    Ok(StatusCode::OK)
}

async fn datasets_handler(
    State(state): State<Arc<Mutex<AppState>>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let api_key = logged_in_key(&state).await?;
    match cached_datasets(&state, &api_key).await {
        Ok(list) => Ok(Json(serde_json::json!({ "data": list }))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// The saved API key, or 401 for the routes that need one. Cloned out so the
/// state lock is released before any Fingrid request.
async fn logged_in_key(state: &Arc<Mutex<AppState>>) -> Result<String, (StatusCode, String)> {
    state.lock().await.api_key.clone()
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Not logged in".to_string()))
}

async fn get_active_handler() -> Json<Vec<i32>> {
    Json(load_active_datasets())
}

async fn post_active_handler(
    Json(ids): Json<Vec<i32>>,
) -> StatusCode {
    save_active_datasets(&ids);
    StatusCode::OK
}

async fn dataset_data_handler(
    State(state): State<Arc<Mutex<AppState>>>,
    Path(id): Path<i32>,
    Query(params): Query<DataQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let api_key = logged_in_key(&state).await?;
    let client = FingridClient::new(&api_key)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match client.get_dataset_data(id, &params.start_time, &params.end_time).await {
        Ok(points) => Ok(Json(serde_json::json!({ "data": points }))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

// ── InfluxDB Route Handlers ────────────────────────────────────────────────

async fn get_influx_config_handler() -> Json<influx::InfluxConfig> {
    Json(influx::load_config())
}

async fn post_influx_config_handler(
    Json(new_cfg): Json<influx::InfluxConfig>,
) -> Result<StatusCode, (StatusCode, String)> {
    influx::save_config(&new_cfg)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tracing::info!("InfluxDB config saved (enabled={})", new_cfg.enabled);
    Ok(StatusCode::OK)
}

async fn get_influx_status_handler(
    State(state): State<Arc<Mutex<AppState>>>,
) -> Json<InfluxStatusResponse> {
    let state = state.lock().await;
    let cfg   = influx::load_config();
    let next  = state.influx_last_attempt.map(|t| {
        t + ChronoDuration::minutes(cfg.interval_minutes.max(1) as i64)
    });
    Json(InfluxStatusResponse {
        enabled:   cfg.enabled,
        last_sync: state.influx_last_sync,
        next_sync: next,
        error:     state.influx_error.clone(),
    })
}

async fn influx_test_handler(
    Json(cfg): Json<influx::InfluxConfig>,
) -> Json<serde_json::Value> {
    match influx::test_connection(&cfg).await {
        Ok(msg) => Json(serde_json::json!({ "ok": true,  "message": msg })),
        Err(e)  => Json(serde_json::json!({ "ok": false, "message": e.to_string() })),
    }
}

async fn influx_sync_handler(
    State(state): State<Arc<Mutex<AppState>>>,
) -> Json<InfluxSyncResponse> {
    let cfg = influx::load_config();
    if cfg.token.is_empty() || cfg.url.is_empty() {
        return Json(InfluxSyncResponse {
            ok: false, points: 0,
            message: "InfluxDB not configured — fill in URL, token, org and bucket first".into(),
        });
    }

    match run_sync_all_datasets(&state, &cfg).await {
        Ok(pts) => Json(InfluxSyncResponse {
            ok: true,
            points: pts,
            message: format!("Manual sync completed. Wrote {} data points", pts)
        }),
        Err(e) => Json(InfluxSyncResponse { ok: false, points: 0, message: e.to_string() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(minute: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(1_781_391_600 + minute * 60, 0).unwrap()
    }

    #[test]
    fn first_sync_is_due_immediately() {
        assert!(sync_due(None, 15, at(0)));
    }

    #[test]
    fn sync_waits_for_the_interval_after_any_attempt() {
        assert!(!sync_due(Some(at(0)), 15, at(14)));
        assert!(sync_due(Some(at(0)), 15, at(15)));
    }

    #[test]
    fn zero_interval_is_treated_as_one_minute() {
        assert!(!sync_due(Some(at(0)), 0, at(0)));
        assert!(sync_due(Some(at(0)), 0, at(1)));
    }

    #[test]
    fn sync_window_overlaps_consecutive_syncs() {
        assert_eq!(sync_window(15), ChronoDuration::hours(2));
        assert_eq!(sync_window(180), ChronoDuration::hours(4));
        for interval in [1, 15, 60, 120, 240, 1440] {
            assert!(sync_window(interval) > ChronoDuration::minutes(interval as i64));
        }
    }
}
