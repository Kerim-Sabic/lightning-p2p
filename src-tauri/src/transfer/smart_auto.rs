//! Session-local, bounded adaptation for `SmartAuto`'s source-import fanout.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

const INITIAL_FANOUT_CEILING: usize = 4;
const SAMPLES_PER_COMPARISON: usize = 3;
const COOLDOWN_SAMPLES: usize = 6;
const MIN_GAIN_PERCENT: u128 = 108;

static TUNER: OnceLock<Mutex<Tuner>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct Workload {
    average_file_size: u8,
    file_count: u8,
    total_size: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DecisionReason {
    Baseline,
    Exploring,
    Cooldown,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Selection {
    pub(crate) parallelism: usize,
    pub(crate) reason: DecisionReason,
    workload: Workload,
}

#[derive(Default)]
struct Tuner {
    workloads: HashMap<Workload, WorkloadState>,
}

struct WorkloadState {
    baseline_parallelism: usize,
    maximum_parallelism: usize,
    baseline_rates: VecDeque<u64>,
    trial_rates: VecDeque<u64>,
    cooldown: usize,
}

impl WorkloadState {
    fn new(maximum_parallelism: usize) -> Self {
        let baseline_parallelism = maximum_parallelism.clamp(1, INITIAL_FANOUT_CEILING);
        Self {
            baseline_parallelism,
            maximum_parallelism,
            baseline_rates: VecDeque::new(),
            trial_rates: VecDeque::new(),
            cooldown: 0,
        }
    }

    fn select(&self) -> (usize, DecisionReason) {
        if self.cooldown > 0 {
            return (self.baseline_parallelism, DecisionReason::Cooldown);
        }
        if self.baseline_parallelism < self.maximum_parallelism
            && self.baseline_rates.len() >= SAMPLES_PER_COMPARISON
            && self.trial_rates.len() < SAMPLES_PER_COMPARISON
        {
            (self.baseline_parallelism + 1, DecisionReason::Exploring)
        } else {
            (self.baseline_parallelism, DecisionReason::Baseline)
        }
    }

    fn record(&mut self, parallelism: usize, bytes_per_second: u64) -> Option<usize> {
        if self.cooldown > 0 {
            if parallelism == self.baseline_parallelism {
                self.cooldown -= 1;
                if self.cooldown == 0 {
                    self.baseline_rates.clear();
                }
            }
            return None;
        }

        if parallelism == self.baseline_parallelism {
            push_bounded(&mut self.baseline_rates, bytes_per_second);
            return None;
        }
        if parallelism != self.baseline_parallelism + 1 {
            return None;
        }

        push_bounded(&mut self.trial_rates, bytes_per_second);
        if self.trial_rates.len() < SAMPLES_PER_COMPARISON
            || self.baseline_rates.len() < SAMPLES_PER_COMPARISON
        {
            return None;
        }

        let baseline = median(&self.baseline_rates);
        let trial = median(&self.trial_rates);
        if u128::from(trial) * 100 >= u128::from(baseline) * MIN_GAIN_PERCENT {
            self.baseline_parallelism += 1;
            self.baseline_rates.clone_from(&self.trial_rates);
            tracing::info!(
                parallelism = self.baseline_parallelism,
                baseline_bytes_per_second = baseline,
                trial_bytes_per_second = trial,
                "SmartAuto promoted source-import fanout after measured gain"
            );
        } else {
            self.cooldown = COOLDOWN_SAMPLES;
            tracing::debug!(
                current_parallelism = self.baseline_parallelism,
                trial_parallelism = parallelism,
                baseline_bytes_per_second = baseline,
                trial_bytes_per_second = trial,
                "SmartAuto kept current fanout and entered exploration cooldown"
            );
        }
        self.trial_rates.clear();
        Some(self.baseline_parallelism)
    }
}

/// Selects a conservative per-batch fanout and records successful isolated samples.
pub(crate) fn select(source_count: usize, total_bytes: u64, heuristic_cap: usize) -> Selection {
    let workload = Workload::from_batch(source_count, total_bytes);
    let mut tuner = tuner()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let state = tuner
        .workloads
        .entry(workload)
        .or_insert_with(|| WorkloadState::new(heuristic_cap));
    state.maximum_parallelism = state.maximum_parallelism.min(heuristic_cap.max(1));
    state.baseline_parallelism = state
        .baseline_parallelism
        .min(state.maximum_parallelism)
        .max(1);
    let (parallelism, reason) = state.select();
    Selection {
        parallelism: source_count.min(parallelism),
        reason,
        workload,
    }
}

/// Records only successful, uncontended imports with enough data to compare.
pub(crate) fn record(selection: Selection, total_bytes: u64, elapsed: std::time::Duration) {
    if total_bytes < 32 * 1024 * 1024 || elapsed.is_zero() {
        return;
    }
    let elapsed_nanos = elapsed.as_nanos().max(1);
    let bytes_per_second = u64::try_from(
        (u128::from(total_bytes) * 1_000_000_000 / elapsed_nanos).min(u128::from(u64::MAX)),
    )
    .unwrap_or(u64::MAX);
    let mut tuner = tuner()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(promoted_to) = tuner
        .workloads
        .get_mut(&selection.workload)
        .and_then(|state| state.record(selection.parallelism, bytes_per_second))
    {
        tracing::debug!(promoted_to, "SmartAuto updated its session-local baseline");
    }
}

fn tuner() -> &'static Mutex<Tuner> {
    TUNER.get_or_init(|| Mutex::new(Tuner::default()))
}

fn push_bounded(samples: &mut VecDeque<u64>, value: u64) {
    if samples.len() == SAMPLES_PER_COMPARISON {
        samples.pop_front();
    }
    samples.push_back(value);
}

fn median(samples: &VecDeque<u64>) -> u64 {
    let mut ordered = samples.iter().copied().collect::<Vec<_>>();
    ordered.sort_unstable();
    ordered[ordered.len() / 2]
}

impl Workload {
    fn from_batch(source_count: usize, total_bytes: u64) -> Self {
        let count = source_count.max(1) as u64;
        let average = total_bytes / count;
        Self {
            average_file_size: if average <= 4 * 1024 * 1024 {
                0
            } else if average <= 64 * 1024 * 1024 {
                1
            } else {
                2
            },
            file_count: match source_count {
                0..=8 => 0,
                9..=32 => 1,
                _ => 2,
            },
            total_size: u8::try_from(u64::BITS - total_bytes.max(1).leading_zeros())
                .unwrap_or(u8::MAX),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{DecisionReason, WorkloadState};
    use std::collections::VecDeque;

    #[test]
    fn starts_conservatively_and_explores_one_step_at_a_time() {
        let mut state = WorkloadState::new(8);
        assert_eq!(state.baseline_parallelism, 4);
        assert_eq!(state.select(), (4, DecisionReason::Baseline));
        state.baseline_rates = VecDeque::from([100, 100, 100]);
        assert_eq!(state.select(), (5, DecisionReason::Exploring));
    }

    #[test]
    fn promotes_only_after_a_stable_measured_gain() {
        let mut state = WorkloadState::new(8);
        state.baseline_rates = VecDeque::from([100, 105, 101]);
        assert_eq!(state.record(5, 120), None);
        assert_eq!(state.record(5, 118), None);
        assert_eq!(state.record(5, 130), Some(5));
        assert_eq!(state.baseline_parallelism, 5);
        assert_eq!(state.select(), (6, DecisionReason::Exploring));
    }

    #[test]
    fn rejects_small_gain_and_observes_cooldown_hysteresis() {
        let mut state = WorkloadState::new(8);
        state.baseline_rates = VecDeque::from([100, 100, 100]);
        state.record(5, 103);
        state.record(5, 101);
        assert_eq!(state.record(5, 104), Some(4));
        assert_eq!(state.select(), (4, DecisionReason::Cooldown));
        for _ in 0..6 {
            state.record(4, 100);
        }
        assert_eq!(state.select(), (4, DecisionReason::Baseline));
    }

    #[test]
    fn caps_tuning_to_the_current_resource_heuristic() {
        let state = WorkloadState::new(2);
        assert_eq!(state.baseline_parallelism, 2);
        assert_eq!(state.select(), (2, DecisionReason::Baseline));
    }
}
