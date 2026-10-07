import React, { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { makeStyles, mergeClasses } from '@fluentui/react-components';

import { usePalette } from '../../theme';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useI18n } from '../i18n';
import type { Point } from '../api';
import { fmtDateTime, formatValue, tickFormatter, timeTicks } from '../format';

/* Chart conventions, shared by every plot in the viewer:
   - one y-axis per chart; measures in different units get their own chart
   - solid hairline grid, no axis lines; 2px series lines
   - identity is never colour alone: a legend for 2+ series, plus tooltips
   - forecasts are drawn dashed, and a "Now" rule splits past from future
   - prices, which hold for a whole period, are drawn as steps */

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  points: Point[];
  kind?: 'line' | 'area' | 'stack';
  dashed?: boolean;
  /** Each value holds until the next, as a market price does. Lines only. */
  step?: boolean;
}

const useStyles = makeStyles({
  box: {
    width: '100%',
    height: '240px',
    '@media (min-width: 768px)': {
      height: '320px',
    },
  },
  tall: {
    '@media (min-width: 768px)': {
      height: '380px',
    },
  },
  short: {
    height: '180px',
    '@media (min-width: 768px)': {
      height: '220px',
    },
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px 16px',
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  swatch: {
    width: '14px',
    height: '0',
    borderTopWidth: '3px',
    borderTopStyle: 'solid',
    borderRadius: '2px',
    flexShrink: 0,
  },
  swatchBlock: {
    width: '10px',
    height: '10px',
    borderRadius: '3px',
    flexShrink: 0,
  },
  tooltip: {
    borderRadius: '12px',
    padding: '10px 12px',
    fontSize: '12px',
    minWidth: '170px',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-raised)',
  },
  tooltipTime: {
    color: 'var(--text-muted)',
    fontWeight: 650,
    marginBottom: '6px',
  },
  tooltipRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    lineHeight: 1.7,
  },
  tooltipLabel: {
    flex: 1,
    color: 'var(--text-muted)',
  },
  tooltipValue: {
    fontWeight: 650,
    color: 'var(--text)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    position: 'sticky',
    top: 0,
    textAlign: 'left',
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 650,
    color: 'var(--text-muted)',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: '6px 12px',
    borderBottom: '1px solid var(--border)',
  },
  num: {
    textAlign: 'right',
  },
  tableScroll: {
    maxHeight: '420px',
    overflowY: 'auto',
    borderRadius: '12px',
    border: '1px solid var(--border)',
  },
});

// ── Legend ───────────────────────────────────────────────────────────────────

