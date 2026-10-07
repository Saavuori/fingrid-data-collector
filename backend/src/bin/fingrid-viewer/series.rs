//! Shapes Fingrid rows into what the viewer's charts read: per-dataset series
//! of `[epoch_ms, value]` pairs, oldest first.

use chrono::{DateTime, Duration, Utc};
use fingrid_collector::fingrid_client::DataPoint;
use serde::Serialize;
use std::collections::BTreeMap;

/// The windows a visitor can pick. A fixed set rather than free start/end
/// times, so every visitor asking for the same view shares one cached fetch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Range {
    Day,
    ThreeDays,
    Week,
    Month,
}

impl Range {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "24h" => Some(Self::Day),
            "3d" => Some(Self::ThreeDays),
            "7d" => Some(Self::Week),
            "30d" => Some(Self::Month),
            _ => None,
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Day => "24h",
            Self::ThreeDays => "3d",
            Self::Week => "7d",
            Self::Month => "30d",
        }
    }

    pub fn back(self) -> Duration {
        match self {
            Self::Day => Duration::hours(24),
            Self::ThreeDays => Duration::days(3),
            Self::Week => Duration::days(7),
            Self::Month => Duration::days(30),
        }
    }

    /// How far past now the window reaches, so forecast datasets show what
    /// is coming. Measured series simply have nothing there.
    pub fn ahead(self) -> Duration {
        match self {
            Self::Day => Duration::hours(24),
            _ => Duration::hours(72),
        }
    }

    /// How long a fetched window is served before it is fetched again.
    pub fn ttl(self) -> std::time::Duration {
        let minutes = match self {
            Self::Day => 3,
            Self::ThreeDays => 10,
            Self::Week => 20,
            Self::Month => 60,
        };
        std::time::Duration::from_secs(minutes * 60)
    }
}

pub fn rfc3339(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn epoch_ms(start_time: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(start_time).ok().map(|t| t.timestamp_millis())
}

/// Groups rows by dataset, each series sorted oldest first with duplicate
/// timestamps dropped (pages can overlap when Fingrid publishes mid-fetch).
pub fn group(points: &[DataPoint]) -> BTreeMap<i32, Vec<(i64, f64)>> {
    let mut out: BTreeMap<i32, Vec<(i64, f64)>> = BTreeMap::new();
    for p in points {
        if let Some(t) = epoch_ms(&p.startTime) {
            out.entry(p.datasetId).or_default().push((t, p.value));
        }
    }
    for series in out.values_mut() {
        series.sort_by_key(|(t, _)| *t);
        series.dedup_by_key(|(t, _)| *t);
    }
    out
}

/// The reading in force at `now`: the last one that started at or before it.
pub fn current(series: &[(i64, f64)], now_ms: i64) -> Option<(i64, f64)> {
    series.iter().rev().find(|(t, _)| *t <= now_ms).copied()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesResponse {
    pub id: i32,
    pub range: &'static str,
    pub start: String,
    pub end: String,
    /// The window held more rows than one Fingrid page; the newest are shown.
    pub truncated: bool,
    pub points: Vec<(i64, f64)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Latest {
    pub t: i64,
    pub v: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardResponse {
    pub generated_at: String,
    pub start: String,
    pub end: String,
    /// Keyed by dataset id.
    pub latest: BTreeMap<i32, Latest>,
    pub series: BTreeMap<i32, Vec<(i64, f64)>>,
}

pub fn dashboard(points: &[DataPoint], now: DateTime<Utc>, start: DateTime<Utc>, end: DateTime<Utc>) -> DashboardResponse {
    let series = group(points);
    let now_ms = now.timestamp_millis();
    let latest = series.iter()
        .filter_map(|(id, s)| current(s, now_ms).map(|(t, v)| (*id, Latest { t, v })))
        .collect();
    DashboardResponse {
        generated_at: rfc3339(now),
        start: rfc3339(start),
        end: rfc3339(end),
        latest,
        series,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(id: i32, start: &str, value: f64) -> DataPoint {
        DataPoint { datasetId: id, startTime: start.into(), endTime: start.into(), value }
    }

    #[test]
    fn rows_are_grouped_sorted_and_deduplicated() {
        let g = group(&[
            p(1, "2026-10-06T10:03:00.000Z", 2.0),
            p(1, "2026-10-06T10:00:00.000Z", 1.0),
            p(2, "2026-10-06T10:00:00Z", 5.0),
            p(1, "2026-10-06T10:03:00.000Z", 2.0),
            p(1, "not a time", 9.0),
        ]);
        assert_eq!(g[&1].len(), 2);
        assert!(g[&1][0].0 < g[&1][1].0);
        assert_eq!(g[&2][0].1, 5.0);
    }

    #[test]
    fn current_ignores_forecast_rows_after_now() {
        let s = [(0, 1.0), (10, 2.0), (20, 3.0)];
        assert_eq!(current(&s, 15), Some((10, 2.0)));
        assert_eq!(current(&s, 20), Some((20, 3.0)));
        assert_eq!(current(&s, -1), None);
    }

    #[test]
    fn ranges_round_trip_and_widen_with_length() {
        for key in ["24h", "3d", "7d", "30d"] {
            assert_eq!(Range::parse(key).unwrap().key(), key);
        }
        assert!(Range::parse("1y").is_none());
        assert!(Range::Month.ttl() > Range::Day.ttl());
    }

    #[test]
    fn dashboard_reports_latest_per_dataset() {
        let now = DateTime::parse_from_rfc3339("2026-10-06T10:05:00Z").unwrap().with_timezone(&Utc);
        let d = dashboard(
            &[
                p(193, "2026-10-06T10:00:00Z", 9000.0),
                p(193, "2026-10-06T10:03:00Z", 9100.0),
                p(166, "2026-10-06T10:00:00Z", 8800.0),
                p(166, "2026-10-06T11:00:00Z", 9500.0),
            ],
            now, now, now,
        );
        assert_eq!(d.latest[&193].v, 9100.0);
        assert_eq!(d.latest[&166].v, 8800.0);
        assert_eq!(d.series[&166].len(), 2);
    }
}
