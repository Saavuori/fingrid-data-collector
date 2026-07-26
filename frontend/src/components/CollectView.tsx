import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  Switch,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import {
  ArrowSync24Regular,
  ChevronRight20Regular,
  GlobeSearch24Regular,
  Database24Regular,
  DatabaseSearch24Regular,
  Clock24Regular,
  PlugConnected24Regular,
} from '@fluentui/react-icons';

import { usePalette } from '../theme';
import { useActiveDatasets, useDatasets } from '../hooks/useFingrid';
import type { InfluxStatus, SyncResult } from '../types';
import { Card, EmptyState, Row, RowList, StatTile } from './ui';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

const elapsed = (iso: string | null) => {
  if (!iso) return '';
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
};

const fmtClock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

// ── Styles ────────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  view: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
    padding: '0 4px',
  },
  subtitle: {
    display: 'block',
    marginTop: '4px',
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  groupLabel: {
    display: 'block',
    padding: '8px 4px 0',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
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
  syncButton: {
    width: '100%',
    height: '48px',
    borderRadius: '14px',
    justifyContent: 'center',
    fontWeight: 650,
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    borderTop: '1px solid var(--border)',
    ':first-child': {
      borderTop: 'none',
    },
  },
  itemButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    minWidth: 0,
    minHeight: '48px',
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  itemText: {
    minWidth: 0,
    flex: 1,
  },
  itemName: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 620,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemMeta: {
    display: 'block',
    marginTop: '2px',
    fontSize: '12px',
    color: 'var(--text-faint)',
  },
  messages: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px 0',
  },
});

// ── View ──────────────────────────────────────────────────────────────────────

const CollectView: React.FC<{
  onOpenDataset: (id: number) => void;
  onBrowseCatalog: () => void;
}> = ({ onOpenDataset, onBrowseCatalog }) => {
  const styles = useStyles();
  const palette = usePalette();
  const { data: datasets, isLoading: datasetsLoading } = useDatasets();
  const active = useActiveDatasets();

  const [status, setStatus] = useState<InfluxStatus | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get('api/influx/status');
        setStatus(res.data);
      } catch {
        /* transient — keep the last known status */
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await axios.post('api/influx/sync');
      setSyncResult(res.data);
      const st = await axios.get('api/influx/status');
      setStatus(st.data);
    } catch {
      setSyncResult({ ok: false, points: 0, message: 'Sync request failed' });
    } finally {
      setSyncing(false);
    }
  };

  // Keep the saved order so the list does not jump around between renders. An
  // ID with no catalog entry still gets a row — it is synced but unnamed.
  const activeDatasets = active.ids.map(id => ({
    id,
    dataset: datasets?.find(d => d.id === id) ?? null,
  }));

  const enabled = status?.enabled ?? false;

  return (
    <div className={mergeClasses(styles.view, 'animate-fade-in')}>
      <div>
        <h1 className={styles.title}>Collect</h1>
        <span className={styles.subtitle}>Variables written to InfluxDB by the background collector</span>
      </div>

      <div className={styles.statGrid}>
        <StatTile
          label="Variables"
          value={String(active.ids.length)}
          hint={active.ids.length === 1 ? 'dataset queued' : 'datasets queued'}
          icon={<Database24Regular fontSize={16} />}
          tint={palette.accentSoft}
          accent={palette.accent}
        />
        <StatTile
          label="Collector"
          value={enabled ? 'On' : 'Off'}
          hint={enabled ? 'running in background' : 'enable it in Settings'}
          icon={<PlugConnected24Regular fontSize={16} />}
          tint={enabled ? palette.signalSoft : palette.alertSoft}
          accent={enabled ? palette.signal : palette.alert}
        />
        <StatTile
          label="Last sync"
          value={elapsed(status?.last_sync ?? null) || '—'}
          hint={status?.last_sync ? fmtDate(status.last_sync) : 'never run'}
          icon={<ArrowSync24Regular fontSize={16} />}
          tint={palette.accentSoft}
        />
        <StatTile
          label="Next sync"
          value={fmtClock(status?.next_sync ?? null)}
          hint={enabled ? 'scheduled' : 'collector is off'}
          icon={<Clock24Regular fontSize={16} />}
          tint={palette.accentSoft}
        />
      </div>

      <Button
        appearance="primary"
        className={styles.syncButton}
        icon={syncing ? <Spinner size="tiny" /> : <ArrowSync24Regular />}
        onClick={handleSync}
        disabled={syncing || active.ids.length === 0}
      >
        {syncing ? 'Syncing…' : 'Sync now'}
      </Button>

      {(status?.error || syncResult) && (
        <div className={styles.messages}>
          {status?.error && (
            <MessageBar intent="error">
              <MessageBarBody>{status.error}</MessageBarBody>
            </MessageBar>
          )}
          {syncResult && (
            <MessageBar intent={syncResult.ok ? 'success' : 'error'}>
              <MessageBarBody>{syncResult.message}</MessageBarBody>
            </MessageBar>
          )}
        </div>
      )}

      <span className={styles.groupLabel}>Selected variables</span>

      {datasetsLoading || active.isLoading ? (
        <div className={styles.loading}>
          <Spinner size="small" label="Loading selection…" />
        </div>
      ) : active.ids.length === 0 ? (
        <Card>
          <EmptyState
            icon={<DatabaseSearch24Regular />}
            title="Nothing selected yet"
            body="Pick variables in Explore and they will be written to InfluxDB on every sync."
            action={
              <Button appearance="secondary" icon={<GlobeSearch24Regular />} onClick={onBrowseCatalog}>
                Browse the catalog
              </Button>
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          {activeDatasets.map(({ id, dataset }) => (
            <div key={id} className={styles.itemRow}>
              <button
                type="button"
                className={styles.itemButton}
                onClick={() => dataset && onOpenDataset(id)}
                disabled={!dataset}
              >
                <span className={styles.itemText}>
                  <span className={styles.itemName}>{dataset?.nameEn ?? `Dataset ${id}`}</span>
                  <span className={mergeClasses(styles.itemMeta, 'tnum')}>
                    #{id}
                    {dataset?.unitEn?.trim() ? ` · ${dataset.unitEn.trim()}` : ''}
                    {dataset ? '' : ' · not in the catalog'}
                  </span>
                </span>
                {dataset && <ChevronRight20Regular style={{ color: 'var(--text-faint)' }} />}
              </button>
              <Switch
                checked
                disabled={active.pendingId === id}
                onChange={() => active.toggle(id)}
                aria-label={`Stop collecting ${dataset?.nameEn ?? id}`}
              />
            </div>
          ))}
        </Card>
      )}

      {active.ids.length > 0 && (
        <Card padded={false}>
          <RowList>
            <Row label="Rate limit" value="1 request / 2 s" mono />
            <Row
              label="Estimated sync time"
              value={`≈ ${Math.max(1, Math.round(active.ids.length * 2.1))} s`}
              mono
            />
          </RowList>
        </Card>
      )}
    </div>
  );
};

export default CollectView;