export const Legend: React.FC<{ items: { label: string; color: string; dashed?: boolean; block?: boolean }[] }> = ({
  items,
}) => {
  const styles = useStyles();
  return (
    <div className={styles.legend}>
      {items.map(item => (
        <span key={item.label} className={styles.legendItem}>
          {item.block ? (
            <span className={styles.swatchBlock} style={{ background: item.color }} />
          ) : (
            <span
              className={styles.swatch}
              style={{ borderTopColor: item.color, borderTopStyle: item.dashed ? 'dashed' : 'solid' }}
            />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
};

// ── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string | null;
}

const ChartTooltip: React.FC<{
  active?: boolean;
  payload?: TooltipEntry[];
  label?: number | string;
  series: ChartSeries[];
  unit: string;
  digits: number;
  total?: { label: string };
}> = ({ active, payload, label, series, unit, digits, total }) => {
  const styles = useStyles();
  const palette = usePalette();
  const { locale } = useI18n();
  if (!active || !payload?.length || label == null) return null;

  const byKey = new Map(payload.map(p => [String(p.dataKey), p.value]));
  // Stacks read top-down, the same order they are drawn on screen.
  const rows = series
    .map(s => ({ s, v: byKey.get(s.key) }))
    .filter((r): r is { s: ChartSeries; v: number } => typeof r.v === 'number');
  const ordered = [
    ...rows.filter(r => r.s.kind !== 'stack'),
    ...rows.filter(r => r.s.kind === 'stack').reverse(),
  ];
  const stackSum = rows.filter(r => r.s.kind === 'stack').reduce((a, r) => a + r.v, 0);

  return (
    <div className={styles.tooltip} style={{ background: palette.tooltipBg }}>
      <div className={styles.tooltipTime}>{fmtDateTime(Number(label), locale)}</div>
      {ordered.map(({ s, v }) => (
        <div key={s.key} className={styles.tooltipRow}>
          <span
            className={s.kind === 'stack' ? styles.swatchBlock : styles.swatch}
            style={
              s.kind === 'stack'
                ? { background: s.color }
                : { borderTopColor: s.color, borderTopStyle: s.dashed ? 'dashed' : 'solid' }
            }
          />
          <span className={styles.tooltipLabel}>{s.label}</span>
          <span className={mergeClasses(styles.tooltipValue, 'tnum')}>
            {formatValue(v, digits, locale)} {unit}
          </span>
        </div>
      ))}
      {total && stackSum > 0 && (
        <div className={styles.tooltipRow} style={{ borderTop: '1px solid var(--border)', marginTop: 4 }}>
          <span className={styles.tooltipLabel}>{total.label}</span>
          <span className={mergeClasses(styles.tooltipValue, 'tnum')}>
            {formatValue(stackSum, digits, locale)} {unit}
          </span>
        </div>
      )}
    </div>
  );
};

// ── Time chart ───────────────────────────────────────────────────────────────

/** Merges series onto one row per timestamp — the shape Recharts plots. */
function mergeRows(series: ChartSeries[]) {
  const rows = new Map<number, Record<string, number>>();
  for (const s of series) {
    for (const [t, v] of s.points) {
      let row = rows.get(t);
      if (!row) {
        row = { t };
        rows.set(t, row);
      }
      row[s.key] = v;
    }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

export const TimeChart: React.FC<{
  series: ChartSeries[];
  unit: string;
  digits: number;
  /** Draws the "Now" rule when it falls inside the data. */
  now?: number;
  /** Fixed y-domain; defaults to following the data. */
  yDomain?: [number | 'auto' | 'dataMin' | 'dataMax', number | 'auto' | 'dataMin' | 'dataMax'];
  /** A shaded band, e.g. the frequency's normal operating range. */
  band?: { from: number; to: number };
  reference?: number;
  size?: 'short' | 'normal' | 'tall';
  /** Adds a total row for the stacked series to the tooltip. */
  stackTotalLabel?: string;
  ariaLabel: string;
}> = ({ series, unit, digits, now, yDomain, band, reference, size = 'normal', stackTotalLabel, ariaLabel }) => {
  const styles = useStyles();
  const palette = usePalette();
  const isMobile = useIsMobile();
  const { t, locale } = useI18n();

  const rows = useMemo(() => mergeRows(series), [series]);
  const from = rows.length ? rows[0].t : 0;
  const to = rows.length ? rows[rows.length - 1].t : 0;
  const ticks = useMemo(() => timeTicks(from, to, isMobile ? 4 : 7), [from, to, isMobile]);
  const showNow = now != null && now > from && now < to;
  const hasStack = series.some(s => s.kind === 'stack');

  const axisTick = { fill: palette.textMuted, fontSize: isMobile ? 10 : 11 };

  return (
    <div
      className={mergeClasses(styles.box, size === 'short' && styles.short, size === 'tall' && styles.tall)}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.grid} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[from, to]}
            ticks={ticks}
            tickFormatter={tickFormatter(locale)}
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: palette.border }}
            tickMargin={8}
          />
          <YAxis
            domain={yDomain ?? (hasStack ? [0, 'auto'] : ['auto', 'auto'])}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={isMobile ? 44 : 60}
            tickFormatter={v => formatValue(Number(v), digits, locale)}
          />
          {band && (
            <ReferenceArea y1={band.from} y2={band.to} fill={palette.signalSoft} stroke="none" ifOverflow="extendDomain" />
          )}
          {reference != null && <ReferenceLine y={reference} stroke={palette.borderStrong} />}
          <Tooltip
            content={
              <ChartTooltip
                series={series}
                unit={unit}
                digits={digits}
                total={stackTotalLabel ? { label: stackTotalLabel } : undefined}
              />
            }
            cursor={{ stroke: palette.borderStrong, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {series.map(s =>
            s.kind === 'stack' ? (
              <Area
                key={s.key}
                dataKey={s.key}
                stackId="stack"
                type="monotone"
                // A thin surface-coloured edge keeps neighbouring bands apart.
                stroke={palette.surface}
                strokeWidth={1.5}
                fill={s.color}
                fillOpacity={0.88}
                isAnimationActive={false}
                connectNulls
                activeDot={false}
              />
            ) : s.kind === 'area' ? (
              <Area
                key={s.key}
                dataKey={s.key}
                type="monotone"
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={0.14}
                dot={false}
                activeDot={{ r: 4, fill: s.color, stroke: palette.surface, strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            ) : (
              <Line
                key={s.key}
                dataKey={s.key}
                type={s.step ? 'stepAfter' : 'monotone'}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                dot={false}
                activeDot={{ r: 4, fill: s.color, stroke: palette.surface, strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            ),
          )}
          {showNow && (
            <ReferenceLine
              x={now}
              stroke={palette.textFaint}
              label={{ value: t.now, position: 'insideTopRight', fill: palette.textMuted, fontSize: 11 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

// ── Sparkline ────────────────────────────────────────────────────────────────

/** A trend glyph for a stat tile: no axes, no hover — the tile's number is
 *  the reading, this only shows its shape over the last day. */
export const Sparkline: React.FC<{ points: Point[]; color: string; height?: number }> = ({
  points,
  color,
  height = 32,
}) => {
  if (points.length < 2) return <div style={{ height }} />;
  const width = 120;
  let min = Infinity;
  let max = -Infinity;
  for (const [, v] of points) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const t0 = points[0][0];
  const span = points[points.length - 1][0] - t0 || 1;
  const range = max - min || 1;
  const d = points
    .map(([t, v], i) => {
      const x = ((t - t0) / span) * width;
      const y = height - 2 - ((v - min) / range) * (height - 4);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('');
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

// ── Table view ───────────────────────────────────────────────────────────────

/** The chart's values as rows, newest first — the accessible twin of a plot. */
export const DataTable: React.FC<{
  points: Point[];
  unit: string;
  digits: number;
  limit?: number;
}> = ({ points, unit, digits, limit = 500 }) => {
  const styles = useStyles();
  const { t, locale } = useI18n();
  const rows = useMemo(() => points.slice(-limit).reverse(), [points, limit]);
  return (
    <div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>{t.time}</th>
              <th className={mergeClasses(styles.th, styles.num)}>
                {t.value} ({unit})
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([time, v]) => (
              <tr key={time}>
                <td className={mergeClasses(styles.td, 'tnum')}>
                  {new Date(time).toLocaleString(locale, {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className={mergeClasses(styles.td, styles.num, 'tnum')}>{formatValue(v, digits, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-faint)' }}>
        {t.tableRows(rows.length, points.length)}
      </p>
    </div>
  );
};
