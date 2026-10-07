import { useCallback, useSyncExternalStore } from 'react';

/** Hash routes, so every view has a shareable link and the app needs no
 *  server-side fallback — it works unchanged under a reverse-proxy subpath.
 *
 *    #/              Grid now
 *    #/explore?q=…   the catalog, search and filters in the query
 *    #/d/192?range=7d  one dataset
 */
export type Route =
  | { name: 'now' }
  | { name: 'explore' }
  | { name: 'dataset'; id: number };

const REPLACE_EVENT = 'viewer:replace';

/* Each history entry the app creates is stamped with its depth, so the Back
   button can tell an in-app step (go back) from a page opened straight from a
   shared link (go to the catalog instead of leaving the site). */
const depthOf = (state: unknown) =>
  typeof state === 'object' && state !== null && typeof (state as { depth?: unknown }).depth === 'number'
    ? (state as { depth: number }).depth
    : null;

let currentDepth = depthOf(history.state) ?? 0;
if (depthOf(history.state) === null) history.replaceState({ ...(history.state ?? {}), depth: 0 }, '');

window.addEventListener('hashchange', () => {
  const depth = depthOf(history.state);
  if (depth === null) {
    currentDepth += 1;
    history.replaceState({ ...(history.state ?? {}), depth: currentDepth }, '');
  } else {
    currentDepth = depth;
  }
});

export const canGoBack = () => (depthOf(history.state) ?? 0) > 0;

function parse(hash: string): { route: Route; query: URLSearchParams } {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  const query = new URLSearchParams(search);
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'explore') return { route: { name: 'explore' }, query };
  if (parts[0] === 'd' && /^\d+$/.test(parts[1] ?? '')) {
    return { route: { name: 'dataset', id: Number(parts[1]) }, query };
  }
  return { route: { name: 'now' }, query };
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  window.addEventListener(REPLACE_EVENT, onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener(REPLACE_EVENT, onChange);
  };
};

const getHash = () => window.location.hash;

/** Builds a hash link, dropping empty query values. */
export function href(path: string, query: Record<string, string | null | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const qs = params.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, getHash, () => '');
  const { route, query } = parse(hash);

  /** `replace` rewrites the current history entry — for search-as-you-type
   *  and range switches, so Back leaves the view rather than undoing them. */
  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    const target = to.startsWith('#') ? to : `#${to}`;
    if (opts.replace) {
      history.replaceState(history.state, '', target);
      window.dispatchEvent(new Event(REPLACE_EVENT));
    } else {
      window.location.hash = target;
    }
  }, []);

  return { route, query, navigate };
}
