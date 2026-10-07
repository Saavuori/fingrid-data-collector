import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { Button, Spinner, makeStyles, mergeClasses } from '@fluentui/react-components';
import {
  ArrowLeft24Regular,
  ArrowDownload20Regular,
  Share20Regular,
  ArrowTrendingLines24Regular,
  ArrowDown16Regular,
  ArrowUp16Regular,
  PulseSquare24Regular,
  ErrorCircle24Regular,
  DatabaseSearch24Regular,
  Info24Regular,
  Info16Regular,
  Open16Regular,
} from '@fluentui/react-icons';

import { usePalette } from '../../theme';
import { errorText } from '../../api';
import { Card, Chip, ChipRail, EmptyState, Row, RowList, SegmentedControl, StatTile } from '../../components/ui';
import { isRangeKey, useCatalog, useSeries, type Point, type RangeKey } from '../api';
import { dsDescription, dsGroups, dsName, dsOtherName, dsPeriod, dsUnit, useI18n } from '../i18n';
import { canGoBack, href, useRoute } from '../router';
import { csvFor, downloadText, downsample, fmtDateTime, formatValue, precisionFor } from '../format';
import { DataTable, TimeChart } from './charts';

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
  back: {
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
    gap: '14px',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
  },
  tools: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  dim: {
    opacity: 0.55,
    transition: 'opacity 0.2s ease',
  },
  skeleton: {
    height: '320px',
    borderRadius: '16px',
    background: 'var(--surface-alt)',
  },
  note: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
    fontSize: '12px',
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
    padding: '0 16px 12px',
    fontSize: '14px',
    lineHeight: 1.6,
    color: 'var(--text-muted)',
    whiteSpace: 'pre-line',
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: 'var(--accent)',
    textDecoration: 'none',
  },
  center: {
    display: 'flex',
    justifyContent: 'center',
    padding: '80px 0',
  },
});

type Mode = 'chart' | 'table';

