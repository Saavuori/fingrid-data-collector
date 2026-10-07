import { formatValue, precisionFor } from '../numbers';
import type { Point } from './api';

export { formatValue, precisionFor };

export const fmtNumber = (value: number, locale: string, digits = 0) =>
  formatValue(value, digits, locale);

export const fmtClock = (ms: number, locale: string) =>
  new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

export const fmtDateTime = (ms: number, locale: string) =>
  new Date(ms).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export const fmtDay = (ms: number, locale: string) =>
  new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

/** Axis ticks: a tick on local midnight names the day, any other the hour.
 *  Ticks come from timeTicks, so day-sized steps always land on midnight. */
export const tickFormatter = (locale: string) => (ms: number) => {
  const d = new Date(ms);
  return d.getHours() === 0 && d.getMinutes() === 0 ? fmtDay(ms, locale) : fmtClock(ms, locale);
};

/** Thins a long series for drawing while keeping every peak and trough: each
 *  bucket contributes its lowest and highest point, in time order. Stats are
 *  always computed on the full series, never on this. */
export function downsample(points: Point[], target = 1200): Point[] {
  if (points.length <= target) return points;
  const buckets = Math.floor(target / 2);
  const size = points.length / buckets;
  const out: Point[] = [];
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size);
    const to = Math.min(points.length, Math.floor((b + 1) * size));
    let lo = points[from];
    let hi = points[from];
    for (let i = from + 1; i < to; i++) {
      if (points[i][1] < lo[1]) lo = points[i];
      if (points[i][1] > hi[1]) hi = points[i];
    }
    if (lo === hi) out.push(lo);
    else if (lo[0] < hi[0]) out.push(lo, hi);
    else out.push(hi, lo);
  }
  return out;
}

/** Ticks on round local times spanning [from, to]: hour steps land on
 *  multiples of the step (00, 06, 12, 18), day steps on midnight. Stepping is
 *  done on the local calendar, so a DST change does not shift them. */
export function timeTicks(from: number, to: number, count: number): number[] {
  const span = to - from;
  if (span <= 0) return [from];
  const stepsH = [1, 2, 3, 4, 6, 12, 24, 48, 72, 96, 168, 336];
  const stepH = stepsH.find(h => span / (h * 3600 * 1000) <= count) ?? stepsH[stepsH.length - 1];
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  if (stepH >= 24) d.setHours(0);
  else d.setHours(Math.floor(d.getHours() / stepH) * stepH);
  const ticks: number[] = [];
  while (d.getTime() <= to) {
    if (d.getTime() >= from) ticks.push(d.getTime());
    if (stepH >= 24) d.setDate(d.getDate() + stepH / 24);
    else d.setHours(d.getHours() + stepH);
  }
  return ticks;
}

export function csvFor(points: Point[], valueHeader: string): string {
  const rows = points.map(([t, v]) => `${new Date(t).toISOString()},${v}`);
  return [`time_utc,${valueHeader.replace(/[",\n]/g, ' ')}`, ...rows].join('\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
