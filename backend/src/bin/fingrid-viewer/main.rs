//! fingrid-viewer — a public, read-only dashboard over Fingrid open data.
//!
//! Unlike the collector there is no login and nothing is written anywhere:
//! the API key comes from the environment, and visitors are served from a
//! shared cache (cache.rs) so their numbers never touch Fingrid's rate limit.
//!
//! Environment:
//!   FINGRID_API_KEY        the key (or FINGRID_API_KEY_FILE, a file holding it)
//!   PORT                   listen port, default 3000
//!   DIST_DIR               the built frontend, default ./dist
//!   FINGRID_DAILY_LIMIT    upstream calls allowed per UTC day, default 8000
//!   FINGRID_DAILY_RESERVE  of those, kept for refreshing the front page and
//!                          catalog — visitors can never spend them. Default 1500
//!   FINGRID_API_BASE       API root, default https://data.fingrid.fi/api

mod cache;
mod series;

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use cache::{Cache, CacheError, Entry};
use chrono::{Duration as ChronoDuration, Utc};
use fingrid_collector::fingrid_client::{FingridClient, Priority, Throttle};
use serde::Deserialize;
use series::Range;
use std::collections::HashSet;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tower_http::compression::CompressionLayer;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Everything the "Grid now" page draws, fetched together in one call.
/// Keep in step with frontend/src/viewer/datasets.ts.
const DASHBOARD_IDS: &[i32] = &[
    // Balance
    193, 192, 194, 166, 241,
    // Production by type (248 is Fingrid's solar estimate, as on fingrid.fi)
    181, 188, 191, 201, 202, 205, 183, 248, 398, 399,
    // Cross-border transmission: SE1, SE3, Norway, Estonia, Russia
    87, 89, 187, 180, 195,
    // System state, frequency, emissions, shortage status
    209, 177, 265, 266, 336,
];

/// Dashboard refresh. Fingrid publishes real-time values every three minutes.
const DASHBOARD_TTL: Duration = Duration::from_secs(150);
const CATALOG_TTL: Duration = Duration::from_secs(12 * 3600);

/// The background refresher's pace, and its slowest pace while fetches fail.
const REFRESH_EVERY: Duration = Duration::from_secs(30);
const REFRESH_BACKOFF_MAX: Duration = Duration::from_secs(5 * 60);

/// Kept warm by the background refresher and never evicted, so the reserve
/// they draw on is spent only on schedule.
const PINNED: &[&str] = &["catalog", "dashboard"];

/// The reserve's default: the dashboard refreshes every 150 s, 576 times a
/// day, and can take two pages; the catalog adds a few calls.
const DEFAULT_RESERVE: u32 = 1500;

struct App {
    /// Essential priority: the dashboard and catalog refreshes.
    client: FingridClient,
    /// Visitor priority: dataset series fetched because someone asked.
    visitor_client: FingridClient,
    throttle: Arc<Throttle>,
    cache: Cache,
    /// Ids in the last catalog fetched, so a series request for an id that
    /// does not exist is turned away without spending an upstream call.
    known_ids: RwLock<HashSet<i32>>,
}

