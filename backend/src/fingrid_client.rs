use serde::{Serialize, Deserialize};
use anyhow::{Result, anyhow};
use reqwest::{Client, StatusCode};
use std::time::Duration;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataPointsResponse {
    pub data: Vec<DataPoint>,
}

#[derive(Clone)]
pub struct FingridClient {
    client: Client,
    api_key: String,
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
        })
    }

    /// Sends a GET to the Fingrid API, retrying on `429 Too Many Requests`.
    /// Any other status, success or not, is returned to the caller.
    async fn get(&self, path: &str, query: &[(&str, &str)], what: &str) -> Result<reqwest::Response> {
        let url = format!("{}{}", API_BASE, path);
        let mut retries = 0;
        loop {
            let res = self.client.get(&url)
                .header("x-api-key", &self.api_key)
                .header("Accept", "application/json")
                .query(query)
                .send()
                .await?;

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
        let res = self.get("/datasets", &[("pageSize", "400")], "fetching datasets").await?;
        if !res.status().is_success() {
            return Err(anyhow!("Failed to fetch datasets: Status {}", res.status()));
        }
        let body: DatasetListResponse = res.json().await?;
        Ok(body.data)
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

        let body: DataPointsResponse = res.json().await?;
        Ok(body.data)
    }
}
