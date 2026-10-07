import React, { useMemo } from 'react';
import { Button, Spinner, makeStyles, mergeClasses, shorthands } from '@fluentui/react-components';
import {
  ArrowRight16Regular,
  CheckmarkCircle20Filled,
  ErrorCircle20Filled,
  ErrorCircle24Regular,
  Warning20Filled,
  ArrowSync20Filled,
  QuestionCircle20Filled,
} from '@fluentui/react-icons';

import { usePalette, type Palette } from '../../theme';
import { Card, EmptyState } from '../../components/ui';
import { errorText } from '../../api';
import { useDashboard, usePrices, latestOf, seriesOf, type DashboardData, type Point, type PriceData } from '../api';
import { BORDERS, ID, MIX, seriesColor } from '../datasets';
import { useI18n } from '../i18n';
import { href } from '../router';
import { fmtClock, formatValue } from '../format';
import { Legend, Sparkline, TimeChart, type ChartSeries } from './charts';
import FlowMap from './FlowMap';

/** Status colours — reserved for state, never used for a series, and always
 *  shown with an icon and a label. */
const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };

const MAX_FILL_GAP = 30 * 60 * 1000;

/** The value in force at `t`: the last reading at or before it, if recent. */
function valueAt(points: Point[], t: number): number | undefined {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0 || t - points[found][0] > MAX_FILL_GAP) return undefined;
  return points[found][1];
}

const upTo = (points: Point[], t: number) => points.filter(p => p[0] <= t);
const from = (points: Point[], t: number) => points.filter(p => p[0] >= t);

/** Local midnight `days` days after the one starting the day `t` falls in. */
function midnight(t: number, days = 0): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** EUR/MWh as published, in the c/kWh households know. */
const toCents = (eurPerMwh: number) => eurPerMwh / 10;

interface DayStats {
  avg: number;
  min: Point;
  max: Point;
}

function dayStats(points: Point[]): DayStats | undefined {
  if (!points.length) return undefined;
  let min = points[0];
  let max = points[0];
  let sum = 0;
  for (const p of points) {
    if (p[1] < min[1]) min = p;
    if (p[1] > max[1]) max = p;
    sum += p[1];
  }
  return { avg: sum / points.length, min, max };
}

/** Today's and tomorrow's prices in c/kWh, by the visitor's calendar. */
function buildPrices(d: PriceData, now: number) {
  const step = (d.resolutionMinutes || 60) * 60 * 1000;
  const today = midnight(now);
  const tomorrow = midnight(now, 1);
  const dayAfter = midnight(now, 2);
  const cents: Point[] = d.points.map(([t, v]) => [t, toCents(v)]);
  const inDay = (a: number, b: number) => cents.filter(([t]) => t >= a && t < b);
  const shown = inDay(today, dayAfter);
  // The last price holds to the end of its period; close the final step.
  const last = shown[shown.length - 1];
  const chart: Point[] = last ? [...shown, [last[0] + step, last[1]]] : [];
  const current = cents.find(([t]) => t <= now && now < t + step);
  return {
    current: current?.[1],
    today: dayStats(inDay(today, tomorrow)),
    tomorrow: dayStats(inDay(tomorrow, dayAfter)),
    chart,
  };
}

type PriceView = ReturnType<typeof buildPrices>;

