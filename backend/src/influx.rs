use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use anyhow::{anyhow, Result};
use reqwest::Client;
use crate::fingrid_client::DataPoint;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InfluxConfig {
    pub url:              String,
    pub token:            String,
    pub org:              String,
    pub bucket:           String,
    pub enabled:          bool,
    pub interval_minutes: u64,
}

impl Default for InfluxConfig {
    fn default() -> Self {
        Self {
            url:              "http://localhost:8086".to_string(),
            token:            String::new(),
            org:              String::new(),
            bucket:           "fingrid".to_string(),
            enabled:          false,
            interval_minutes: 15,
        }
    }
}

fn config_path() -> PathBuf { PathBuf::from("influx_config.json") }

pub fn load_config() -> InfluxConfig {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_config(config: &InfluxConfig) -> Result<()> {
    std::fs::write(config_path(), serde_json::to_string_pretty(config)?)?;
    Ok(())
}

pub async fn test_connection(config: &InfluxConfig) -> Result<String> {
    if config.token.trim().is_empty() {
        return Err(anyhow!("API token is empty — fill in the Token field and save first"));
    }
    if config.org.trim().is_empty() {
        return Err(anyhow!("Organization is empty — fill in the Org field"));
    }
    if config.bucket.trim().is_empty() {
        return Err(anyhow!("Bucket is empty — fill in the Bucket field"));
    }

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()?;

    // 1. Ping
    let ping = format!("{}/ping", config.url.trim_end_matches('/'));
    let r = client.get(&ping).send().await
        .map_err(|e| anyhow!("Cannot reach InfluxDB at '{}': {}", config.url, e))?;
    if !r.status().is_success() && r.status().as_u16() != 204 {
        return Err(anyhow!("InfluxDB ping returned {}", r.status()));
    }

    // 2. Bucket lookup
    let buckets_url = format!("{}/api/v2/buckets", config.url.trim_end_matches('/'));
    let r = client.get(&buckets_url)
        .query(&[("org", config.org.as_str()), ("name", config.bucket.as_str())])
        .header("Authorization", format!("Token {}", config.token))
        .send().await?;

    let http_status = r.status().as_u16();
    let body: serde_json::Value = r.json().await.unwrap_or_else(|_| serde_json::json!({}));

    if http_status == 401 || http_status == 403 {
        let influx_msg = body["message"].as_str().unwrap_or("Invalid or missing API token");
        return Err(anyhow!("Authentication failed: {}", influx_msg));
    }
    if http_status >= 400 {
        let influx_msg = body["message"].as_str().unwrap_or("Unknown error");
        return Err(anyhow!("Bucket check failed (HTTP {}): {}", http_status, influx_msg));
    }

    let found = body["buckets"].as_array().map(|a| a.len()).unwrap_or(0);
    if found == 0 {
        return Ok(format!(
            "Server reached ✓ (Note: Bucket '{}' not listed, check if token is write-only)",
            config.bucket
        ));
    }

    Ok(format!(
        "Connected ✓ — bucket '{}' is ready in org '{}'",
        config.bucket, config.org
    ))
}

pub async fn write_points(config: &InfluxConfig, lines: &str) -> Result<usize> {
    if lines.trim().is_empty() { return Ok(0); }
    let count = lines.lines().filter(|l| !l.trim().is_empty()).count();

    let client = Client::new();
    let url = format!("{}/api/v2/write", config.url.trim_end_matches('/'));
    let r = client.post(&url)
        .query(&[
            ("org",       config.org.as_str()),
            ("bucket",    config.bucket.as_str()),
            ("precision", "s"),
        ])
        .header("Authorization", format!("Token {}", config.token))
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(lines.to_string())
        .send().await?;

    if !r.status().is_success() {
        let status = r.status();
        let body   = r.text().await.unwrap_or_default();
        return Err(anyhow!("InfluxDB write failed ({}): {}", status, body));
    }
    Ok(count)
}

/// Helper to sanitize a tag value (escapes/removes spaces, commas, equals)
fn sanitize_tag(val: &str) -> String {
    val.replace(' ', "\\ ")
        .replace(',', "\\,")
        .replace('=', "\\=")
}

/// Convert Fingrid data points to InfluxDB Line Protocol (precision = seconds).
/// Measurement : fingrid
/// Tags        : dataset_id, dataset_name, unit
/// Fields      : value
/// Timestamp   : parsed from startTime to unix seconds
pub fn to_line_protocol(
    id: i32,
    name: &str,
    unit: &str,
    points: &[DataPoint]
) -> String {
    points.iter().filter_map(|pt| {
        // Parse startTime timestamp (e.g. 2026-06-13T23:00:00.000Z)
        let parsed_time = chrono::DateTime::parse_from_rfc3339(&pt.startTime)
            .or_else(|_| chrono::DateTime::parse_from_rfc3339(&format!("{}Z", pt.startTime.trim_end_matches('Z'))))
            .ok()?;
        
        let ts = parsed_time.timestamp();
        
        let tag_name = sanitize_tag(name);
        let tag_unit = sanitize_tag(unit);
        
        Some(format!(
            "fingrid,dataset_id={},dataset_name={},unit={} value={} {}",
            id, tag_name, tag_unit, pt.value, ts
        ))
    })
    .collect::<Vec<_>>()
    .join("\n")
}
