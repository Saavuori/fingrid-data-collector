use serde::{Serialize, Deserialize};
use anyhow::{Result, anyhow};
use reqwest::Client;
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

    /// Verifies the API Key by making a simple request to datasets
    pub async fn verify_api_key(&self) -> Result<()> {
        let url = "https://data.fingrid.fi/api/datasets?pageSize=1";
        let mut retries = 0;
        loop {
            let res = self.client.get(url)
                .header("x-api-key", &self.api_key)
                .send()
                .await?;

            if res.status().as_u16() == 429 && retries < 2 {
                tracing::warn!("Rate limit (429) verifying api key. Retrying in 2.2 seconds...");
                tokio::time::sleep(Duration::from_millis(2200)).await;
                retries += 1;
                continue;
            }

            if res.status().is_success() {
                return Ok(());
            } else {
                let status = res.status();
                let body = res.text().await.unwrap_or_default();
                return Err(anyhow!("Fingrid API check failed with status {}: {}", status, body));
            }
        }
    }

    /// Fetches all 249+ datasets from Fingrid
    pub async fn get_datasets(&self) -> Result<Vec<Dataset>> {
        let url = "https://data.fingrid.fi/api/datasets?pageSize=400";
        let mut retries = 0;
        loop {
            let res = self.client.get(url)
                .header("x-api-key", &self.api_key)
                .header("Accept", "application/json")
                .send()
                .await?;

            if res.status().as_u16() == 429 && retries < 2 {
                tracing::warn!("Rate limit (429) fetching datasets. Retrying in 2.2 seconds...");
                tokio::time::sleep(Duration::from_millis(2200)).await;
                retries += 1;
                continue;
            }

            if !res.status().is_success() {
                return Err(anyhow!("Failed to fetch datasets: Status {}", res.status()));
            }

            let body: DatasetListResponse = res.json().await?;
            return Ok(body.data);
        }
    }

    /// Fetches timeseries data for a single dataset ID
    pub async fn get_dataset_data(&self, id: i32, start_time: &str, end_time: &str) -> Result<Vec<DataPoint>> {
        let url = format!("https://data.fingrid.fi/api/datasets/{}/data", id);
        let mut retries = 0;
        loop {
            let res = self.client.get(&url)
                .header("x-api-key", &self.api_key)
                .header("Accept", "application/json")
                .query(&[("startTime", start_time), ("endTime", end_time)])
                .send()
                .await?;

            if res.status().as_u16() == 429 && retries < 2 {
                tracing::warn!("Rate limit (429) querying dataset ID {}. Retrying in 2.2 seconds...", id);
                tokio::time::sleep(Duration::from_millis(2200)).await;
                retries += 1;
                continue;
            }

            if !res.status().is_success() {
                let status = res.status();
                let body = res.text().await.unwrap_or_default();
                return Err(anyhow!("Query failed for dataset ID {} (status {}): {}", id, status, body));
            }

            let body: DataPointsResponse = res.json().await?;
            return Ok(body.data);
        }
    }
}