type Shared = Arc<App>;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let api_key = match read_api_key() {
        Some(key) => key,
        None => {
            eprintln!("FINGRID_API_KEY (or FINGRID_API_KEY_FILE) must be set to a Fingrid open data API key.");
            std::process::exit(1);
        }
    };

    let daily_limit = std::env::var("FINGRID_DAILY_LIMIT").ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8000);
    let reserve = std::env::var("FINGRID_DAILY_RESERVE").ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_RESERVE);
    // A little over two seconds, so clock jitter never lands two calls inside
    // Fingrid's window.
    let throttle = Arc::new(
        Throttle::new(Duration::from_millis(2100), daily_limit).with_reserve(reserve),
    );

    let mut client = FingridClient::new(&api_key)
        .and_then(|c| c.with_timeout(Duration::from_secs(30)))
        .expect("HTTP client")
        .with_throttle(Arc::clone(&throttle));
    if let Ok(base) = std::env::var("FINGRID_API_BASE") {
        client = client.with_base(&base);
    }

    let app = Arc::new(App {
        visitor_client: client.with_priority(Priority::Visitor),
        client,
        throttle,
        cache: Cache::new().with_pinned(PINNED),
        known_ids: RwLock::new(HashSet::new()),
    });

    // Keep the catalog and the dashboard warm. Visitors are only ever served
    // what this loop fetched, so no visitor waits on Fingrid for the front
    // page and none can make it fetch more often. While fetches fail the loop
    // slows down, rather than retrying an outage every 30 s.
    {
        let app = Arc::clone(&app);
        tokio::spawn(async move {
            let mut pause = REFRESH_EVERY;
            loop {
                let ok = refreshed(catalog(&app).await) & refreshed(dashboard(&app).await);
                pause = if ok { REFRESH_EVERY } else { (pause * 2).min(REFRESH_BACKOFF_MAX) };
                tokio::time::sleep(pause).await;
            }
        });
    }

    let dist = std::env::var("DIST_DIR").unwrap_or_else(|_| "dist".into());

    let api = Router::new()
        .route("/api/health",              get(health_handler))
        .route("/api/version",             get(version_handler))
        .route("/api/dashboard",           get(dashboard_handler))
        .route("/api/datasets",            get(datasets_handler))
        .route("/api/datasets/{id}/data",  get(data_handler))
        .fallback(|| async { (StatusCode::NOT_FOUND, "Not found") })
        .with_state(app);

    let router = Router::new()
        .merge(api)
        .fallback_service(ServeDir::new(&dist))
        .layer(CompressionLayer::new())
        // The page embeds nothing from elsewhere and is never framed.
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ));

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("fingrid-viewer listening on {}, serving {}", listener.local_addr().unwrap(), dist);
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

fn read_api_key() -> Option<String> {
    let key = match std::env::var("FINGRID_API_KEY_FILE") {
        Ok(path) => std::fs::read_to_string(path).ok()?,
        Err(_) => std::env::var("FINGRID_API_KEY").ok()?,
    };
    let key = key.trim().to_string();
    (!key.is_empty()).then_some(key)
}

/// Podman stops a container with SIGTERM; finish in-flight responses first.
async fn shutdown_signal() {
    let ctrl_c = async { let _ = tokio::signal::ctrl_c().await; };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
}

// ---------------------------------------------------------------------------
// Cached fetches
// ---------------------------------------------------------------------------

/// True when the response is current: fetched now, or still fresh in the cache.
fn refreshed(result: Result<(Entry, bool), CacheError>) -> bool {
    matches!(result, Ok((_, false)))
}

/// What the background refresher last fetched for `key`, for a visitor. It
/// counts as stale once it has missed a couple of refreshes.
fn warm(app: &App, key: &str, ttl: Duration) -> Result<(Entry, bool), CacheError> {
    match app.cache.peek(key) {
        Some(e) => {
            let stale = e.age() > ttl * 2;
            Ok((e, stale))
        }
        None => Err(CacheError::NotReady),
    }
}

async fn catalog(app: &App) -> Result<(Entry, bool), CacheError> {
    let result = app.cache.get_or_fetch("catalog", CATALOG_TTL, || async {
        let mut list = app.client.get_datasets().await?;
        list.sort_by_key(|d| d.id);
        let ids = list.iter().map(|d| d.id).collect();
        *app.known_ids.write().unwrap() = ids;
        Ok(Bytes::from(serde_json::to_vec(&serde_json::json!({ "data": list }))?))
    }).await;
    if let Err(CacheError::Upstream(e)) = &result {
        tracing::warn!("Catalog unavailable: {:#}", e);
    }
    result
}

async fn dashboard(app: &App) -> Result<(Entry, bool), CacheError> {
    app.cache.get_or_fetch("dashboard", DASHBOARD_TTL, || async {
        let now = Utc::now();
        let start = now - ChronoDuration::hours(24);
        let end = now + ChronoDuration::hours(24);
        let points = app.client
            .get_multi_data(DASHBOARD_IDS, &series::rfc3339(start), &series::rfc3339(end))
            .await?;
        let body = series::dashboard(&points, now, start, end);
        Ok(Bytes::from(serde_json::to_vec(&body)?))
    }).await
}