const useStyles = makeStyles({
  view: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    '@media (min-width: 768px)': {
      gap: '20px',
    },
  },
  head: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '0 4px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
    '@media (min-width: 768px)': {
      fontSize: '32px',
    },
  },
  subtitle: {
    display: 'block',
    marginTop: '6px',
    fontSize: '13px',
    color: 'var(--text-muted)',
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '36px',
    padding: '0 14px 0 10px',
    borderRadius: '999px',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    fontSize: '13px',
    fontWeight: 620,
    color: 'var(--text)',
    textDecoration: 'none',
  },
  pillLabel: {
    color: 'var(--text-muted)',
    fontWeight: 560,
  },
  banner: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    padding: '14px 16px',
    borderRadius: '16px',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    fontSize: '14px',
    lineHeight: 1.45,
  },
  bannerTitle: {
    display: 'block',
    fontWeight: 680,
  },
  bannerBody: {
    display: 'block',
    color: 'var(--text-muted)',
    fontSize: '13px',
  },

  kpis: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    '@media (min-width: 768px)': {
      gap: '16px',
    },
  },
  // Ranges rather than stacked min-widths: Griffel does not guarantee the
  // order media rules land in, so overlapping ones can override each other.
  kpisFive: {
    '@media (min-width: 768px) and (max-width: 1099px)': {
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    },
    '@media (min-width: 1100px)': {
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    },
  },
  // Six in a row need a little more width before the values crowd.
  kpisSix: {
    '@media (min-width: 768px) and (max-width: 1199px)': {
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    },
    '@media (min-width: 1200px)': {
      gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    },
  },
  kpi: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
    padding: '14px 16px 12px',
    borderRadius: '18px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-card)',
    color: 'inherit',
    textDecoration: 'none',
    transition: 'border-color 0.18s ease',
    ':hover': {
      ...shorthands.borderColor('var(--border-strong)'),
    },
  },
  kpiWide: {
    // The odd fifth tile spans the row on phones instead of sitting alone.
    gridColumn: '1 / -1',
    '@media (min-width: 768px)': {
      gridColumn: 'auto',
    },
  },
  kpiLabel: {
    fontSize: '12px',
    fontWeight: 620,
    color: 'var(--text-muted)',
  },
  kpiValue: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '5px',
    fontSize: '26px',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
    '@media (min-width: 768px)': {
      fontSize: '30px',
    },
  },
  kpiUnit: {
    fontSize: '13px',
    fontWeight: 600,
    letterSpacing: 0,
    color: 'var(--text-muted)',
  },
  kpiHint: {
    fontSize: '12px',
    color: 'var(--text-faint)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  kpiSpark: {
    marginTop: '6px',
  },

  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: '16px',
    '@media (min-width: 960px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '20px',
    },
  },
  wide: {
    '@media (min-width: 960px)': {
      gridColumn: '1 / -1',
    },
  },
  tallCard: {
    '@media (min-width: 960px)': {
      gridRow: 'span 2',
    },
  },
  cardInner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    height: '100%',
  },
  cardHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 680,
    letterSpacing: '-0.01em',
  },
  cardSubtitle: {
    display: 'block',
    marginTop: '2px',
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  open: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
    fontSize: '12px',
    fontWeight: 620,
    color: 'var(--accent)',
    textDecoration: 'none',
    ':hover': { textDecoration: 'underline' },
  },

  mixLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: '18px',
    '@media (min-width: 960px)': {
      gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)',
      gap: '28px',
    },
  },
  mixBar: {
    display: 'flex',
    gap: '2px',
    height: '14px',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '10px',
  },
  mixRows: {
    display: 'flex',
    flexDirection: 'column',
  },
  mixRow: {
    display: 'grid',
    gridTemplateColumns: '12px minmax(0, 1fr) auto 48px',
    alignItems: 'center',
    gap: '10px',
    minHeight: '36px',
    padding: '0 6px',
    margin: '0 -6px',
    borderRadius: '8px',
    fontSize: '13px',
    color: 'inherit',
    textDecoration: 'none',
    ':hover': { background: 'var(--surface-alt)' },
  },
  mixSwatch: {
    width: '12px',
    height: '12px',
    borderRadius: '3px',
  },
  mixName: {
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  mixValue: {
    fontWeight: 650,
    textAlign: 'right',
  },
  mixShare: {
    color: 'var(--text-faint)',
    textAlign: 'right',
  },
  mixTotal: {
    borderTop: '1px solid var(--border)',
    marginTop: '4px',
    paddingTop: '4px',
  },
  center: {
    display: 'flex',
    justifyContent: 'center',
    padding: '80px 0',
  },

  priceStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '14px 16px',
    '@media (min-width: 768px)': {
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    },
  },
  priceStat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  priceStatValue: {
    fontSize: '20px',
    fontWeight: 680,
    letterSpacing: '-0.02em',
    whiteSpace: 'nowrap',
  },
  priceNote: {
    fontSize: '13px',
    color: 'var(--text-muted)',
  },
});

// ── Pieces ───────────────────────────────────────────────────────────────────

