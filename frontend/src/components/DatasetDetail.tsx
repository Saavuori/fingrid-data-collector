import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button, Switch, makeStyles, mergeClasses } from '@fluentui/react-components';
import {
  ArrowLeft24Regular,
  ArrowClockwise20Regular,
  ArrowTrendingLines24Regular,
  ArrowDown16Regular,
  ArrowUp16Regular,
  PulseSquare24Regular,
  ErrorCircle24Regular,
  DatabaseSearch24Regular,
  Info24Regular,
} from '@fluentui/react-icons';

import { usePalette, type Palette } from '../theme';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useActiveDatasets } from '../hooks/useFingrid';
import { errorText } from '../api';
import type { Dataset, DataPoint } from '../types';
import { Card, Chip, ChipRail, EmptyState, Row, RowList, SegmentedControl, StatTile } from './ui';

// ── Ranges ────────────────────────────────────────────────────────────────────

type RangeKey = '24h' | '3d' | '7d';

const RANGES: { value: RangeKey; label: string; hours: number }[] = [
  { value: '24h', label: '24 h', hours: 24 },
  { value: '3d', label: '3 days', hours: 72 },
  { value: '7d', label: '7 days', hours: 168 },
];

// ── Formatting ────────────────────────────────────────────────────────────────

/** Fingrid variables span frequency (49.98 Hz) to system load (12 000 MW), so
 *  precision is derived from how much the series actually moves. Going by
 *  magnitude alone would round the whole frequency range to a flat "50.0". */
const precisionFor = (values: number[]): number => {
  if (values.length === 0) return 2;
  let min = values[0];
  let max = values[0];
  let magnitude = 0;
  // Reduced rather than spread into Math.max — a week of 3-minute data is
  // thousands of points, enough to overflow the argument list.
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    magnitude = Math.max(magnitude, Math.abs(v));
  }
  const scale = max - min > 0 ? max - min : magnitude;
  if (scale >= 100) return 0;
  if (scale >= 10) return 1;
  if (scale >= 1) return 2;
  if (scale >= 0.1) return 3;
  return 4;
};

const formatValue = (value: number, digits: number): string =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const formatTime = (iso: string, hours: number): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return hours <= 24
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// ── Styles ────────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  view: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  head: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },
  backButton: {
    flexShrink: 0,
    marginTop: '2px',
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    letterSpacing: '-0.025em',
    lineHeight: 1.2,
    '@media (min-width: 768px)': {
      fontSize: '28px',
    },
  },
  subtitle: {
    display: 'block',
    marginTop: '4px',
    fontSize: '13px',
    color: 'var(--text-muted)',
  },

  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    '@media (min-width: 768px)': {
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: '16px',
    },
  },

  chartCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  chartToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  chartHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 650,
    minWidth: 0,
  },
  chartBox: {
    height: '240px',
    width: '100%',
    margin: '0 -6px',
    '@media (min-width: 768px)': {
      height: '380px',
      margin: 0,
    },
  },
  skeleton: {
    height: '240px',
    borderRadius: '16px',
    background: 'var(--surface-alt)',
    '@media (min-width: 768px)': {
      height: '380px',
    },
  },

  collectRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
  },
  collectText: {
    minWidth: 0,
  },
  collectTitle: {
    display: 'block',
    fontSize: '15px',
    fontWeight: 620,
  },
  collectHint: {
    display: 'block',
    marginTop: '2px',
    fontSize: '13px',
    color: 'var(--text-muted)',
  },

  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 16px 10px',
    fontSize: '14px',
    fontWeight: 650,
  },
  description: {
    fontSize: '14px',
    lineHeight: 1.6,
    color: 'var(--text-muted)',
  },
});

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface ChartTooltipProps {
  active?: boolean;
  payload?: { value?: number | null; payload?: { fullTime: string } }[];
  unit: string;
  digits: number;
  palette: Palette;
}

