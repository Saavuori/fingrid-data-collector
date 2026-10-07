import { keepPreviousData, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import type { Dataset } from '../types';

/** `[epoch ms, value]`, oldest first. */
export type Point = [number, number];

export interface DashboardData {
  generatedAt: string;
  start: string;
  end: string;
  latest: Record<string, { t: number; v: number }>;
  series: Record<string, Point[]>;
}

export interface SeriesData {
  id: number;
  range: RangeKey;
  start: string;
  end: string;
  truncated: boolean;
  points: Point[];
}

export type RangeKey = '24h' | '3d' | '7d' | '30d';
export const RANGE_KEYS: RangeKey[] = ['24h', '3d', '7d', '30d'];
export const isRangeKey = (v: string | null): v is RangeKey => RANGE_KEYS.includes(v as RangeKey);

// Paths are relative so the app works under a reverse-proxy subpath.

/** The live front page. The server refreshes it from Fingrid every few
 *  minutes; polling here only picks that up. */
export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await axios.get<DashboardData>('api/dashboard', { timeout: 60_000 });
      return { data: res.data, stale: res.headers['x-data-stale'] === '1' };
    },
    refetchInterval: 60_000,
    retry: 3,
    retryDelay: attempt => Math.min(2000 * 2 ** attempt, 20_000),
    placeholderData: keepPreviousData,
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: async () => {
      const res = await axios.get<{ data: Dataset[] }>('api/datasets', { timeout: 60_000 });
      return res.data.data ?? [];
    },
    staleTime: 60 * 60 * 1000,
    retry: 2,
  });
}

export function useSeries(id: number, range: RangeKey) {
  return useQuery({
    queryKey: ['series', id, range],
    queryFn: async () => {
      const res = await axios.get<SeriesData>(`api/datasets/${id}/data`, {
        params: { range },
        timeout: 60_000,
      });
      return res.data;
    },
    staleTime: 60_000,
    retry: (count, err) =>
      count < 2 && !(axios.isAxiosError(err) && err.response?.status === 404),
    // Hold the previous range on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
}

export const seriesOf = (d: DashboardData | undefined, id: number): Point[] => d?.series[String(id)] ?? [];
export const latestOf = (d: DashboardData | undefined, id: number) => d?.latest[String(id)];
