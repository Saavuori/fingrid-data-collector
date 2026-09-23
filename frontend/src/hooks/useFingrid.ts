import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import type { Dataset } from '../types';

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
