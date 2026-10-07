import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Spinner, makeStyles, mergeClasses } from '@fluentui/react-components';
import {
  Search24Regular,
  Filter24Regular,
  FilterDismiss24Regular,
  ErrorCircle24Regular,
  DocumentSearch24Regular,
  Dismiss20Regular,
  ChevronRight20Regular,
} from '@fluentui/react-icons';

import { errorText } from '../../api';
import type { Dataset } from '../../types';
import { Card, Chip, ChipRail, ChipWrap, EmptyState, Sheet } from '../../components/ui';
import { useCatalog } from '../api';
import { FEATURED_IDS } from '../datasets';
import { dsDescription, dsGroups, dsName, dsOtherName, dsPeriod, dsUnit, useI18n } from '../i18n';
import { href, useRoute } from '../router';

const useStyles = makeStyles({
  view: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  titleRow: {
    padding: '0 4px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
  },
  subtitle: {
    display: 'block',
    marginTop: '4px',
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  search: {
    flex: 1,
    minWidth: 0,
    borderRadius: '14px',
  },
  filterButton: {
    position: 'relative',
    flexShrink: 0,
    width: '44px',
    height: '44px',
    borderRadius: '14px',
  },
  filterDot: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--accent)',
  },
  list: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: '12px',
    '@media (min-width: 768px)': {
      gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      gap: '16px',
    },
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    color: 'inherit',
    textDecoration: 'none',
    ':hover': {
      background: 'var(--surface-alt)',
    },
  },
  cardBody: {
    flex: 1,
    padding: '14px 16px 12px',
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px',
    fontWeight: 650,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
  },
  live: {
    color: 'var(--signal)',
  },
  cardName: {
    marginTop: '4px',
    fontSize: '15px',
    fontWeight: 640,
    lineHeight: 1.3,
    letterSpacing: '-0.01em',
  },
  cardFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '10px 12px 10px 16px',
    borderTop: '1px solid var(--border)',
  },
  cardChips: {
    display: 'flex',
    gap: '6px',
    minWidth: 0,
    overflowX: 'auto',
  },
  chevron: {
    flexShrink: 0,
    color: 'var(--text-faint)',
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: '64px 0',
  },
  sheetSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '22px',
  },
  sheetLabel: {
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
  },
  sheetActions: {
    display: 'flex',
    gap: '10px',
  },
  sheetButton: {
    flex: 1,
    height: '46px',
    borderRadius: '14px',
    justifyContent: 'center',
  },
});

const featured = new Set(FEATURED_IDS);

const DatasetCard: React.FC<{ dataset: Dataset }> = ({ dataset }) => {
  const styles = useStyles();
  const { lang } = useI18n();
  const period = dsPeriod(dataset, lang);
  return (
    <Card padded={false}>
      <a className={styles.card} href={href(`/d/${dataset.id}`)}>
        <span className={styles.cardBody}>
          <span className={styles.cardMeta}>
            <span className="tnum">#{dataset.id}</span>
            {period && <span>· {period}</span>}
            {featured.has(dataset.id) && <span className={styles.live}>· live</span>}
          </span>
          <span className={mergeClasses(styles.cardName, 'clamp-2')}>{dsName(dataset, lang)}</span>
        </span>
        <span className={styles.cardFoot}>
          <span className={mergeClasses(styles.cardChips, 'no-scrollbar')}>
            {dsUnit(dataset, lang) && <Chip readOnly>{dsUnit(dataset, lang)}</Chip>}
            {dsGroups(dataset, lang).map(g => (
              <Chip key={g} readOnly>
                {g}
              </Chip>
            ))}
          </span>
          <ChevronRight20Regular className={styles.chevron} />
        </span>
      </a>
    </Card>
  );
};

