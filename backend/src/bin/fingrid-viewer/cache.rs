//! Response cache shared by every visitor.
//!
//! A public page can draw far more traffic than one Fingrid key allows (one
//! call per two seconds, 10 000 a day), so visitors are only ever served from
//! here. A miss fetches once while anyone else asking for the same thing waits
//! for that result — a link shared widely costs one upstream call, not one per
//! visitor. If Fingrid fails, the last good copy is served instead.

use axum::body::Bytes;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Responses kept at most; the oldest goes first, pinned keys never. The
/// 30-day series of a 3-minute dataset is the largest at roughly half a
/// megabyte.
const MAX_ENTRIES: usize = 400;

/// Distinct responses allowed to queue for an upstream fetch. Each fetch takes
/// at least two seconds, so a longer queue would only produce timeouts.
/// Visitors waiting on a response someone else is already fetching do not
/// count against this.
const MAX_WAITING: usize = 12;

#[derive(Clone)]
pub struct Entry {
    pub body: Bytes,
    pub fetched_at: Instant,
    pub fetched_utc: DateTime<Utc>,
}

impl Entry {
    pub fn age(&self) -> Duration {
        self.fetched_at.elapsed()
    }
}

pub enum CacheError {
    /// Too many visitors already waiting, and nothing cached to fall back on.
    Busy,
    /// The fetch failed and nothing was cached to fall back on.
    Upstream(anyhow::Error),
    /// Served only from what the background refresher fetches, and it has
    /// not fetched it yet.
    NotReady,
}

pub struct Cache {
    entries: Mutex<HashMap<String, Entry>>,
    /// One lock per key being fetched, so visitors after the same response
    /// queue behind its one fetch instead of each taking a place in line.
    key_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Held for the whole of a fetch: fetches run one at a time, and a waiter
    /// whose key was filled while it queued is answered from the cache.
    fetch_lock: tokio::sync::Mutex<()>,
    waiting: AtomicUsize,
    /// Never evicted. Refetching these spends the reserved budget, so visitor
    /// traffic must not be able to push them out.
    pinned: &'static [&'static str],
}

/// Drops a key's lock from the map once nobody holds or waits on it.
struct KeyLock<'a> {
    map: &'a Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    key: &'a str,
}

impl Drop for KeyLock<'_> {
    fn drop(&mut self) {
        let mut map = self.map.lock().unwrap();
        // Only the map's own reference left: nobody is queued on this key.
        if map.get(self.key).is_some_and(|l| Arc::strong_count(l) == 1) {
            map.remove(self.key);
        }
    }
}

