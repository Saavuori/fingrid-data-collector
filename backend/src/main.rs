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
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use chrono::{Utc, Duration as ChronoDuration};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// App State
// ---------------------------------------------------------------------------

struct AppState {
    api_key:          Option<String>,
    datasets_cache:   Option<Vec<Dataset>>,
    influx_last_sync: Option<chrono::DateTime<Utc>>,
    influx_error:     Option<String>,
}

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

    // Load API key from file on startup
    if let Some(creds) = load_credentials() {
        tracing::info!("Found saved Fingrid API Key, validating...");
        if let Ok(client) = FingridClient::new(&creds.api_key) {
            match client.verify_api_key().await {
                Ok(()) => {
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
                Err(e) => tracing::warn!("Saved API Key is invalid: {}", e),
            }
        }
    }

    let shared_state = Arc::new(Mutex::new(AppState {
        api_key,
        datasets_cache,
        influx_last_sync: None,
        influx_error:     None,
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

                // Determine if it is time to sync
                let should_sync = {
                    let st = s.lock().await;
                    st.influx_last_sync
                        .map(|t| Utc::now() - t > ChronoDuration::minutes(cfg.interval_minutes as i64))
                        .unwrap_or(true)
                };

                if !should_sync { continue; }

                tracing::info!("Background Collector: Starting Fingrid sync...");
                let result = run_sync_all_datasets(&s, &cfg).await;
                let mut st = s.lock().await;
                match result {
                    Ok(pts) => {
                        st.influx_last_sync = Some(Utc::now());
                        st.influx_error     = None;
                        tracing::info!("Background Collector: Wrote {} points to InfluxDB", pts);
                    }
                    Err(e) => {
                        st.influx_error = Some(e.to_string());
                        tracing::error!("Background Collector Error: {}", e);
                    }
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
        .route("/api/datasets/:id/data",get(dataset_data_handler))
        .route("/api/influx/config",    get(get_influx_config_handler).post(post_influx_config_handler))
        .route("/api/influx/status",    get(get_influx_status_handler))
        .route("/api/influx/test",      post(influx_test_handler))
        .route("/api/influx/sync",      post(influx_sync_handler))
        .fallback_service(tower_http::services::ServeDir::new("dist"))
        .layer(CorsLayer::permissive())
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

async fn run_sync_all_datasets(
    state: &Arc<Mutex<AppState>>,
    cfg:   &influx::InfluxConfig,
) -> anyhow::Result<usize> {
    let api_key = {
        let st = state.lock().await;
        st.api_key.clone().ok_or_else(|| anyhow::anyhow!("Fingrid API Key not configured"))?
    };

    let active_ids = load_active_datasets();
    if active_ids.is_empty() {
        tracing::info!("No active datasets configured for sync. Skipping.");
        return Ok(0);
    }

    // Load datasets list (needed to get the unit and English name for line protocol tags)
    let datasets = {
        let mut st = state.lock().await;
        if let Some(ref list) = st.datasets_cache {
            list.clone()
        } else {
            // If cache is empty, fetch it now
            let client = FingridClient::new(&api_key)?;
            let list = client.get_datasets().await?;
            st.datasets_cache = Some(list.clone());
            list
        }
    };

    let client = FingridClient::new(&api_key)?;
    
    // Set query window: last 2 hours to avoid missing delayed reporting data
    let stop_time = Utc::now();
    let start_time = stop_time - ChronoDuration::hours(2);

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
    client.verify_api_key().await
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;

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
    let mut state = state.lock().await;
    let api_key = state.api_key.clone()
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Not logged in".to_string()))?;

    if let Some(ref list) = state.datasets_cache {
        return Ok(Json(serde_json::json!({ "data": list })));
    }

    // If cache is empty, fetch catalog from Fingrid
    let client = FingridClient::new(&api_key)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match client.get_datasets().await {
        Ok(list) => {
            state.datasets_cache = Some(list.clone());
            Ok(Json(serde_json::json!({ "data": list })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
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
    let state = state.lock().await;
    let api_key = state.api_key.clone()
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Not logged in".to_string()))?;

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
    let next  = state.influx_last_sync.map(|t| {
        t + ChronoDuration::minutes(cfg.interval_minutes as i64)
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
        Ok(pts) => {
            let mut st = state.lock().await;
            st.influx_last_sync = Some(Utc::now());
            st.influx_error     = None;
            Json(InfluxSyncResponse {
                ok: true,
                points: pts,
                message: format!("Manual sync completed. Wrote {} data points", pts)
            })
        }
        Err(e) => {
            let mut st = state.lock().await;
            st.influx_error = Some(e.to_string());
            Json(InfluxSyncResponse { ok: false, points: 0, message: e.to_string() })
        }
    }
}