const ChartTooltip = ({ active, payload, unit, digits, palette }: ChartTooltipProps) => {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  if (point?.value == null) return null;

  return (
    <div
      style={{
        background: palette.tooltipBg,
        border: `1px solid ${palette.border}`,
        borderRadius: '14px',
        padding: '10px 14px',
        fontSize: '12px',
        minWidth: '150px',
        boxShadow: palette.shadowRaised,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ color: palette.textMuted, fontWeight: 650 }}>{point.payload?.fullTime}</div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '18px',
          marginTop: '4px',
          color: palette.accent,
        }}
      >
        <span>{unit}</span>
        <span style={{ fontWeight: 700 }} className="tnum">
          {formatValue(Number(point.value), digits)}
        </span>
      </div>
    </div>
  );
};

// ── View ──────────────────────────────────────────────────────────────────────

const DatasetDetail: React.FC<{ dataset: Dataset; onBack: () => void }> = ({ dataset, onBack }) => {
  const styles = useStyles();
  const palette = usePalette();
  const isMobile = useIsMobile();
  const active = useActiveDatasets();

  const [range, setRange] = useState<RangeKey>('24h');
  const hours = RANGES.find(r => r.value === range)!.hours;
  const unit = dataset.unitEn?.trim() || 'Value';

  // Fingrid allows one call per two seconds, so this query is fetched on demand
  // only — no polling interval, and the result stays fresh for a minute.
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['datasetData', dataset.id, range],
    queryFn: async () => {
      const end = new Date();
      const start = new Date(end.getTime() - hours * 3600 * 1000);
      const res = await axios.get(`api/datasets/${dataset.id}/data`, {
        params: { startTime: start.toISOString(), endTime: end.toISOString() },
      });
      const points = (res.data.data ?? []) as DataPoint[];
      // Fingrid returns newest first; charts read left to right.
      return [...points].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      );
    },
    staleTime: 60_000,
  });

  const chartData =
    data?.map(point => ({
      time: formatTime(point.startTime, hours),
      fullTime: formatTime(point.startTime, 168),
      value: point.value,
    })) ?? [];

  const values = data?.map(p => p.value) ?? [];
  const digits = precisionFor(values);
  const latest = data?.length ? data[data.length - 1] : null;
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const min = data?.length ? data.reduce((m, c) => (c.value < m.value ? c : m), data[0]) : null;
  const max = data?.length ? data.reduce((m, c) => (c.value > m.value ? c : m), data[0]) : null;

  const xAxisInterval = (() => {
    if (chartData.length === 0) return 0;
    const ticks = isMobile ? 4 : 8;
    return Math.max(0, Math.round(chartData.length / ticks) - 1);
  })();

  const categories = dataset.contentGroupsEn ?? [];

  return (
    <div className={mergeClasses(styles.view, 'animate-fade-in')}>
      <div className={styles.head}>
        <Button
          appearance="subtle"
          shape="circular"
          className={styles.backButton}
          icon={<ArrowLeft24Regular />}
          onClick={onBack}
          aria-label="Back to catalog"
        />
        <div className={styles.headText}>
          <h1 className={styles.title}>{dataset.nameEn}</h1>
          <span className={styles.subtitle}>
            #{dataset.id} · {unit}
            {dataset.dataPeriodEn ? ` · ${dataset.dataPeriodEn}` : ''}
          </span>
        </div>
        <Button
          appearance="subtle"
          shape="circular"
          icon={<ArrowClockwise20Regular />}
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh preview"
        />
      </div>

      {categories.length > 0 && (
        <ChipRail>
          {categories.map(cat => (
            <Chip key={cat} readOnly>
              {cat}
            </Chip>
          ))}
        </ChipRail>
      )}

      {/* Headline numbers for the visible window */}
      <div className={styles.statGrid}>
        <StatTile
          label="Latest"
          value={latest ? formatValue(latest.value, digits) : '—'}
          hint={latest ? formatTime(latest.startTime, hours) : unit}
          icon={<PulseSquare24Regular fontSize={16} />}
          tint={palette.accentSoft}
          accent={palette.accent}
        />
        <StatTile
          label="Average"
          value={average != null ? formatValue(average, digits) : '—'}
          hint={unit}
          icon={<ArrowTrendingLines24Regular fontSize={16} />}
          tint={palette.accentSoft}
        />
        <StatTile
          label="Lowest"
          value={min ? formatValue(min.value, digits) : '—'}
          hint={min ? formatTime(min.startTime, hours) : unit}
          icon={<ArrowDown16Regular fontSize={16} />}
          tint={palette.signalSoft}
        />
        <StatTile
          label="Highest"
          value={max ? formatValue(max.value, digits) : '—'}
          hint={max ? formatTime(max.startTime, hours) : unit}
          icon={<ArrowUp16Regular fontSize={16} />}
          tint={palette.alertSoft}
        />
      </div>

      {/* Live preview */}
      <Card>
        <div className={styles.chartCard}>
          <div className={styles.chartToolbar}>
            <span className={styles.chartHeading}>
              <PulseSquare24Regular fontSize={18} style={{ color: palette.accent }} />
              {unit}
            </span>
            <SegmentedControl
              ariaLabel="Preview range"
              options={RANGES.map(r => ({ value: r.value, label: r.label }))}
              value={range}
              onChange={setRange}
            />
          </div>

          {isLoading ? (
            <div className={mergeClasses(styles.skeleton, 'animate-pulse')} />
          ) : isError ? (
            <EmptyState
              icon={<ErrorCircle24Regular />}
              title="Preview unavailable"
              body={errorText(error, 'Fingrid did not return data for this variable.')}
              action={
                <Button appearance="secondary" onClick={() => refetch()}>
                  Try again
                </Button>
              }
            />
          ) : chartData.length === 0 ? (
            <EmptyState
              icon={<DatabaseSearch24Regular />}
              title="No recent readings"
              body="Fingrid published no measurements for this variable in the selected window."
            />
          ) : (
            <div className={styles.chartBox}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="datasetFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={palette.accent} stopOpacity={0.34} />
                      <stop offset="95%" stopColor={palette.accent} stopOpacity={0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} vertical={false} />
                  <XAxis
                    dataKey="time"
                    stroke={palette.textFaint}
                    fontSize={isMobile ? 10 : 11}
                    tickLine={false}
                    axisLine={false}
                    interval={xAxisInterval}
                    minTickGap={8}
                    tickMargin={8}
                  />
                  {/* Frequency and price series hover far from zero, so the axis
                      follows the data rather than being anchored at 0. */}
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fill: palette.textMuted, fontSize: isMobile ? 10 : 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={isMobile ? 40 : 56}
                    tickFormatter={value => formatValue(Number(value), digits)}
                  />
                  <Tooltip
                    content={<ChartTooltip unit={unit} digits={digits} palette={palette} />}
                    cursor={{ stroke: palette.borderStrong, strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={palette.accent}
                    strokeWidth={2.25}
                    fillOpacity={1}
                    fill="url(#datasetFill)"
                    dot={false}
                    activeDot={{ r: 4, fill: palette.accent, strokeWidth: 0 }}
                    connectNulls
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Card>

      {/* Export toggle */}
      <Card>
        <div className={styles.collectRow}>
          <div className={styles.collectText}>
            <span className={styles.collectTitle}>Collect to InfluxDB</span>
            <span className={styles.collectHint}>
              {active.isActive(dataset.id)
                ? 'Included in every background sync'
                : 'Add this variable to the background collector'}
            </span>
          </div>
          <Switch
            checked={active.isActive(dataset.id)}
            disabled={active.pendingId === dataset.id}
            onChange={() => active.toggle(dataset.id)}
            aria-label="Collect to InfluxDB"
          />
        </div>
      </Card>

      {/* Reference data */}
      <Card padded={false}>
        <div className={styles.cardHeader}>
          <Info24Regular fontSize={18} style={{ color: palette.textMuted }} />
          About this variable
        </div>
        {dataset.descriptionEn && (
          <div style={{ padding: '0 16px 12px' }}>
            <p className={styles.description}>{dataset.descriptionEn}</p>
          </div>
        )}
        <RowList>
          <Row label="Dataset ID" value={String(dataset.id)} mono />
          <Row label="Unit" value={unit} />
          <Row label="Interval" value={dataset.dataPeriodEn || 'Unknown'} />
          <Row label="Finnish name" value={dataset.nameFi} />
          {categories.length > 0 && <Row label="Categories" value={categories.join(', ')} />}
          <Row label="Points loaded" value={String(chartData.length)} mono />
        </RowList>
      </Card>
    </div>
  );
};

export default DatasetDetail;