const Kpi: React.FC<{
  label: string;
  value: string;
  unit: string;
  hint?: string;
  spark: Point[];
  color: string;
  /** The dataset page it opens; without one the tile is not a link. */
  to?: string;
  wide?: boolean;
}> = ({ label, value, unit, hint, spark, color, to, wide }) => {
  const styles = useStyles();
  const body = (
    <>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>
        {value}
        <span className={styles.kpiUnit}>{unit}</span>
      </span>
      <span className={styles.kpiHint}>{hint || ' '}</span>
      <div className={styles.kpiSpark}>
        <Sparkline points={spark} color={color} />
      </div>
    </>
  );
  const className = mergeClasses(styles.kpi, wide && styles.kpiWide);
  return to ? (
    <a className={className} href={to}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
};

const CardHead: React.FC<{ title: string; subtitle?: string; datasetId?: number }> = ({
  title,
  subtitle,
  datasetId,
}) => {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <div className={styles.cardHead}>
      <div>
        <h2 className={styles.cardTitle}>{title}</h2>
        {subtitle && <span className={styles.cardSubtitle}>{subtitle}</span>}
      </div>
      {datasetId != null && (
        <a className={styles.open} href={href(`/d/${datasetId}`)}>
          {t.openDataset} <ArrowRight16Regular />
        </a>
      )}
    </div>
  );
};

const StatePill: React.FC<{ state: number | undefined }> = ({ state }) => {
  const styles = useStyles();
  const { t } = useI18n();
  const palette = usePalette();
  const map: Record<number, { label: string; color: string; Icon: typeof CheckmarkCircle20Filled }> = {
    1: { label: t.state1, color: STATUS.good, Icon: CheckmarkCircle20Filled },
    2: { label: t.state2, color: STATUS.warning, Icon: Warning20Filled },
    3: { label: t.state3, color: STATUS.critical, Icon: ErrorCircle20Filled },
    4: { label: t.state4, color: STATUS.critical, Icon: ErrorCircle20Filled },
    5: { label: t.state5, color: palette.accent, Icon: ArrowSync20Filled },
  };
  const s = state != null ? map[Math.round(state)] : undefined;
  const Icon = s?.Icon ?? QuestionCircle20Filled;
  return (
    <a className={styles.pill} href={href(`/d/${ID.systemState}`)}>
      <Icon style={{ color: s?.color ?? palette.textFaint }} />
      <span className={styles.pillLabel}>{t.stateLabel}</span>
      {s?.label ?? t.stateUnknown}
    </a>
  );
};

const ShortageBanner: React.FC<{ level: number | undefined }> = ({ level }) => {
  const styles = useStyles();
  const { t } = useI18n();
  if (!level || level < 1) return null;
  const title = level >= 3 ? t.shortage3 : level >= 2 ? t.shortage2 : t.shortage1;
  const color = level >= 3 ? STATUS.critical : level >= 2 ? STATUS.serious : STATUS.warning;
  return (
    <div className={styles.banner} role="alert" style={{ borderColor: color }}>
      <Warning20Filled style={{ color, flexShrink: 0, marginTop: 1 }} />
      <span>
        <span className={styles.bannerTitle}>{title}</span>
        <span className={styles.bannerBody}>{t.shortageHint}</span>
      </span>
    </div>
  );
};

// ── Production mix ───────────────────────────────────────────────────────────

function buildMix(d: DashboardData, now: number, palette: Palette, label: (k: string) => string) {
  // The 3-minute consumption series sets the time grid; each source is read
  // at those instants, so the 15-minute solar estimate stacks cleanly.
  const grid = upTo(seriesOf(d, ID.consumption), now).map(p => p[0]);
  const sources = MIX.map(m => {
    const [main, ...extra] = m.ids.map(id => seriesOf(d, id));
    const points: Point[] = [];
    for (const t of grid) {
      const v = valueAt(main, t);
      if (v === undefined) continue;
      points.push([t, extra.reduce((sum, s) => sum + Math.max(0, valueAt(s, t) ?? 0), Math.max(0, v))]);
    }
    const latest = m.ids.reduce((sum, id, i) => {
      const l = latestOf(d, id)?.v;
      return i === 0 && l === undefined ? NaN : sum + Math.max(0, l ?? 0);
    }, 0);
    return { ...m, label: label(m.key), color: seriesColor(palette, m.slot), points, latest };
  });
  return sources;
}

