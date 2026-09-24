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

/// `/ping`, `/api/v2/write` and friends, relative to the configured base URL.
fn endpoint(config: &InfluxConfig, path: &str) -> String {
    format!("{}{}", config.url.trim_end_matches('/'), path)
}

/// Every InfluxDB call carries a timeout: the background collector awaits the
/// write inline, so a server that accepts the connection and never answers
/// would otherwise stall collection until the process restarts.
fn http_client(timeout_secs: u64) -> Result<Client> {
    Ok(Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()?)
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

    let client = http_client(8)?;

    // 1. Ping
    let r = client.get(endpoint(config, "/ping")).send().await
        .map_err(|e| anyhow!("Cannot reach InfluxDB at '{}': {}", config.url, e))?;
    if !r.status().is_success() && r.status().as_u16() != 204 {
        return Err(anyhow!("InfluxDB ping returned {}", r.status()));
    }

    // 2. Bucket lookup
    let r = client.get(endpoint(config, "/api/v2/buckets"))
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

    let r = http_client(30)?.post(endpoint(config, "/api/v2/write"))
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

/// Escapes a tag value for line protocol (spaces, commas, equals signs).
/// Line protocol has no empty tag values: `unit=` fails to parse and InfluxDB
/// then rejects the whole batch, so a blank value falls back to `fallback`.
fn sanitize_tag(val: &str, fallback: &str) -> String {
    let val = val.trim();
    let val = if val.is_empty() { fallback } else { val };
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
    let tag_name = sanitize_tag(name, &id.to_string());
    let tag_unit = sanitize_tag(unit, "Value");

    points.iter().filter_map(|pt| {
        // Parse startTime timestamp (e.g. 2026-06-13T23:00:00.000Z)
        let parsed_time = chrono::DateTime::parse_from_rfc3339(&pt.startTime)
            .or_else(|_| chrono::DateTime::parse_from_rfc3339(&format!("{}Z", pt.startTime.trim_end_matches('Z'))))
            .ok()?;

        Some(format!(
            "fingrid,dataset_id={},dataset_name={},unit={} value={} {}",
            id, tag_name, tag_unit, pt.value, parsed_time.timestamp()
        ))
    })
    .collect::<Vec<_>>()
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(start: &str, value: f64) -> DataPoint {
        DataPoint { datasetId: 1, startTime: start.into(), endTime: start.into(), value }
    }

    #[test]
    fn line_protocol_escapes_tags_and_uses_start_time_seconds() {
        let lines = to_line_protocol(75, "Wind power, total", "MW", &[
            point("2026-06-13T23:00:00.000Z", 1234.5),
            point("2026-06-13T23:15:00", 7.0),
        ]);
        assert_eq!(
            lines,
            "fingrid,dataset_id=75,dataset_name=Wind\\ power\\,\\ total,unit=MW value=1234.5 1781391600\n\
             fingrid,dataset_id=75,dataset_name=Wind\\ power\\,\\ total,unit=MW value=7 1781392500",
        );
    }

    #[test]
    fn blank_tag_values_fall_back_instead_of_breaking_the_batch() {
        let lines = to_line_protocol(181, " ", "", &[point("2026-06-13T23:00:00Z", 1.0)]);
        assert_eq!(lines, "fingrid,dataset_id=181,dataset_name=181,unit=Value value=1 1781391600");
    }

    #[test]
    fn unparseable_timestamps_are_skipped() {
        assert_eq!(to_line_protocol(1, "x", "MW", &[point("yesterday", 1.0)]), "");
    }
}