/// Decrements the queue count however the wait ends, a dropped request included.
struct Waiting<'a>(&'a AtomicUsize);

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Cache {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            key_locks: Mutex::new(HashMap::new()),
            fetch_lock: tokio::sync::Mutex::new(()),
            waiting: AtomicUsize::new(0),
            pinned: &[],
        }
    }

    pub fn with_pinned(mut self, keys: &'static [&'static str]) -> Self {
        self.pinned = keys;
        self
    }

    pub fn peek(&self, key: &str) -> Option<Entry> {
        self.entries.lock().unwrap().get(key).cloned()
    }

    fn fresh(&self, key: &str, ttl: Duration) -> Option<Entry> {
        self.peek(key).filter(|e| e.age() < ttl)
    }

    fn insert(&self, key: &str, body: Bytes) -> Entry {
        let entry = Entry { body, fetched_at: Instant::now(), fetched_utc: Utc::now() };
        let mut entries = self.entries.lock().unwrap();
        entries.insert(key.to_string(), entry.clone());
        while entries.len() > MAX_ENTRIES {
            let oldest = entries.iter()
                .filter(|(k, _)| !self.pinned.contains(&k.as_str()))
                .min_by_key(|(_, e)| e.fetched_at)
                .map(|(k, _)| k.clone());
            match oldest {
                Some(k) => { entries.remove(&k); }
                None => break,
            }
        }
        entry
    }

    /// The cached response for `key` if younger than `ttl`, otherwise a fresh
    /// one from `fetch`. The flag is true when a stale copy is served because
    /// the fetch failed or the queue was full.
    pub async fn get_or_fetch<F, Fut>(
        &self,
        key: &str,
        ttl: Duration,
        fetch: F,
    ) -> Result<(Entry, bool), CacheError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = anyhow::Result<Bytes>>,
    {
        if let Some(e) = self.fresh(key, ttl) {
            return Ok((e, false));
        }

        let key_lock = Arc::clone(self.key_locks.lock().unwrap().entry(key.to_string()).or_default());
        let _cleanup = KeyLock { map: &self.key_locks, key };
        // Owned guard: it holds the Arc and drops before `_cleanup` does.
        let _same_key = key_lock.lock_owned().await;
        // Whoever held the key before us may have just fetched it.
        if let Some(e) = self.fresh(key, ttl) {
            return Ok((e, false));
        }

        if self.waiting.fetch_add(1, Ordering::SeqCst) >= MAX_WAITING {
            self.waiting.fetch_sub(1, Ordering::SeqCst);
            return self.peek(key).map(|e| (e, true)).ok_or(CacheError::Busy);
        }
        let waiting = Waiting(&self.waiting);
        let _running = self.fetch_lock.lock().await;
        drop(waiting);

        if let Some(e) = self.fresh(key, ttl) {
            return Ok((e, false));
        }

        match fetch().await {
            Ok(body) => Ok((self.insert(key, body), false)),
            Err(err) => {
                tracing::warn!("Fetch for {} failed: {:#}", key, err);
                self.peek(key).map(|e| (e, true)).ok_or(CacheError::Upstream(err))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;

    #[tokio::test]
    async fn fresh_entries_are_not_refetched() {
        let cache = Cache::new();
        let calls = AtomicU32::new(0);
        for _ in 0..3 {
            let (e, stale) = cache.get_or_fetch("k", Duration::from_secs(60), || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(Bytes::from_static(b"x"))
            }).await.ok().unwrap();
            assert!(!stale);
            assert_eq!(&e.body[..], b"x");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_failed_refresh_serves_the_stale_copy() {
        let cache = Cache::new();
        let _ = cache.get_or_fetch("k", Duration::ZERO, || async { Ok(Bytes::from_static(b"old")) }).await;
        let (e, stale) = cache.get_or_fetch("k", Duration::ZERO, || async {
            Err(anyhow::anyhow!("down"))
        }).await.ok().unwrap();
        assert!(stale);
        assert_eq!(&e.body[..], b"old");
    }

    #[tokio::test]
    async fn a_failed_first_fetch_is_an_error() {
        let cache = Cache::new();
        let res = cache.get_or_fetch("k", Duration::ZERO, || async { Err(anyhow::anyhow!("down")) }).await;
        assert!(matches!(res, Err(CacheError::Upstream(_))));
    }

    #[tokio::test]
    async fn concurrent_misses_fetch_once() {
        let cache = Arc::new(Cache::new());
        let calls = Arc::new(AtomicU32::new(0));
        let mut tasks = Vec::new();
        for _ in 0..5 {
            let cache = Arc::clone(&cache);
            let calls = Arc::clone(&calls);
            tasks.push(tokio::spawn(async move {
                cache.get_or_fetch("k", Duration::from_secs(60), || async {
                    calls.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    Ok(Bytes::from_static(b"x"))
                }).await.is_ok()
            }));
        }
        for t in tasks {
            assert!(t.await.unwrap());
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn many_waiters_on_one_key_take_one_queue_place() {
        let cache = Arc::new(Cache::new());
        let calls = Arc::new(AtomicU32::new(0));
        let mut tasks = Vec::new();
        for _ in 0..(MAX_WAITING * 3) {
            let cache = Arc::clone(&cache);
            let calls = Arc::clone(&calls);
            tasks.push(tokio::spawn(async move {
                cache.get_or_fetch("k", Duration::from_secs(60), || async {
                    calls.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    Ok(Bytes::from_static(b"x"))
                }).await.is_ok()
            }));
        }
        for t in tasks {
            assert!(t.await.unwrap(), "a visitor was turned away");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(cache.key_locks.lock().unwrap().is_empty());
    }

    #[test]
    fn the_oldest_entry_is_evicted_first() {
        let cache = Cache::new();
        for i in 0..=MAX_ENTRIES {
            cache.insert(&i.to_string(), Bytes::new());
            std::thread::sleep(Duration::from_micros(10));
        }
        assert!(cache.peek("0").is_none());
        assert!(cache.peek(&MAX_ENTRIES.to_string()).is_some());
    }

    #[test]
    fn pinned_entries_are_never_evicted() {
        let cache = Cache::new().with_pinned(&["catalog"]);
        cache.insert("catalog", Bytes::new());
        for i in 0..=MAX_ENTRIES {
            std::thread::sleep(Duration::from_micros(10));
            cache.insert(&i.to_string(), Bytes::new());
        }
        assert!(cache.peek("catalog").is_some());
        assert!(cache.peek("0").is_none());
    }
}