const MixCard: React.FC<{ d: DashboardData; now: number }> = ({ d, now }) => {
  const styles = useStyles();
  const palette = usePalette();
  const { t, locale } = useI18n();

  const sources = useMemo(
    () => buildMix(d, now, palette, k => t[k as keyof typeof t] as string),
    [d, now, palette, t],
  );
  const total = sources.reduce((a, s) => a + (Number.isFinite(s.latest) ? s.latest : 0), 0);
  const consumption = upTo(seriesOf(d, ID.consumption), now);

  const series: ChartSeries[] = [
    ...sources.map(s => ({ key: s.key, label: s.label, color: s.color, points: s.points, kind: 'stack' as const })),
    { key: 'consumption', label: t.consumption, color: palette.text, points: consumption },
  ];

  return (
    <Card className={styles.wide}>
      <div className={styles.cardInner}>
        <CardHead title={t.mixTitle} subtitle={t.mixSubtitle} />
        <div className={styles.mixLayout}>
          <div>
            <div className={styles.mixBar} aria-hidden="true">
              {sources.map(s =>
                Number.isFinite(s.latest) && s.latest > 0 && total > 0 ? (
                  <span key={s.key} style={{ flex: s.latest / total, background: s.color }} />
                ) : null,
              )}
            </div>
            <div className={styles.mixRows}>
              {sources.map(s => (
                <a key={s.key} className={styles.mixRow} href={href(`/d/${s.ids[0]}`)}>
                  <span className={styles.mixSwatch} style={{ background: s.color }} />
                  <span className={styles.mixName}>{s.label}</span>
                  <span className={mergeClasses(styles.mixValue, 'tnum')}>
                    {Number.isFinite(s.latest) ? `${formatValue(s.latest, 0, locale)} MW` : '—'}
                  </span>
                  <span className={mergeClasses(styles.mixShare, 'tnum')}>
                    {Number.isFinite(s.latest) && total > 0
                      ? `${formatValue((s.latest / total) * 100, 0, locale)} %`
                      : ''}
                  </span>
                </a>
              ))}
              <div className={mergeClasses(styles.mixRow, styles.mixTotal)}>
                <span />
                <span className={styles.mixName}>{t.production}</span>
                <span className={mergeClasses(styles.mixValue, 'tnum')}>{formatValue(total, 0, locale)} MW</span>
                <span />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <TimeChart
              series={series}
              unit="MW"
              digits={0}
              size="tall"
              stackTotalLabel={t.production}
              ariaLabel={t.mixTitle}
            />
            <Legend
              items={[
                ...sources.map(s => ({ label: s.label, color: s.color, block: true })),
                { label: t.consumption, color: palette.text },
              ]}
            />
          </div>
        </div>
      </div>
    </Card>
  );
};

// ── Day-ahead price ──────────────────────────────────────────────────────────

const PriceStat: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => {
  const styles = useStyles();
  return (
    <div className={styles.priceStat}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={mergeClasses(styles.priceStatValue, 'tnum')}>{value}</span>
      <span className={mergeClasses(styles.kpiHint, 'tnum')}>{hint || ' '}</span>
    </div>
  );
};

const PriceCard: React.FC<{ prices: PriceView | undefined; stale: boolean; failed: boolean; now: number }> = ({
  prices,
  stale,
  failed,
  now,
}) => {
  const styles = useStyles();
  const palette = usePalette();
  const { t, locale } = useI18n();
  const c = (x: number | undefined) => `${x == null ? '—' : formatValue(x, 2, locale)} c/kWh`;
  const at = (p: Point | undefined) => (p ? fmtClock(p[0], locale) : undefined);
  const negative = prices?.chart.some(p => p[1] < 0);

  return (
    <Card className={styles.wide}>
      <div className={styles.cardInner}>
        <CardHead title={t.priceTitle} subtitle={t.priceSubtitle} />
        {!prices ? (
          failed ? (
            <span className={styles.priceNote}>{t.priceFailed}</span>
          ) : (
            <Spinner size="tiny" />
          )
        ) : (
          <>
            {stale && <span className={styles.priceNote}>{t.priceStale}</span>}
            <div className={styles.priceStats}>
              <PriceStat label={t.priceNow} value={c(prices.current)} />
              <PriceStat label={t.priceTodayAvg} value={c(prices.today?.avg)} />
              <PriceStat label={t.priceTodayLow} value={c(prices.today?.min[1])} hint={at(prices.today?.min)} />
              <PriceStat label={t.priceTodayHigh} value={c(prices.today?.max[1])} hint={at(prices.today?.max)} />
            </div>
            <TimeChart
              series={[{ key: 'price', label: t.price, color: palette.accent, points: prices.chart, step: true }]}
              unit="c/kWh"
              digits={2}
              now={now}
              reference={negative ? 0 : undefined}
              ariaLabel={t.priceTitle}
            />
            <span className={styles.priceNote}>
              {t.priceTomorrowAvg}: {prices.tomorrow ? c(prices.tomorrow.avg) : t.priceTomorrowPending}
            </span>
          </>
        )}
      </div>
    </Card>
  );
};