const SeriesView: React.FC<{ id: number }> = ({ id }) => {
  const styles = useStyles();
  const palette = usePalette();
  const { t, lang, locale } = useI18n();
  const { query, navigate } = useRoute();
  const catalog = useCatalog();
  const [mode, setMode] = useState<Mode>('chart');
  const [copied, setCopied] = useState(false);

  const rangeParam = query.get('range');
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : '24h';
  const dataset = catalog.data?.find(d => d.id === id);
  const series = useSeries(id, range);

  const unit = dataset ? dsUnit(dataset, lang) || t.value : '';
  const points: Point[] = useMemo(() => series.data?.points ?? [], [series.data]);
  // When the window was read — splits measured rows from forecast ones.
  const now = series.dataUpdatedAt;

  const stats = useMemo(() => {
    // Statistics describe what has happened; forecast rows are left out.
    const past = points.filter(p => p[0] <= now);
    const base = past.length ? past : points;
    if (!base.length) return null;
    let min = base[0];
    let max = base[0];
    let sum = 0;
    for (const p of base) {
      if (p[1] < min[1]) min = p;
      if (p[1] > max[1]) max = p;
      sum += p[1];
    }
    return { latest: base[base.length - 1], min, max, avg: sum / base.length };
  }, [points, now]);

  const digits = useMemo(() => precisionFor(points.map(p => p[1])), [points]);
  const drawn = useMemo(() => downsample(points), [points]);
  const hasForecast = points.length > 0 && points[points.length - 1][0] > now;

  if (catalog.isLoading) {
    return (
      <div className={styles.center}>
        <Spinner size="small" />
      </div>
    );
  }

  if (!dataset) {
    return (
      <Card>
        <EmptyState
          icon={catalog.isError ? <ErrorCircle24Regular /> : <DatabaseSearch24Regular />}
          title={catalog.isError ? t.catalogFailed : t.notFound}
          body={catalog.isError ? errorText(catalog.error, t.catalogFailedBody) : t.notFoundBody}
          action={
            <Button appearance="secondary" onClick={() => navigate(href('/explore'))}>
              {t.navExplore}
            </Button>
          }
        />
      </Card>
    );
  }

  const name = dsName(dataset, lang);
  const period = dsPeriod(dataset, lang);
  const groups = dsGroups(dataset, lang);
  const description = dsDescription(dataset, lang);

  const goBack = () => {
    // Opened from inside the app → step back; opened from a shared link → catalog.
    if (canGoBack()) window.history.back();
    else navigate(href('/explore'));
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The share sheet was dismissed, or clipboard access was refused.
    }
  };

  const download = () =>
    downloadText(`fingrid-${id}-${range}.csv`, csvFor(points, `${dataset.nameEn} (${dataset.unitEn ?? ''})`));

  const notFound = axios.isAxiosError(series.error) && series.error.response?.status === 404;

  return (
    <div className={mergeClasses(styles.view, 'animate-fade-in')}>
      <div className={styles.head}>
        <Button
          appearance="subtle"
          shape="circular"
          className={styles.back}
          icon={<ArrowLeft24Regular />}
          onClick={goBack}
          aria-label={t.back}
        />
        <div className={styles.headText}>
          <h1 className={styles.title}>{name}</h1>
          <span className={styles.subtitle}>
            #{dataset.id} · {unit}
            {period ? ` · ${period}` : ''}
          </span>
        </div>
        <Button appearance="subtle" shape="circular" icon={<Share20Regular />} onClick={share} aria-label={t.share}>
          {copied ? t.copied : undefined}
        </Button>
      </div>

      {groups.length > 0 && (
        <ChipRail>
          {groups.map(g => (
            <Chip key={g} active={false} onClick={() => navigate(href('/explore', { cat: g }))}>
              {g}
            </Chip>
          ))}
        </ChipRail>
      )}

      <div className={styles.statGrid}>
        <StatTile
          label={t.latest}
          value={stats ? formatValue(stats.latest[1], digits, locale) : '—'}
          hint={stats ? fmtDateTime(stats.latest[0], locale) : unit}
          icon={<PulseSquare24Regular fontSize={16} />}
          tint={palette.accentSoft}
          accent={palette.accent}
        />
        <StatTile
          label={t.average}
          value={stats ? formatValue(stats.avg, digits, locale) : '—'}
          hint={unit}
          icon={<ArrowTrendingLines24Regular fontSize={16} />}
          tint={palette.accentSoft}
        />
        <StatTile
          label={t.lowest}
          value={stats ? formatValue(stats.min[1], digits, locale) : '—'}
          hint={stats ? fmtDateTime(stats.min[0], locale) : unit}
          icon={<ArrowDown16Regular fontSize={16} />}
          tint={palette.accentSoft}
        />
        <StatTile
          label={t.highest}
          value={stats ? formatValue(stats.max[1], digits, locale) : '—'}
          hint={stats ? fmtDateTime(stats.max[0], locale) : unit}
          icon={<ArrowUp16Regular fontSize={16} />}
          tint={palette.accentSoft}
        />
      </div>

      <Card>
        <div className={styles.chartCard}>
          <div className={styles.toolbar}>
            <SegmentedControl
              ariaLabel={t.rangeLabel}
              options={[
                { value: '24h', label: t.range24h },
                { value: '3d', label: t.range3d },
                { value: '7d', label: t.range7d },
                { value: '30d', label: t.range30d },
              ]}
              value={range}
              onChange={r => navigate(href(`/d/${id}`, { range: r === '24h' ? null : r }), { replace: true })}
            />
            <div className={styles.tools}>
              <SegmentedControl
                ariaLabel={`${t.chart} / ${t.table}`}
                options={[
                  { value: 'chart', label: t.chart },
                  { value: 'table', label: t.table },
                ]}
                value={mode}
                onChange={setMode}
              />
              <Button
                appearance="subtle"
                icon={<ArrowDownload20Regular />}
                onClick={download}
                disabled={!points.length}
                aria-label={t.downloadCsv}
                title={t.downloadCsv}
              />
            </div>
          </div>

          {series.isLoading ? (
            <div className={mergeClasses(styles.skeleton, 'animate-pulse')} />
          ) : series.isError && !series.data ? (
            <EmptyState
              icon={<ErrorCircle24Regular />}
              title={notFound ? t.notFound : t.previewFailed}
              body={errorText(series.error, t.previewFailedBody)}
              action={
                <Button appearance="secondary" onClick={() => series.refetch()}>
                  {t.retry}
                </Button>
              }
            />
          ) : points.length === 0 ? (
            <EmptyState icon={<DatabaseSearch24Regular />} title={t.noReadings} body={t.noReadingsBody} />
          ) : (
            <div className={series.isPlaceholderData ? styles.dim : undefined}>
              {mode === 'chart' ? (
                <TimeChart
                  series={[{ key: 'v', label: name, color: palette.accent, points: drawn, kind: 'area' }]}
                  unit={unit}
                  digits={digits}
                  now={now}
                  size="tall"
                  ariaLabel={name}
                />
              ) : (
                <DataTable points={points} unit={unit} digits={digits} />
              )}
            </div>
          )}

          {hasForecast && mode === 'chart' && (
            <span className={styles.note}>
              <Info16Regular style={{ flexShrink: 0 }} /> {t.forecastNote}
            </span>
          )}
          {series.data?.truncated && (
            <span className={styles.note}>
              <Info16Regular style={{ flexShrink: 0 }} /> {t.truncated}
            </span>
          )}
        </div>
      </Card>

      <Card padded={false}>
        <div className={styles.cardHeader}>
          <Info24Regular fontSize={18} style={{ color: palette.textMuted }} />
          {t.about}
        </div>
        {description && <p className={styles.description}>{description}</p>}
        <RowList>
          <Row label={t.datasetId} value={String(dataset.id)} mono />
          <Row label={t.unit} value={unit} />
          <Row label={t.interval} value={period || '—'} />
          <Row label={t.otherName} value={dsOtherName(dataset, lang)} />
          {groups.length > 0 && <Row label={t.categories} value={groups.join(', ')} />}
          <Row label={t.points} value={formatValue(points.length, 0, locale)} mono />
          <Row
            label={t.source}
            value={
              <a
                className={styles.link}
                href={`https://data.fingrid.fi/${lang}/datasets/${dataset.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {t.sourceLink} <Open16Regular />
              </a>
            }
          />
        </RowList>
      </Card>
    </div>
  );
};

export default SeriesView;
