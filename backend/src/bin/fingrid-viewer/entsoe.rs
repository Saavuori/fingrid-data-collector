//! Day-ahead electricity prices for Finland from the ENTSO-E Transparency
//! Platform (document type A44). Fingrid does not publish market prices, so
//! this is the viewer's one source besides Fingrid.
//!
//! The security token travels as a query parameter, so request errors are
//! stripped of their URL before they can reach a log.

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use std::collections::BTreeMap;

pub const API_BASE: &str = "https://web-api.tp.entsoe.eu/api";

/// Finland's bidding zone, which is also its control area.
pub const FINLAND: &str = "10YFI-1--------U";

pub struct EntsoeClient {
    client: reqwest::Client,
    token: String,
    base: String,
}

impl EntsoeClient {
    pub fn new(token: &str) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()?;
        Ok(Self { client, token: token.to_string(), base: API_BASE.to_string() })
    }

    /// Points the client at another API root — a test double, say.
    pub fn with_base(mut self, base: &str) -> Self {
        self.base = base.trim_end_matches('/').to_string();
        self
    }

    /// Day-ahead prices for `area` over `[start, end)`, oldest first.
    pub async fn day_ahead_prices(&self, area: &str, start: DateTime<Utc>, end: DateTime<Utc>) -> Result<Prices> {
        let (start_s, end_s) = (period(start), period(end));
        let res = self.client.get(&self.base)
            .query(&[
                ("securityToken", self.token.as_str()),
                ("documentType", "A44"),
                ("in_Domain", area),
                ("out_Domain", area),
                ("periodStart", &start_s),
                ("periodEnd", &end_s),
            ])
            .send()
            .await
            .map_err(|e| anyhow!("ENTSO-E request failed: {}", e.without_url()))?;

        let status = res.status();
        let body = res.text().await.map_err(|e| anyhow!("ENTSO-E response failed: {}", e.without_url()))?;
        // "No matching data" comes back as an acknowledgement, with a 200 or
        // a 400 depending on the query, rather than an empty document.
        if let Some(reason) = acknowledgement(&body) {
            if reason.code == "999" {
                return Ok(Prices::default());
            }
            return Err(anyhow!("ENTSO-E refused the query (status {}): {} {}", status, reason.code, reason.text));
        }
        if !status.is_success() {
            return Err(anyhow!("ENTSO-E answered with status {}", status));
        }
        parse_prices(&body)
    }
}

/// ENTSO-E's period format, `yyyyMMddHHmm` in UTC. Only whole hours are accepted.
fn period(t: DateTime<Utc>) -> String {
    t.format("%Y%m%d%H00").to_string()
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prices {
    pub currency: String,
    /// "MWH" in every document seen so far; prices are per that unit.
    pub unit: String,
    /// The length of one price period, in minutes — 15 since the day-ahead
    /// market moved to quarter hours in October 2025.
    pub resolution_minutes: i64,
    /// `[epoch_ms, price]`, each price holding from its time until the next.
    pub points: Vec<(i64, f64)>,
}

struct Reason {
    code: String,
    text: String,
}

fn acknowledgement(body: &str) -> Option<Reason> {
    let doc = roxmltree::Document::parse(body).ok()?;
    let root = doc.root_element();
    if root.tag_name().name() != "Acknowledgement_MarketDocument" {
        return None;
    }
    let reason = child(root, "Reason");
    Some(Reason {
        code: reason.and_then(|r| child_text(r, "code")).unwrap_or_default().to_string(),
        text: reason.and_then(|r| child_text(r, "text")).unwrap_or_default().to_string(),
    })
}

fn child<'a, 'i>(node: roxmltree::Node<'a, 'i>, name: &str) -> Option<roxmltree::Node<'a, 'i>> {
    node.children().find(|c| c.tag_name().name() == name)
}

fn children<'a, 'i: 'a>(node: roxmltree::Node<'a, 'i>, name: &'a str) -> impl Iterator<Item = roxmltree::Node<'a, 'i>> + 'a {
    node.children().filter(move |c| c.tag_name().name() == name)
}

fn child_text<'a>(node: roxmltree::Node<'a, '_>, name: &str) -> Option<&'a str> {
    child(node, name).and_then(|c| c.text()).map(str::trim)
}

/// ISO 8601 durations as they appear in these documents: PT15M, PT30M, PT60M, P1D.
fn resolution(s: &str) -> Option<Duration> {
    match s {
        "P1D" => Some(Duration::days(1)),
        _ => {
            let minutes = s.strip_prefix("PT")?.strip_suffix('M')?.parse().ok()?;
            Some(Duration::minutes(minutes))
        }
    }
}

