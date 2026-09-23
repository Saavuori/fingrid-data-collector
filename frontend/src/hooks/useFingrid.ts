import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import type { Dataset, InfluxStatus, SyncResult } from '../types';

/** The full Fingrid variable catalog. The backend caches it after login, so
 *  this is cheap to hold for the whole session — 249+ entries, rarely changes. */
export function useDatasets() {
  return useQuery({
    queryKey: ['datasets'],
    queryFn: async () => {
      const res = await axios.get('api/datasets');
      return (res.data.data ?? []) as Dataset[];
    },
    staleTime: 1000 * 60 * 60,
  });
}

const ACTIVE_KEY = ['activeDatasets'];

/** The IDs queued for InfluxDB export, plus a toggle that keeps the whole list
 *  in sync — the backend stores the selection as one array, not per dataset. */
export function useActiveDatasets() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ACTIVE_KEY,
    queryFn: async () => {
      const res = await axios.get('api/datasets/active');
      return (res.data ?? []) as number[];
    },
  });

  const ids = query.data ?? [];

  const toggle = useMutation({
    // Because each save posts the whole list, toggles run one at a time and
    // each starts from the list the previous one saved. Building the list
    // from the render's `ids` let two quick toggles each post a list that
    // was missing the other's change.
    scope: { id: 'activeDatasets' },
    mutationFn: async (id: number) => {
      const current = queryClient.getQueryData<number[]>(ACTIVE_KEY) ?? [];
      const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
      await axios.post('api/datasets/active', next);
      return next;
    },
    onSuccess: next => queryClient.setQueryData(ACTIVE_KEY, next),
  });

  return {
    ids,
    isLoading: query.isLoading,
    isActive: (id: number) => ids.includes(id),
    toggle: (id: number) => toggle.mutate(id),
    pendingId: toggle.isPending ? toggle.variables : undefined,
  };
}

const INFLUX_STATUS_KEY = ['influxStatus'];

/** Background collector status, polled while a view that shows it is open.
 *  A failed poll keeps the last known status. */
export function useInfluxStatus() {
  return useQuery({
    queryKey: INFLUX_STATUS_KEY,
    queryFn: async () => (await axios.get('api/influx/status')).data as InfluxStatus,
    refetchInterval: 15_000,
  });
}

/** Refreshes the collector status after something that changes it. */
export function useRefreshInfluxStatus() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: INFLUX_STATUS_KEY });
}

/** "Sync now": runs one sync on the backend and returns its outcome. */
export function useSyncNow() {
  const refreshStatus = useRefreshInfluxStatus();
  const mutation = useMutation({
    mutationFn: async () => (await axios.post('api/influx/sync')).data as SyncResult,
    onSettled: refreshStatus,
  });
  const result: SyncResult | null = mutation.isError
    ? { ok: false, points: 0, message: 'Sync request failed' }
    : mutation.data ?? null;

  return { sync: () => mutation.mutate(), syncing: mutation.isPending, result };
}
