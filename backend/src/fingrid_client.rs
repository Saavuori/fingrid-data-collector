use serde::{Serialize, Deserialize};
use anyhow::{Result, anyhow};
use reqwest::{Client, StatusCode};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::Instant;

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dataset {
    pub id: i32,
    pub nameFi: String,
    pub nameEn: String,
    pub descriptionFi: Option<String>,
    pub descriptionEn: Option<String>,
    pub unitFi: Option<String>,
    pub unitEn: Option<String>,
    pub dataPeriodFi: Option<String>,
    pub dataPeriodEn: Option<String>,
    pub contentGroupsFi: Option<Vec<String>>,
    pub contentGroupsEn: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetListResponse {
    pub data: Vec<Dataset>,
    #[serde(default)]
    pub pagination: Option<Pagination>,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPoint {
    pub datasetId: i32,
    pub startTime: String,
    pub endTime: String,
    pub value: f64,
}

/// A row as Fingrid sends it. Gaps in a series come through as a null value,
/// which would fail the whole response if parsed straight into `DataPoint`.
#[allow(non_snake_case)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDataPoint {
    datasetId: i32,
    startTime: String,
    endTime: String,
    value: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawDataPointsResponse {
    data: Vec<RawDataPoint>,
    #[serde(default)]
    pagination: Option<Pagination>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pagination {
    #[serde(default)]
    pub next_page: Option<u32>,
}

impl Pagination {
    fn next(p: &Option<Pagination>) -> Option<u32> {
        p.as_ref().and_then(|p| p.next_page)
    }
}

fn into_points(raw: Vec<RawDataPoint>) -> Vec<DataPoint> {
    raw.into_iter()
        .filter_map(|r| {
            let value = r.value.filter(|v| v.is_finite())?;
            Some(DataPoint { datasetId: r.datasetId, startTime: r.startTime, endTime: r.endTime, value })
        })
        .collect()
}

/// Fingrid's largest page.
const MAX_PAGE_SIZE: &str = "20000";

/// Whose request it is, for the daily budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Priority {
    /// Work the service cannot do without, such as keeping its front page
    /// fresh. May spend the whole budget, the reserve included.
    Essential,
    /// Fetches set off by visitors. Stop short of the reserve, so no amount
    /// of traffic can starve the essential work.
    Visitor,
}

/// After Fingrid rejects the key, every call is refused locally for this long,
/// doubling with each further rejection up to `AUTH_BACKOFF_MAX`. A bad key
/// then costs a handful of calls an hour instead of one every few seconds.
const AUTH_BACKOFF_START: Duration = Duration::from_secs(60);
const AUTH_BACKOFF_MAX: Duration = Duration::from_secs(30 * 60);

/// Keeps every request made with one API key inside Fingrid's limits: one call
/// per two seconds, and at most `daily_limit` calls per UTC day (Fingrid allows
/// 10 000), of which the last `reserve` are kept for `Priority::Essential`.
/// Callers queue on the lock, so requests go out one at a time.
pub struct Throttle {
    gap: Duration,
    daily_limit: u32,
    reserve: u32,
    state: Mutex<ThrottleState>,
}

struct ThrottleState {
    last: Option<Instant>,
    day: chrono::NaiveDate,
    used: u32,
    /// Rejections of the key in a row; reset by any accepted call.
    auth_rejections: u32,
    blocked_until: Option<Instant>,
}

impl Throttle {
    pub fn new(gap: Duration, daily_limit: u32) -> Self {
        Self {
            gap,
            daily_limit,
            reserve: 0,
            state: Mutex::new(ThrottleState {
                last: None,
                day: chrono::Utc::now().date_naive(),
                used: 0,
                auth_rejections: 0,
                blocked_until: None,
            }),
        }
    }

    /// Keeps the last `reserve` calls of each day for `Priority::Essential`.
    pub fn with_reserve(mut self, reserve: u32) -> Self {
        self.reserve = reserve.min(self.daily_limit);
        self
    }

    /// Waits for the next free slot. Fails without spending anything while the
    /// key is in its rejection backoff, or once the budget open to `priority`
    /// is spent.
    pub async fn acquire(&self, priority: Priority) -> Result<()> {
        let mut st = self.state.lock().await;
        if let Some(until) = st.blocked_until {
            let now = Instant::now();
            if now < until {
                return Err(anyhow!(
                    "Fingrid rejected the API key; not trying again for {} s",
                    (until - now).as_secs()
                ));
            }
        }
        let today = chrono::Utc::now().date_naive();
        if st.day != today {
            st.day = today;
            st.used = 0;
        }
        let limit = match priority {
            Priority::Essential => self.daily_limit,
            Priority::Visitor => self.daily_limit - self.reserve,
        };
        if st.used >= limit {
            return Err(anyhow!("Daily Fingrid request budget ({}) is used up", limit));
        }
        if let Some(last) = st.last {
            tokio::time::sleep_until(last + self.gap).await;
        }
        st.last = Some(Instant::now());
        st.used += 1;
        Ok(())
    }

    /// Records a 401/403 and returns how long calls are now refused.
    pub async fn key_rejected(&self) -> Duration {
        let mut st = self.state.lock().await;
        let backoff = AUTH_BACKOFF_START
            .saturating_mul(1 << st.auth_rejections.min(10))
            .min(AUTH_BACKOFF_MAX);
        st.auth_rejections += 1;
        st.blocked_until = Some(Instant::now() + backoff);
        backoff
    }

    /// Records that Fingrid accepted the key, ending any backoff.
    pub async fn key_accepted(&self) {
        let mut st = self.state.lock().await;
        st.auth_rejections = 0;
        st.blocked_until = None;
    }

    /// Requests made so far today.
    pub async fn used_today(&self) -> u32 {
        let st = self.state.lock().await;
        if st.day == chrono::Utc::now().date_naive() { st.used } else { 0 }
    }

    /// True while the last answer was a rejected key.
    pub async fn key_is_rejected(&self) -> bool {
        self.state.lock().await.auth_rejections > 0
    }
}

#[derive(Clone)]
pub struct FingridClient {
    client: Client,
    api_key: String,
    base: String,
    throttle: Option<Arc<Throttle>>,
    priority: Priority,
}

const API_BASE: &str = "https://data.fingrid.fi/api";

/// Fingrid allows one call per two seconds; a 429 is retried this many times
/// after waiting a little longer than that.
const MAX_429_RETRIES: u32 = 2;
const RETRY_DELAY: Duration = Duration::from_millis(2200);

impl FingridClient {
    pub fn new(api_key: &str) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;

        Ok(Self {
            client,
            api_key: api_key.to_string(),
            base: API_BASE.to_string(),
            throttle: None,
            priority: Priority::Essential,
        })
    }

    /// Replaces the default 10 s request timeout. A full 20 000-row page can
    /// take longer than that when Fingrid is busy.
    pub fn with_timeout(mut self, timeout: Duration) -> Result<Self> {
        self.client = Client::builder().timeout(timeout).build()?;
        Ok(self)
    }

    /// Points the client at another API root — a test double, say.
    pub fn with_base(mut self, base: &str) -> Self {
        self.base = base.trim_end_matches('/').to_string();
        self
    }

    /// Routes every request, retries included, through a shared throttle.
    pub fn with_throttle(mut self, throttle: Arc<Throttle>) -> Self {
        self.throttle = Some(throttle);
        self
    }

    /// A copy whose requests draw on the throttle as `priority`.
    pub fn with_priority(&self, priority: Priority) -> Self {
        Self { priority, ..self.clone() }
    }

    /// Sends a GET to the Fingrid API, retrying on `429 Too Many Requests`.
    /// Any other status, success or not, is returned to the caller.
    async fn get(&self, path: &str, query: &[(&str, &str)], what: &str) -> Result<reqwest::Response> {
        let url = format!("{}{}", self.base, path);
        let mut retries = 0;
        loop {
            if let Some(throttle) = &self.throttle {
                throttle.acquire(self.priority).await?;
            }
            let res = self.client.get(&url)
                .header("x-api-key", &self.api_key)
                .header("Accept", "application/json")
                .query(query)
                .send()
                .await?;

            if let Some(throttle) = &self.throttle {
                let status = res.status();
                if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
                    let backoff = throttle.key_rejected().await;
                    tracing::warn!(
                        "Fingrid rejected the API key ({}) {}; pausing all calls for {} s",
                        status, what, backoff.as_secs()
                    );
                } else if status.is_success() {
                    throttle.key_accepted().await;
                }
            }

            if res.status() == StatusCode::TOO_MANY_REQUESTS && retries < MAX_429_RETRIES {
                tracing::warn!("Rate limit (429) {}. Retrying in 2.2 seconds...", what);
                tokio::time::sleep(RETRY_DELAY).await;
                retries += 1;
                continue;
            }
            return Ok(res);
        }
    }

    /// Checks the API key with a one-row catalog request.
    ///
    /// `Ok(false)` means Fingrid answered and rejected the key; `Err` means the
    /// check itself failed (network down, Fingrid unavailable), which says
    /// nothing about whether the key is good.
    pub async fn verify_api_key(&self) -> Result<bool> {
        let res = self.get("/datasets", &[("pageSize", "1")], "verifying api key").await?;
        let status = res.status();
        if status.is_success() {
            return Ok(true);
        }
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Ok(false);
        }
        let body = res.text().await.unwrap_or_default();
        Err(anyhow!("Fingrid API check failed with status {}: {}", status, body))
    }

    /// Fetches all 249+ datasets from Fingrid
    pub async fn get_datasets(&self) -> Result<Vec<Dataset>> {
        let mut all = Vec::new();
        let mut page = 1u32;
        loop {
            let page_str = page.to_string();
            let res = self.get(
                "/datasets",
                &[("pageSize", "400"), ("page", &page_str)],
                "fetching datasets",
            ).await?;
            if !res.status().is_success() {
                return Err(anyhow!("Failed to fetch datasets: Status {}", res.status()));
            }
            let body: DatasetListResponse = res.json().await?;
            all.extend(body.data);
            match Pagination::next(&body.pagination) {
                Some(next) if next > page && page < 5 => page = next,
                _ => break,
            }
        }
        Ok(all)
    }

    /// Fetches timeseries data for a single dataset ID
    pub async fn get_dataset_data(&self, id: i32, start_time: &str, end_time: &str) -> Result<Vec<DataPoint>> {
        let res = self.get(
            &format!("/datasets/{}/data", id),
            &[("startTime", start_time), ("endTime", end_time)],
            &format!("querying dataset ID {}", id),
        ).await?;

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(anyhow!("Query failed for dataset ID {} (status {}): {}", id, status, body));
        }

        let body: RawDataPointsResponse = res.json().await?;
        Ok(into_points(body.data))
    }

    /// One page — the newest rows first — of a dataset's series. The flag is
    /// true when the window holds more rows than fit on it, as it does for
    /// Fingrid's sub-second measurements over anything but a short window.
    pub async fn get_dataset_data_newest(
        &self,
        id: i32,
        start_time: &str,
        end_time: &str,
    ) -> Result<(Vec<DataPoint>, bool)> {
        let res = self.get(
            &format!("/datasets/{}/data", id),
            &[
                ("startTime", start_time),
                ("endTime", end_time),
                ("pageSize", MAX_PAGE_SIZE),
                ("sortBy", "startTime"),
                ("sortOrder", "desc"),
            ],
            &format!("querying dataset ID {}", id),
        ).await?;

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(anyhow!("Query failed for dataset ID {} (status {}): {}", id, status, body));
        }

        let body: RawDataPointsResponse = res.json().await?;
        let truncated = Pagination::next(&body.pagination).is_some();
        Ok((into_points(body.data), truncated))
    }

    /// Several datasets over one window in as few calls as Fingrid allows —
    /// one, unless the rows overflow a page.
    pub async fn get_multi_data(&self, ids: &[i32], start_time: &str, end_time: &str) -> Result<Vec<DataPoint>> {
        let ids_str = ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",");
        let mut all = Vec::new();
        let mut page = 1u32;
        loop {
            let page_str = page.to_string();
            let res = self.get(
                "/data",
                &[
                    ("datasets", &ids_str),
                    ("startTime", start_time),
                    ("endTime", end_time),
                    ("pageSize", MAX_PAGE_SIZE),
                    ("page", &page_str),
                ],
                "querying multiple datasets",
            ).await?;

            if !res.status().is_success() {
                let status = res.status();
                let body = res.text().await.unwrap_or_default();
                return Err(anyhow!("Query failed for datasets {} (status {}): {}", ids_str, status, body));
            }

            let body: RawDataPointsResponse = res.json().await?;
            all.extend(into_points(body.data));
            match Pagination::next(&body.pagination) {
                Some(next) if next > page && page < 5 => page = next,
                _ => break,
            }
        }
        Ok(all)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_and_non_finite_values_are_dropped() {
        let body: RawDataPointsResponse = serde_json::from_str(r#"{
            "data": [
                {"datasetId": 1, "startTime": "a", "endTime": "b", "value": 1.5},
                {"datasetId": 1, "startTime": "c", "endTime": "d", "value": null}
            ],
            "pagination": {"total": 2, "lastPage": 1, "nextPage": null, "currentPage": 1}
        }"#).unwrap();
        assert!(Pagination::next(&body.pagination).is_none());
        let points = into_points(body.data);
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].value, 1.5);
    }

    #[test]
    fn next_page_is_read_from_pagination() {
        let body: RawDataPointsResponse = serde_json::from_str(
            r#"{"data": [], "pagination": {"nextPage": 2}}"#,
        ).unwrap();
        assert_eq!(Pagination::next(&body.pagination), Some(2));
        let bare: RawDataPointsResponse = serde_json::from_str(r#"{"data": []}"#).unwrap();
        assert!(Pagination::next(&bare.pagination).is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn throttle_spaces_calls_and_enforces_the_daily_budget() {
        let throttle = Throttle::new(Duration::from_secs(2), 3);
        let t0 = Instant::now();
        throttle.acquire(Priority::Essential).await.unwrap();
        throttle.acquire(Priority::Essential).await.unwrap();
        throttle.acquire(Priority::Essential).await.unwrap();
        assert!(Instant::now() - t0 >= Duration::from_secs(4));
        assert!(throttle.acquire(Priority::Essential).await.is_err());
        assert_eq!(throttle.used_today().await, 3);
    }

    #[tokio::test(start_paused = true)]
    async fn visitors_cannot_spend_the_reserve() {
        let throttle = Throttle::new(Duration::from_secs(2), 5).with_reserve(2);
        for _ in 0..3 {
            throttle.acquire(Priority::Visitor).await.unwrap();
        }
        assert!(throttle.acquire(Priority::Visitor).await.is_err());
        throttle.acquire(Priority::Essential).await.unwrap();
        throttle.acquire(Priority::Essential).await.unwrap();
        assert!(throttle.acquire(Priority::Essential).await.is_err());
        assert_eq!(throttle.used_today().await, 5);
    }

    #[tokio::test(start_paused = true)]
    async fn a_rejected_key_pauses_calls_with_growing_backoff() {
        let throttle = Throttle::new(Duration::from_secs(2), 100);
        throttle.acquire(Priority::Essential).await.unwrap();
        assert_eq!(throttle.key_rejected().await, AUTH_BACKOFF_START);
        assert!(throttle.key_is_rejected().await);

        // Refused while paused, and the refusals cost nothing.
        assert!(throttle.acquire(Priority::Essential).await.is_err());
        assert!(throttle.acquire(Priority::Visitor).await.is_err());
        assert_eq!(throttle.used_today().await, 1);

        tokio::time::advance(AUTH_BACKOFF_START).await;
        throttle.acquire(Priority::Essential).await.unwrap();
        assert_eq!(throttle.key_rejected().await, AUTH_BACKOFF_START * 2);
        for _ in 0..10 {
            throttle.key_rejected().await;
        }
        assert_eq!(throttle.key_rejected().await, AUTH_BACKOFF_MAX);

        throttle.key_accepted().await;
        assert!(!throttle.key_is_rejected().await);
        throttle.acquire(Priority::Essential).await.unwrap();
    }
}