const CatalogView: React.FC = () => {
  const styles = useStyles();
  const { t, lang } = useI18n();
  const { query, navigate } = useRoute();
  const { data: datasets, isLoading, isError, error, refetch } = useCatalog();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Filters live in the URL so a filtered view can be shared or bookmarked.
  const q = query.get('q') ?? '';
  const category = query.get('cat');
  const unit = query.get('unit');
  const liveOnly = query.get('live') === '1';

  // Typing updates a local copy at once and the URL a beat later.
  // When the URL changes from outside (Back, a chip link), the box follows.
  const [search, setSearch] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    setSearch(q);
  }

  const update = (patch: Record<string, string | null>) => {
    const next = { q, cat: category, unit, live: liveOnly ? '1' : null, ...patch };
    navigate(href('/explore', next), { replace: true });
  };

  useEffect(() => {
    if (search === q) return;
    const handle = setTimeout(
      () => navigate(href('/explore', { q: search, cat: category, unit, live: liveOnly ? '1' : null }), { replace: true }),
      250,
    );
    return () => clearTimeout(handle);
  }, [search, q, category, unit, liveOnly, navigate]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    datasets?.forEach(d => dsGroups(d, lang).forEach(g => set.add(g)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, lang));
  }, [datasets, lang]);

  const units = useMemo(() => {
    const set = new Set<string>();
    datasets?.forEach(d => {
      const u = dsUnit(d, lang);
      if (u) set.add(u);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, lang));
  }, [datasets, lang]);

  const filtered = useMemo(() => {
    if (!datasets) return [];
    const needle = q.trim().toLowerCase();
    return datasets.filter(d => {
      const matchesSearch =
        !needle ||
        dsName(d, lang).toLowerCase().includes(needle) ||
        dsOtherName(d, lang).toLowerCase().includes(needle) ||
        dsDescription(d, lang).toLowerCase().includes(needle) ||
        String(d.id) === needle;
      const matchesCategory = !category || dsGroups(d, lang).includes(category);
      const matchesUnit = !unit || dsUnit(d, lang) === unit;
      const matchesLive = !liveOnly || featured.has(d.id);
      return matchesSearch && matchesCategory && matchesUnit && matchesLive;
    });
  }, [datasets, q, category, unit, liveOnly, lang]);

  const filterCount = (category ? 1 : 0) + (unit ? 1 : 0) + (liveOnly ? 1 : 0);
  const clearAll = () => {
    setSearch('');
    navigate(href('/explore'), { replace: true });
  };

  return (
    <div className={mergeClasses(styles.view, 'animate-fade-in')}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>{t.exploreTitle}</h1>
        <span className={styles.subtitle}>
          {datasets ? t.exploreCount(filtered.length, datasets.length) : t.exploreSubtitle}
        </span>
      </div>

      <div className={styles.searchRow}>
        <Input
          className={styles.search}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          contentBefore={<Search24Regular />}
          contentAfter={
            search ? (
              <Button
                appearance="transparent"
                size="small"
                icon={<Dismiss20Regular />}
                onClick={() => {
                  setSearch('');
                  update({ q: null });
                }}
                aria-label={t.clearSearch}
              />
            ) : undefined
          }
          size="large"
          type="search"
          autoCapitalize="none"
          autoCorrect="off"
          aria-label={t.searchPlaceholder}
        />
        <Button
          appearance="secondary"
          className={styles.filterButton}
          icon={<Filter24Regular />}
          onClick={() => setSheetOpen(true)}
          aria-label={filterCount ? t.filtersActive(filterCount) : t.filters}
        >
          {filterCount > 0 && <span className={styles.filterDot} />}
        </Button>
      </div>

      {categories.length > 0 && (
        <ChipRail>
          <Chip active={!category && !liveOnly} onClick={() => update({ cat: null, live: null })}>
            {t.all}
          </Chip>
          <Chip active={liveOnly} onClick={() => update({ live: liveOnly ? null : '1' })}>
            {t.featured}
          </Chip>
          {categories.map(cat => (
            <Chip key={cat} active={category === cat} onClick={() => update({ cat: category === cat ? null : cat })}>
              {cat}
            </Chip>
          ))}
        </ChipRail>
      )}

      {isLoading ? (
        <div className={styles.loading}>
          <Spinner size="small" />
        </div>
      ) : isError ? (
        <Card>
          <EmptyState
            icon={<ErrorCircle24Regular />}
            title={t.catalogFailed}
            body={errorText(error, t.catalogFailedBody)}
            action={
              <Button appearance="secondary" onClick={() => refetch()}>
                {t.retry}
              </Button>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<DocumentSearch24Regular />}
            title={t.noMatches}
            body={t.noMatchesBody}
            action={
              filterCount > 0 || q ? (
                <Button appearance="secondary" icon={<FilterDismiss24Regular />} onClick={clearAll}>
                  {t.clearFilters}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className={styles.list}>
          {filtered.map(d => (
            <DatasetCard key={d.id} dataset={d} />
          ))}
        </div>
      )}

      <Sheet open={sheetOpen} title={t.filters} subtitle={t.matching(filtered.length)} onClose={() => setSheetOpen(false)}>
        <div className={styles.sheetSection}>
          <span className={styles.sheetLabel}>{t.category}</span>
          <ChipWrap>
            <Chip active={category === null} onClick={() => update({ cat: null })}>
              {t.all}
            </Chip>
            {categories.map(cat => (
              <Chip key={cat} active={category === cat} onClick={() => update({ cat })}>
                {cat}
              </Chip>
            ))}
          </ChipWrap>
        </div>

        <div className={styles.sheetSection}>
          <span className={styles.sheetLabel}>{t.unit}</span>
          <ChipWrap>
            <Chip active={unit === null} onClick={() => update({ unit: null })}>
              {t.all}
            </Chip>
            {units.map(u => (
              <Chip key={u} active={unit === u} onClick={() => update({ unit: u })}>
                {u}
              </Chip>
            ))}
          </ChipWrap>
        </div>

        <div className={styles.sheetActions}>
          <Button
            appearance="secondary"
            className={styles.sheetButton}
            onClick={() => update({ cat: null, unit: null, live: null })}
          >
            {t.reset}
          </Button>
          <Button appearance="primary" className={styles.sheetButton} onClick={() => setSheetOpen(false)}>
            {t.showResults}
          </Button>
        </div>
      </Sheet>
    </div>
  );
};

export default CatalogView;
