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

/** The IDs queued for InfluxDB export, plus a toggle that keeps the whole list
 *  in sync — the backend stores the selection as one array, not per dataset. */
export function useActiveDatasets() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['activeDatasets'],
    queryFn: async () => {
      const res = await axios.get('api/datasets/active');
      return (res.data ?? []) as number[];
    },
  });

  const ids = query.data ?? [];

  const toggle = useMutation({
    mutationFn: async (id: number) => {
      const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
      await axios.post('api/datasets/active', next);
      return next;
    },
    onSuccess: next => queryClient.setQueryData(['activeDatasets'], next),
  });

  return {
    ids,
    isLoading: query.isLoading,
    isActive: (id: number) => ids.includes(id),
    toggle: (id: number) => toggle.mutate(id),
    pendingId: toggle.isPending ? toggle.variables : undefined,
  };
}