// ── View ─────────────────────────────────────────────────────────────────────

const NowView: React.FC = () => {
  const styles = useStyles();
  const palette = usePalette();
  const { t, locale } = useI18n();
  const { data, isLoading, isError, error, refetch } = useDashboard();
  const priceQuery = usePrices();
  const priceData = priceQuery.data;
  // Null once the server says prices are not configured: no tile, no card.
  const showPrices = priceData !== null;
  const generatedAt = data?.data.generatedAt;
  const prices = useMemo(
    () => (priceData && generatedAt ? buildPrices(priceData.data, new Date(generatedAt).getTime()) : undefined),
    [priceData, generatedAt],
  );

  if (isLoading) {
    return (
      <div className={styles.center}>
        <Spinner size="small" label={t.loading} />
      </div>
    );
  }
  if (!data) {
    return (
      <Card>
        <EmptyState
          icon={<ErrorCircle24Regular />}
          title={t.loadFailed}
          body={isError ? errorText(error, t.loadFailedBody) : t.loadFailedBody}
          action={
            <Button appearance="secondary" onClick={() => refetch()}>
              {t.retry}
            </Button>
          }
        />
      </Card>
    );
  }

  const d = data.data;
  const now = new Date(d.generatedAt).getTime();
  const v = (id: number) => latestOf(d, id)?.v;
  const day = (id: number) => upTo(seriesOf(d, id), now);
  const c0 = seriesColor(palette, 0);
  const c1 = seriesColor(palette, 1);

  const consumption = v(ID.consumption);
  const production = v(ID.production);
  const net = v(ID.netExport);
  const freq = v(ID.frequency);
  const co2 = v(ID.co2Consumption);
  const co2p = v(ID.co2Production);
  const peak = day(ID.consumption).reduce((m, p) => Math.max(m, p[1]), -Infinity);

  const mw = (x: number | undefined) => (x == null ? '—' : formatValue(x, 0, locale));
  const netLabel = net == null || Math.abs(net) < 1 ? t.netBalanced : net > 0 ? t.netExport : t.netImport;

  const forecastFrom = now - 15 * 60 * 1000;
  const balance: ChartSeries[] = [
    { key: 'c', label: t.consumption, color: c0, points: day(ID.consumption) },
    { key: 'cf', label: t.consumptionForecast, color: c0, points: from(seriesOf(d, ID.consumptionForecast), forecastFrom), dashed: true },
    { key: 'p', label: t.production, color: c1, points: day(ID.production) },
    { key: 'pf', label: t.productionForecast, color: c1, points: from(seriesOf(d, ID.productionForecast), forecastFrom), dashed: true },
  ];

  const emissions: ChartSeries[] = [
    { key: 'ec', label: t.emissions, color: c0, points: day(ID.co2Consumption) },
    { key: 'ep', label: t.emissionsProduction, color: c1, points: day(ID.co2Production) },
  ];

  return (
    <div className={mergeClasses(styles.view, 'animate-fade-in')}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{t.nowTitle}</h1>
          <span className={styles.subtitle}>
            {t.updated} {fmtClock(now, locale)} · {t.autoRefresh}
          </span>
        </div>
        <StatePill state={v(ID.systemState)} />
      </div>

      <ShortageBanner level={v(ID.shortage)} />
      {data.stale && (
        <div className={styles.banner}>
          <Warning20Filled style={{ color: STATUS.warning, flexShrink: 0 }} />
          <span className={styles.bannerBody}>{t.stale}</span>
        </div>
      )}

      <div className={mergeClasses(styles.kpis, showPrices ? styles.kpisSix : styles.kpisFive)}>
        <Kpi
          label={t.consumption}
          value={mw(consumption)}
          unit="MW"
          hint={Number.isFinite(peak) ? `${t.peak24h} ${mw(peak)} MW` : undefined}
          spark={day(ID.consumption)}
          color={c0}
          to={href(`/d/${ID.consumption}`)}
        />
        <Kpi
          label={t.production}
          value={mw(production)}
          unit="MW"
          hint={
            production != null && consumption
              ? `${formatValue((production / consumption) * 100, 0, locale)} % ${t.ofConsumption}`
              : undefined
          }
          spark={day(ID.production)}
          color={c1}
          to={href(`/d/${ID.production}`)}
        />
        <Kpi
          label={netLabel}
          value={mw(net == null ? undefined : Math.abs(net))}
          unit="MW"
          spark={day(ID.netExport)}
          color={palette.accent}
          to={href(`/d/${ID.netExport}`)}
        />
        <Kpi
          label={t.frequency}
          value={freq == null ? '—' : formatValue(freq, 3, locale)}
          unit="Hz"
          hint={
            freq == null
              ? undefined
              : `${freq >= 50 ? '+' : '−'}${formatValue(Math.abs(freq - 50) * 1000, 0, locale)} mHz ${t.fromNominal}`
          }
          spark={day(ID.frequency)}
          color={palette.accent}
          to={href(`/d/${ID.frequency}`)}
        />
        <Kpi
          label={t.emissions}
          value={co2 == null ? '—' : formatValue(co2, 0, locale)}
          unit="g/kWh"
          hint={co2p == null ? undefined : `${t.emissionsProduction} ${formatValue(co2p, 0, locale)} g/kWh`}
          spark={day(ID.co2Consumption)}
          color={palette.accent}
          to={href(`/d/${ID.co2Consumption}`)}
          wide={!showPrices}
        />
        {showPrices && (
          <Kpi
            label={t.price}
            value={prices?.current == null ? '—' : formatValue(prices.current, 2, locale)}
            unit="c/kWh"
            hint={
              prices?.today
                ? t.priceRange(formatValue(prices.today.min[1], 2, locale), formatValue(prices.today.max[1], 2, locale))
                : undefined
            }
            spark={prices?.chart ?? []}
            color={palette.accent}
          />
        )}
      </div>

      <div className={styles.grid}>
        <MixCard d={d} now={now} />

        <Card className={styles.wide}>
          <div className={styles.cardInner}>
            <CardHead title={t.balanceTitle} subtitle={t.balanceSubtitle} />
            <TimeChart series={balance} unit="MW" digits={0} now={now} ariaLabel={t.balanceTitle} />
            <Legend items={balance.map(s => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
          </div>
        </Card>

        {showPrices && (
          <PriceCard prices={prices} stale={!!priceData?.stale} failed={priceQuery.isError} now={now} />
        )}

        <Card className={styles.tallCard}>
          <div className={styles.cardInner}>
            <CardHead title={t.flowsTitle} subtitle={t.flowsSubtitle} />
            <FlowMap
              flows={BORDERS.map(b => ({ ...b, label: t[b.key] as string, value: v(b.id) })).filter(
                b => !b.optional || (b.value != null && Math.abs(b.value) >= 1),
              )}
            />
          </div>
        </Card>

        <Card>
          <div className={styles.cardInner}>
            <CardHead title={t.frequencyTitle} subtitle={t.frequencySubtitle} datasetId={ID.frequency} />
            <TimeChart
              series={[{ key: 'f', label: t.frequency, color: palette.accent, points: day(ID.frequency) }]}
              unit="Hz"
              digits={2}
              band={{ from: 49.9, to: 50.1 }}
              reference={50}
              size="short"
              ariaLabel={t.frequencyTitle}
            />
          </div>
        </Card>

        <Card>
          <div className={styles.cardInner}>
            <CardHead title={t.emissionsTitle} subtitle={t.emissionsSubtitle} datasetId={ID.co2Consumption} />
            <TimeChart series={emissions} unit="gCO₂/kWh" digits={0} size="short" ariaLabel={t.emissionsTitle} />
            <Legend items={emissions.map(s => ({ label: s.label, color: s.color }))} />
          </div>
        </Card>
      </div>
    </div>
  );
};

export default NowView;
