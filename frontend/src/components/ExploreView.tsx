import React, { useMemo, useState } from 'react';
import {
  Button,
  Input,
  Spinner,
  Switch,
  makeStyles,
  mergeClasses,
  shorthands,
} from '@fluentui/react-components';
import {
  Search24Regular,
  Filter24Regular,
  FilterDismiss24Regular,
  ErrorCircle24Regular,
  DocumentSearch24Regular,
  Dismiss20Regular,
} from '@fluentui/react-icons';

import { useDatasets, useActiveDatasets } from '../hooks/useFingrid';
import { errorText } from '../api';
import type { Dataset } from '../types';
import { Card, Chip, ChipRail, ChipWrap, EmptyState, SegmentedControl, Sheet } from './ui';
import DatasetDetail from './DatasetDetail';

type CollectFilter = 'all' | 'on' | 'off';

const COLLECT_OPTIONS: { value: CollectFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'on', label: 'Collecting' },
  { value: 'off', label: 'Not collecting' },
];

const useStyles = makeStyles({
  view: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
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
    gridTemplateColumns: '1fr',
    gap: '12px',
    '@media (min-width: 768px)': {
      gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      gap: '16px',
    },
  },
  cardCollecting: {
    ...shorthands.borderColor('var(--signal)'),
  },
  cardBody: {
    display: 'block',
    width: '100%',
    padding: '14px 16px 12px',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    ':hover': {
      background: 'var(--surface-alt)',
    },
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
  cardName: {
    display: '-webkit-box',
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
    padding: '10px 16px',
    borderTop: '1px solid var(--border)',
  },
  cardChips: {
    display: 'flex',
    gap: '6px',
    minWidth: 0,
    overflowX: 'auto',
  },
  collectingLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
    fontSize: '12px',
    fontWeight: 620,
    color: 'var(--text-faint)',
  },
  collectingOn: {
    color: 'var(--signal)',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
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

// ── Dataset card ──────────────────────────────────────────────────────────────

const DatasetCard: React.FC<{
  dataset: Dataset;
  collecting: boolean;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
}> = ({ dataset, collecting, busy, onOpen, onToggle }) => {
  const styles = useStyles();
  const categories = dataset.contentGroupsEn ?? [];

  return (
    <Card padded={false} className={collecting ? styles.cardCollecting : undefined}>
      <button type="button" className={styles.cardBody} onClick={onOpen}>
        <span className={styles.cardMeta}>
          <span className="tnum">#{dataset.id}</span>
          {dataset.dataPeriodEn && <span>· {dataset.dataPeriodEn}</span>}
        </span>
        <span className={mergeClasses(styles.cardName, 'clamp-2')}>{dataset.nameEn}</span>
      </button>

      <div className={styles.cardFoot}>
        <div className={mergeClasses(styles.cardChips, 'no-scrollbar')}>
          <Chip readOnly>{dataset.unitEn?.trim() || 'value'}</Chip>
          {categories.map(cat => (
            <Chip key={cat} readOnly>
              {cat}
            </Chip>
          ))}
        </div>
        <label className={mergeClasses(styles.collectingLabel, collecting && styles.collectingOn)}>
          <Switch
            checked={collecting}
            disabled={busy}
            onChange={onToggle}
            aria-label={`Collect ${dataset.nameEn}`}
          />
        </label>
      </div>
    </Card>
  );
};

// ── View ──────────────────────────────────────────────────────────────────────

const ExploreView: React.FC<{
  datasetId: number | null;
  onOpenDataset: (id: number | null) => void;
}> = ({ datasetId, onOpenDataset }) => {
  const styles = useStyles();
  const { data: datasets, isLoading, isError, error, refetch } = useDatasets();
  const active = useActiveDatasets();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [unit, setUnit] = useState<string | null>(null);
  const [collectFilter, setCollectFilter] = useState<CollectFilter>('all');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const categories = useMemo(() => {
    const set = new Set<string>();
    datasets?.forEach(d => d.contentGroupsEn?.forEach(g => set.add(g)));
    return Array.from(set).sort();
  }, [datasets]);

  const units = useMemo(() => {
    const set = new Set<string>();
    datasets?.forEach(d => {
      const cleaned = d.unitEn?.trim();
      if (cleaned) set.add(cleaned);
    });
    return Array.from(set).sort();
  }, [datasets]);

  const filtered = useMemo(() => {
    if (!datasets) return [];
    const needle = search.trim().toLowerCase();
    return datasets.filter(d => {
      const matchesSearch =
        !needle ||
        d.nameEn.toLowerCase().includes(needle) ||
        d.nameFi.toLowerCase().includes(needle) ||
        (d.descriptionEn ?? '').toLowerCase().includes(needle) ||
        String(d.id) === needle;

      const matchesCategory = !category || !!d.contentGroupsEn?.includes(category);
      const matchesUnit = !unit || d.unitEn?.trim() === unit;
      const matchesCollect =
        collectFilter === 'all' ||
        (collectFilter === 'on' ? active.isActive(d.id) : !active.isActive(d.id));

      return matchesSearch && matchesCategory && matchesUnit && matchesCollect;
    });
  }, [datasets, search, category, unit, collectFilter, active]);

  const filterCount = (category ? 1 : 0) + (unit ? 1 : 0) + (collectFilter !== 'all' ? 1 : 0);

  const clearFilters = () => {
    setCategory(null);
    setUnit(null);
    setCollectFilter('all');
  };

  // A dataset is open — the list gives way to its detail screen.
  const openDataset = datasets?.find(d => d.id === datasetId);
  if (datasetId !== null && openDataset) {
    return <DatasetDetail dataset={openDataset} onBack={() => onOpenDataset(null)} />;
  }

  return (
    <div className={mergeClasses(styles.view, 'animate-fade-in')}>
      <div className={styles.titleRow}>
        <div>
          <h1 className={styles.title}>Explore</h1>
          <span className={styles.subtitle}>
            {datasets ? `${filtered.length} of ${datasets.length} Fingrid variables` : 'Fingrid open data catalog'}
          </span>
        </div>
      </div>

      <div className={styles.searchRow}>
        <Input
          className={styles.search}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or ID…"
          contentBefore={<Search24Regular />}
          contentAfter={
            search ? (
              <Button
                appearance="transparent"
                size="small"
                icon={<Dismiss20Regular />}
                onClick={() => setSearch('')}
                aria-label="Clear search"
              />
            ) : undefined
          }
          size="large"
          type="search"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <Button
          appearance="secondary"
          className={styles.filterButton}
          icon={<Filter24Regular />}
          onClick={() => setFilterSheetOpen(true)}
          aria-label={filterCount ? `Filters (${filterCount} active)` : 'Filters'}
        >
          {filterCount > 0 && <span className={styles.filterDot} />}
        </Button>
      </div>

      {/* Quick category rail — the filter sheet holds the rest. */}
      {categories.length > 0 && (
        <ChipRail>
          <Chip active={category === null} onClick={() => setCategory(null)}>
            All
          </Chip>
          {categories.map(cat => (
            <Chip key={cat} active={category === cat} onClick={() => setCategory(cat)}>
              {cat}
            </Chip>
          ))}
        </ChipRail>
      )}

      {isLoading ? (
        <div className={styles.loading}>
          <Spinner size="small" label="Loading catalog…" />
        </div>
      ) : isError ? (
        <Card>
          <EmptyState
            icon={<ErrorCircle24Regular />}
            title="Could not load the catalog"
            body={errorText(error, 'Fingrid did not answer. Check your API key and try again.')}
            action={
              <Button appearance="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<DocumentSearch24Regular />}
            title="No matching variables"
            body="Try a different search term, or clear the filters."
            action={
              filterCount > 0 || search ? (
                <Button
                  appearance="secondary"
                  icon={<FilterDismiss24Regular />}
                  onClick={() => {
                    clearFilters();
                    setSearch('');
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className={styles.list}>
          {filtered.map(d => (
            <DatasetCard
              key={d.id}
              dataset={d}
              collecting={active.isActive(d.id)}
              busy={active.pendingId === d.id}
              onOpen={() => onOpenDataset(d.id)}
              onToggle={() => active.toggle(d.id)}
            />
          ))}
        </div>
      )}

      <Sheet
        open={filterSheetOpen}
        title="Filters"
        subtitle={`${filtered.length} variables match`}
        onClose={() => setFilterSheetOpen(false)}
      >
        <div className={styles.sheetSection}>
          <span className={styles.sheetLabel}>Collection</span>
          <SegmentedControl
            ariaLabel="Collection state"
            options={COLLECT_OPTIONS}
            value={collectFilter}
            onChange={setCollectFilter}
          />
        </div>

        <div className={styles.sheetSection}>
          <span className={styles.sheetLabel}>Category</span>
          <ChipWrap>
            <Chip active={category === null} onClick={() => setCategory(null)}>
              All
            </Chip>
            {categories.map(cat => (
              <Chip key={cat} active={category === cat} onClick={() => setCategory(cat)}>
                {cat}
              </Chip>
            ))}
          </ChipWrap>
        </div>

        <div className={styles.sheetSection}>
          <span className={styles.sheetLabel}>Unit</span>
          <ChipWrap>
            <Chip active={unit === null} onClick={() => setUnit(null)}>
              All
            </Chip>
            {units.map(u => (
              <Chip key={u} active={unit === u} onClick={() => setUnit(u)}>
                {u}
              </Chip>
            ))}
          </ChipWrap>
        </div>

        <div className={styles.sheetActions}>
          <Button appearance="secondary" className={styles.sheetButton} onClick={clearFilters}>
            Reset
          </Button>
          <Button
            appearance="primary"
            className={styles.sheetButton}
            onClick={() => setFilterSheetOpen(false)}
          >
            Show results
          </Button>
        </div>
      </Sheet>
    </div>
  );
};

export default ExploreView;