async fn dataset_series(app: &App, id: i32, range: Range) -> Result<(Entry, bool), CacheError> {
    let key = format!("series:{}:{}", id, range.key());
    app.cache.get_or_fetch(&key, range.ttl(), || async {
        let now = Utc::now();
        let start = now - range.back();
        let end = now + range.ahead();
        let (start_s, end_s) = (series::rfc3339(start), series::rfc3339(end));
        let (points, truncated) = app.visitor_client.get_dataset_data_newest(id, &start_s, &end_s).await?;
        let points = series::group(&points).remove(&id).unwrap_or_default();
        let body = series::SeriesResponse { id, range: range.key(), start: start_s, end: end_s, truncated, points };
        Ok(Bytes::from(serde_json::to_vec(&body)?))
    }).await
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// A cached body as JSON. Browsers may hold it for what is left of its
/// lifetime (at most a minute); a stale copy is marked and never held.
fn json_response(result: Result<(Entry, bool), CacheError>, ttl: Duration) -> Response {
    match result {
        Ok((entry, stale)) => {
            let max_age = if stale { 0 } else { ttl.saturating_sub(entry.age()).as_secs().min(60) };
            let mut res = (
                [
                    (header::CONTENT_TYPE, "application/json".to_string()),
                    (header::CACHE_CONTROL, format!("public, max-age={}", max_age)),
                ],
                entry.body,
            ).into_response();
            let headers = res.headers_mut();
            if let Ok(v) = HeaderValue::from_str(&series::rfc3339(entry.fetched_utc)) {
                headers.insert("x-data-fetched", v);
            }
            if stale {
                headers.insert("x-data-stale", HeaderValue::from_static("1"));
            }
            res
        }
        Err(CacheError::NotReady) => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::RETRY_AFTER, "5")],
            "Still loading data from Fingrid, try again in a moment",
        ).into_response(),
        Err(CacheError::Busy) => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::RETRY_AFTER, "5")],
            "Busy fetching from Fingrid, try again in a moment",
        ).into_response(),
        // The detail is already in the log (cache.rs); visitors get no URLs
        // or internals.
        Err(CacheError::Upstream(_)) => (
            StatusCode::BAD_GATEWAY,
            "Fingrid did not answer. Try again in a moment.",
        ).into_response(),
    }
}

async fn health_handler(State(app): State<Shared>) -> Json<serde_json::Value> {
    let dashboard_age = app.cache.peek("dashboard").map(|e| e.age().as_secs());
    Json(serde_json::json!({
        "ok": dashboard_age.is_some_and(|age| age < 15 * 60),
        "dashboardAgeSeconds": dashboard_age,
        "fingridCallsToday": app.throttle.used_today().await,
        "fingridKeyRejected": app.throttle.key_is_rejected().await,
    }))
}

async fn version_handler() -> Json<serde_json::Value> {
    let version = option_env!("VERSION").unwrap_or(env!("CARGO_PKG_VERSION"));
    Json(serde_json::json!({ "version": version }))
}

async fn dashboard_handler(State(app): State<Shared>) -> Response {
    json_response(warm(&app, "dashboard", DASHBOARD_TTL), DASHBOARD_TTL)
}

async fn datasets_handler(State(app): State<Shared>) -> Response {
    json_response(warm(&app, "catalog", CATALOG_TTL), CATALOG_TTL)
}

#[derive(Deserialize)]
struct DataQuery {
    range: Option<String>,
}

async fn data_handler(
    State(app): State<Shared>,
    Path(id): Path<i32>,
    Query(q): Query<DataQuery>,
) -> Response {
    let range = match q.range.as_deref().map(Range::parse) {
        None => Range::Day,
        Some(Some(r)) => r,
        Some(None) => return (StatusCode::BAD_REQUEST, "range must be one of 24h, 3d, 7d, 30d").into_response(),
    };

    // The background refresher fills the ids; until it has, nothing is known.
    if app.known_ids.read().unwrap().is_empty() {
        return json_response(Err(CacheError::NotReady), CATALOG_TTL);
    }
    if !app.known_ids.read().unwrap().contains(&id) {
        return (StatusCode::NOT_FOUND, format!("No Fingrid dataset {}", id)).into_response();
    }

    json_response(dataset_series(&app, id, range).await, range.ttl())
}