/// `2026-10-06T22:00Z` — ENTSO-E leaves out the seconds.
fn time(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .or_else(|_| DateTime::parse_from_str(&format!("{}:00+00:00", s.trim_end_matches('Z')), "%Y-%m-%dT%H:%M:%S%:z"))
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// Reads a Publication_MarketDocument into one series.
///
/// Positions left out of a period hold the previous price (curve type A03
/// only lists changes). Where the same time is published at more than one
/// resolution — hourly and quarter-hourly side by side, as some zones did in
/// the switch-over — the finest wins.
pub fn parse_prices(body: &str) -> Result<Prices> {
    let doc = roxmltree::Document::parse(body).context("ENTSO-E sent something that is not XML")?;
    let root = doc.root_element();
    if root.tag_name().name() != "Publication_MarketDocument" {
        return Err(anyhow!("Unexpected ENTSO-E document {}", root.tag_name().name()));
    }

    let mut out = Prices::default();
    // resolution in minutes → (start ms → (end ms, price))
    let mut by_resolution: BTreeMap<i64, BTreeMap<i64, (i64, f64)>> = BTreeMap::new();

    for ts in children(root, "TimeSeries") {
        if out.currency.is_empty() {
            out.currency = child_text(ts, "currency_Unit.name").unwrap_or_default().to_string();
            out.unit = child_text(ts, "price_Measure_Unit.name").unwrap_or_default().to_string();
        }
        for p in children(ts, "Period") {
            let interval = child(p, "timeInterval");
            let start = interval.and_then(|i| child_text(i, "start")).and_then(time);
            let end = interval.and_then(|i| child_text(i, "end")).and_then(time);
            let step = child_text(p, "resolution").and_then(resolution);
            let (Some(start), Some(end), Some(step)) = (start, end, step) else { continue };
            if end <= start {
                continue;
            }

            let mut given: BTreeMap<i64, f64> = BTreeMap::new();
            for point in children(p, "Point") {
                let pos = child_text(point, "position").and_then(|v| v.parse::<i64>().ok());
                let price = child_text(point, "price.amount").and_then(|v| v.parse::<f64>().ok());
                if let (Some(pos), Some(price)) = (pos, price) {
                    if pos >= 1 && price.is_finite() {
                        given.insert(pos, price);
                    }
                }
            }

            let slots = (end - start).num_minutes() / step.num_minutes().max(1);
            let series = by_resolution.entry(step.num_minutes()).or_default();
            let mut last = None;
            for pos in 1..=slots {
                if let Some(v) = given.get(&pos) {
                    last = Some(*v);
                }
                let Some(price) = last else { continue };
                let t = start + step * (pos as i32 - 1);
                series.insert(t.timestamp_millis(), ((t + step).timestamp_millis(), price));
            }
        }
    }

    // Finest first; a coarser price only fills time no finer one covers.
    let mut taken: BTreeMap<i64, (i64, f64)> = BTreeMap::new();
    for (minutes, series) in &by_resolution {
        if out.resolution_minutes == 0 {
            out.resolution_minutes = *minutes;
        }
        for (&start, &(end, price)) in series {
            let overlaps_before = taken.range(..=start).next_back().is_some_and(|(_, (e, _))| *e > start);
            let overlaps_after = taken.range(start..end).next().is_some();
            if !overlaps_before && !overlaps_after {
                taken.insert(start, (end, price));
            }
        }
    }
    out.points = taken.into_iter().map(|(t, (_, v))| (t, v)).collect();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(series: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="utf-8"?>
<Publication_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3">
  <mRID>x</mRID>
  {series}
</Publication_MarketDocument>"#
        )
    }

    fn series(res: &str, start: &str, end: &str, points: &[(i64, f64)]) -> String {
        let pts: String = points.iter()
            .map(|(p, v)| format!("<Point><position>{p}</position><price.amount>{v}</price.amount></Point>"))
            .collect();
        format!(
            "<TimeSeries><currency_Unit.name>EUR</currency_Unit.name>\
             <price_Measure_Unit.name>MWH</price_Measure_Unit.name><curveType>A03</curveType>\
             <Period><timeInterval><start>{start}</start><end>{end}</end></timeInterval>\
             <resolution>{res}</resolution>{pts}</Period></TimeSeries>"
        )
    }

    const T0: i64 = 1_791_324_000_000; // 2026-10-06T22:00Z

    #[test]
    fn quarter_hours_are_read_with_gaps_filled_forward() {
        let body = doc(&series("PT15M", "2026-10-06T22:00Z", "2026-10-06T23:00Z", &[(1, 10.5), (3, -2.0)]));
        let p = parse_prices(&body).unwrap();
        assert_eq!(p.currency, "EUR");
        assert_eq!(p.resolution_minutes, 15);
        let q = 15 * 60 * 1000;
        assert_eq!(p.points, vec![(T0, 10.5), (T0 + q, 10.5), (T0 + 2 * q, -2.0), (T0 + 3 * q, -2.0)]);
    }

    #[test]
    fn finer_resolution_wins_where_both_are_published() {
        let body = doc(&format!(
            "{}{}",
            series("PT60M", "2026-10-06T22:00Z", "2026-10-07T00:00Z", &[(1, 50.0), (2, 60.0)]),
            series("PT15M", "2026-10-06T22:00Z", "2026-10-06T23:00Z", &[(1, 1.0), (2, 2.0), (3, 3.0), (4, 4.0)]),
        ));
        let p = parse_prices(&body).unwrap();
        assert_eq!(p.resolution_minutes, 15);
        let values: Vec<f64> = p.points.iter().map(|(_, v)| *v).collect();
        // The first hour from the quarter hours, the second from the hourly series.
        assert_eq!(values, vec![1.0, 2.0, 3.0, 4.0, 60.0]);
        assert_eq!(p.points[4].0, T0 + 3_600_000);
    }

    #[test]
    fn no_data_is_an_acknowledgement() {
        let body = r#"<Acknowledgement_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-1:acknowledgementdocument:7:0">
          <Reason><code>999</code><text>No matching data found</text></Reason>
        </Acknowledgement_MarketDocument>"#;
        let r = acknowledgement(body).unwrap();
        assert_eq!(r.code, "999");
        assert!(acknowledgement(&doc("")).is_none());
        assert!(parse_prices(body).is_err());
    }

    #[test]
    fn periods_are_whole_utc_hours() {
        let t = DateTime::parse_from_rfc3339("2026-10-07T13:47:12Z").unwrap().with_timezone(&Utc);
        assert_eq!(period(t), "202610071300");
        assert_eq!(time("2026-10-06T22:00Z").unwrap().timestamp_millis(), T0);
    }
}
