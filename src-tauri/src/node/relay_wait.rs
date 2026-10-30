//! Bounded waiting for a relay route before a share ticket is minted.
//!
//! `Endpoint::online()` resolves once a relay handshake completes and pends
//! forever when no relay is reachable, so callers must bound it. The first
//! wait gets the full budget, which covers a cold start. When that wait times
//! out, the relay is evidently unreachable from this network (a corporate
//! firewall, a LAN without internet), and later shares re-check briefly
//! instead of stalling every ticket for the full budget. Any successful wait
//! restores the full budget.

use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// Full relay wait, long enough for iroh's first net report to finish.
const FULL_RELAY_WAIT: Duration = Duration::from_secs(6);
/// Re-check budget while a recent wait has already timed out.
const RECHECK_RELAY_WAIT: Duration = Duration::from_millis(500);
/// How long one timed-out wait shortens later waits.
const UNREACHABLE_MEMORY: Duration = Duration::from_secs(120);

/// Remembers whether the relay recently failed to come online.
#[derive(Debug, Default)]
pub(crate) struct RelayWaitMemory {
    last_timeout: Mutex<Option<Instant>>,
}

impl RelayWaitMemory {
    /// Returns how long the next relay wait may take.
    pub(crate) fn budget(&self, now: Instant) -> Duration {
        match *self.lock() {
            Some(at) if now.saturating_duration_since(at) < UNREACHABLE_MEMORY => {
                RECHECK_RELAY_WAIT
            }
            _ => FULL_RELAY_WAIT,
        }
    }

    /// Records the outcome of a bounded relay wait.
    pub(crate) fn record(&self, came_online: bool, now: Instant) {
        *self.lock() = (!came_online).then_some(now);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Instant>> {
        self.last_timeout
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_wait_gets_the_full_budget() {
        let memory = RelayWaitMemory::default();
        assert_eq!(memory.budget(Instant::now()), FULL_RELAY_WAIT);
    }

    #[test]
    fn a_recent_timeout_shortens_the_next_wait() {
        let memory = RelayWaitMemory::default();
        let now = Instant::now();
        memory.record(false, now);
        assert_eq!(
            memory.budget(now + Duration::from_secs(5)),
            RECHECK_RELAY_WAIT
        );
    }

    #[test]
    fn repeated_timeouts_keep_the_short_budget_sliding() {
        let memory = RelayWaitMemory::default();
        let start = Instant::now();
        memory.record(false, start);
        let later = start + Duration::from_secs(100);
        memory.record(false, later);
        assert_eq!(
            memory.budget(start + Duration::from_secs(200)),
            RECHECK_RELAY_WAIT
        );
    }

    #[test]
    fn the_full_budget_returns_after_the_memory_expires() {
        let memory = RelayWaitMemory::default();
        let now = Instant::now();
        memory.record(false, now);
        assert_eq!(
            memory.budget(now + UNREACHABLE_MEMORY + Duration::from_secs(1)),
            FULL_RELAY_WAIT
        );
    }

    #[test]
    fn coming_online_restores_the_full_budget() {
        let memory = RelayWaitMemory::default();
        let now = Instant::now();
        memory.record(false, now);
        memory.record(true, now + Duration::from_secs(1));
        assert_eq!(memory.budget(now + Duration::from_secs(2)), FULL_RELAY_WAIT);
    }
}
