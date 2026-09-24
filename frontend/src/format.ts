/** Sync timestamps from the backend, shown in the viewer's own time zone. */

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export const fmtClock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

export const elapsed = (iso: string | null) => {
  if (!iso) return '';
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
};
