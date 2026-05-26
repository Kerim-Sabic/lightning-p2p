//! Automated same-machine benchmark harness for Lightning P2P.
//!
//! Boots two `LightningP2PNode` instances in temp dirs (the
//! `LIGHTNING_P2P_PROFILE=alice` / `bob` story without env vars or a GUI),
//! runs the real `sender::create_share` + `receiver::receive_ticket` paths
//! against a generated payload, and emits a privacy-safe CSV + JSON report.
//!
//! This is NOT a substitute for a real-device benchmark report. It does not
//! measure WAN, relay, NAT traversal, Wi-Fi, Android, iOS, or hardware
//! variance. Treat the numbers as same-machine loopback throughput only.
//!
//! Usage:
//!   cargo run --release --bin benchmark-local -- [--runs N] [--profile smoke|full] [--output-dir <path>]
//!
//! Default profile is `smoke` (3 runs of a 10 MB transfer; ~30 s wall time).
//! `full` adds a 100 MB scenario; expect a few minutes on a workstation.
//!
//! Exit code 0 if every run succeeded, 1 otherwise. The report is always
//! written so a partial failure leaves evidence behind.

#![allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]

use lightning_p2p_lib::node::LightningP2PNode;
use lightning_p2p_lib::transfer::ticket::ShareTicket;
use lightning_p2p_lib::transfer::{receiver, sender, TransferMode};
use serde::Serialize;
use std::env;
use std::error::Error;
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CHUNK_BYTES: usize = 1024 * 1024;
/// Schema v2 adds `mode`, `hardware_notes`, and per-run `bottleneck_estimate`
/// alongside the v1 fields. Consumers that read v1 should treat new fields as
/// optional.
const REPORT_SCHEMA_VERSION: u32 = 2;

type BenchResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

#[derive(Clone, Copy)]
struct Scenario {
    name: &'static str,
    bytes: u64,
    /// Number of files to generate. `1` produces a single payload; `>1` splits
    /// `bytes` evenly across files for the "many small" cases.
    file_count: u32,
}

const SMOKE_SCENARIOS: &[Scenario] = &[Scenario {
    name: "same_machine_10mb",
    bytes: 10 * 1024 * 1024,
    file_count: 1,
}];

const FULL_SCENARIOS: &[Scenario] = &[
    Scenario {
        name: "same_machine_10mb",
        bytes: 10 * 1024 * 1024,
        file_count: 1,
    },
    Scenario {
        name: "same_machine_100mb",
        bytes: 100 * 1024 * 1024,
        file_count: 1,
    },
    Scenario {
        name: "same_machine_1gb",
        bytes: 1024 * 1024 * 1024,
        file_count: 1,
    },
    Scenario {
        name: "same_machine_many_small",
        bytes: 20 * 1024 * 1024,
        file_count: 200,
    },
];

#[derive(Clone, Serialize)]
struct RunResult {
    scenario: &'static str,
    run: u32,
    bytes: u64,
    time_to_ticket_ms: u128,
    connect_ms: u64,
    download_ms: u64,
    export_ms: u64,
    total_ms: u128,
    effective_mbps: f64,
    route_kind: String,
    bottleneck_estimate: &'static str,
    success: bool,
    error: Option<String>,
}

#[derive(Serialize)]
struct ScenarioSummary {
    scenario: &'static str,
    bytes: u64,
    runs: u32,
    successes: u32,
    failures: u32,
    median_total_ms: Option<u128>,
    median_download_ms: Option<u128>,
    median_export_ms: Option<u128>,
    median_effective_mbps: Option<f64>,
}

#[derive(Serialize)]
struct BenchmarkReport {
    schema_version: u32,
    generated_at_unix: u64,
    app_version: String,
    commit_hash: String,
    os: &'static str,
    arch: &'static str,
    /// Wire-format name of the TransferMode used for both peers in this run.
    mode: &'static str,
    /// Free-form hardware/network notes supplied by the operator via
    /// `--hardware-notes`. Empty string when unset.
    hardware_notes: String,
    harness: &'static str,
    transport: &'static str,
    caveats: Vec<&'static str>,
    summary: Vec<ScenarioSummary>,
    runs: Vec<RunResult>,
}

struct CliArgs {
    runs: u32,
    profile: String,
    output_dir: PathBuf,
    /// Optional comma-separated allowlist of scenario names. When present, only
    /// scenarios whose `name` matches are executed. Useful for tuning sweeps
    /// that should avoid re-running 1 GB just to retest many-small.
    scenarios: Option<Vec<String>>,
    /// Transfer mode used for both sender and receiver in this bench run.
    /// Defaults to Standard so the figures match user-default behavior.
    mode: TransferMode,
    /// Free-form hardware/network description that appears in the report.
    hardware_notes: String,
}

fn main() {
    let args = match parse_args() {
        Ok(args) => args,
        Err(error) => {
            eprintln!("benchmark-local: {error}");
            print_usage();
            std::process::exit(2);
        }
    };

    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("benchmark-local: failed to start tokio runtime: {error}");
            std::process::exit(1);
        }
    };

    let exit_code = runtime.block_on(run_all(args));
    std::process::exit(exit_code);
}

fn parse_args() -> Result<CliArgs, String> {
    let mut runs: u32 = 3;
    let mut profile = String::from("smoke");
    let mut output_dir = PathBuf::from("docs/reports/raw/local");
    let mut scenarios: Option<Vec<String>> = None;
    let mut mode = TransferMode::Standard;
    let mut hardware_notes = String::new();

    let mut iter = env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--runs" => {
                let value = iter.next().ok_or("--runs requires a value")?;
                runs = value
                    .parse()
                    .map_err(|_| "--runs must be a positive integer")?;
                if runs == 0 {
                    return Err("--runs must be at least 1".into());
                }
            }
            "--profile" => {
                let value = iter.next().ok_or("--profile requires a value")?;
                if value != "smoke" && value != "full" {
                    return Err(format!(
                        "--profile must be 'smoke' or 'full', got '{value}'"
                    ));
                }
                profile = value;
            }
            "--output-dir" => {
                let value = iter.next().ok_or("--output-dir requires a value")?;
                output_dir = PathBuf::from(value);
            }
            "--scenarios" => {
                let value = iter.next().ok_or("--scenarios requires a value")?;
                let parsed: Vec<String> = value
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                if parsed.is_empty() {
                    return Err("--scenarios requires at least one name".into());
                }
                scenarios = Some(parsed);
            }
            "--mode" => {
                let value = iter.next().ok_or("--mode requires a value")?;
                mode = TransferMode::from_wire(&value).ok_or_else(|| {
                    format!(
                        "--mode must be one of standard|fast|extreme|lan_beast|battery_safe, got '{value}'"
                    )
                })?;
            }
            "--hardware-notes" => {
                hardware_notes = iter
                    .next()
                    .ok_or("--hardware-notes requires a value")?;
            }
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(CliArgs {
        runs,
        profile,
        output_dir,
        scenarios,
        mode,
        hardware_notes,
    })
}

fn print_usage() {
    eprintln!(
        "usage: benchmark-local [--runs N] [--profile smoke|full] [--output-dir <path>] \
         [--scenarios name[,name...]] [--mode <m>] [--hardware-notes <text>]"
    );
    eprintln!();
    eprintln!("Defaults:");
    eprintln!("  --runs 3");
    eprintln!("  --profile smoke    (10 MB only; ~30 s wall time)");
    eprintln!("  --output-dir docs/reports/raw/local");
    eprintln!("  --mode standard");
    eprintln!();
    eprintln!("Profiles:");
    eprintln!("  smoke   one scenario (10 MB), CI-friendly");
    eprintln!(
        "  full    10 MB + 100 MB + 1 GB + many-small (200 x 100 KB); several minutes wall time"
    );
    eprintln!();
    eprintln!("Scenarios (selectable via --scenarios):");
    eprintln!("  same_machine_10mb, same_machine_100mb, same_machine_1gb,");
    eprintln!("  same_machine_many_small");
    eprintln!();
    eprintln!("Modes (selectable via --mode):");
    eprintln!("  standard, fast, extreme, lan_beast, battery_safe");
    eprintln!();
    eprintln!("Environment tuning hooks:");
    eprintln!("  LIGHTNING_P2P_IMPORT_PARALLELISM=N    cap concurrent file imports for sweep tests");
}

async fn run_all(args: CliArgs) -> i32 {
    let base_scenarios = if args.profile == "full" {
        FULL_SCENARIOS
    } else {
        SMOKE_SCENARIOS
    };

    let scenarios: Vec<&Scenario> = match &args.scenarios {
        None => base_scenarios.iter().collect(),
        Some(allowlist) => base_scenarios
            .iter()
            .filter(|s| allowlist.iter().any(|name| name == s.name))
            .collect(),
    };

    if scenarios.is_empty() {
        eprintln!("benchmark-local: no scenarios matched the filter");
        return 2;
    }

    eprintln!(
        "benchmark-local: profile={} scenarios={} runs_per_scenario={} mode={}",
        args.profile,
        scenarios.len(),
        args.runs,
        args.mode.as_str()
    );

    let mut runs = Vec::with_capacity(scenarios.len() * args.runs as usize);
    let mut any_failure = false;

    for scenario in &scenarios {
        eprintln!(
            "scenario={} bytes={} runs={}",
            scenario.name, scenario.bytes, args.runs
        );
        for run_index in 1..=args.runs {
            let result = run_one(scenario, run_index, args.mode).await;
            if !result.success {
                any_failure = true;
            }
            eprintln!(
                "  run={} total_ms={} download_ms={} export_ms={} effective_mbps={:.2} bottleneck={} success={}",
                result.run,
                result.total_ms,
                result.download_ms,
                result.export_ms,
                result.effective_mbps,
                result.bottleneck_estimate,
                result.success
            );
            runs.push(result);
        }
    }

    let summary = build_summary(&scenarios, &runs);
    let report = BenchmarkReport {
        schema_version: REPORT_SCHEMA_VERSION,
        generated_at_unix: unix_now(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        commit_hash: commit_hash(),
        os: env::consts::OS,
        arch: env::consts::ARCH,
        mode: args.mode.as_str(),
        hardware_notes: args.hardware_notes,
        harness: "same-machine-two-profile",
        transport: "iroh-loopback",
        caveats: vec![
            "Same-machine loopback only. Does not measure WAN, relay, NAT, or Wi-Fi.",
            "Single-process two-profile harness. Not equivalent to two separate devices.",
            "Throughput is bounded by local IO, CPU, and tokio scheduling, not network.",
            "Bottleneck estimate is a heuristic from timing ratios, not a flamegraph.",
            "Do not publish 'fastest' or comparison claims from this report.",
        ],
        summary,
        runs,
    };

    if let Err(error) = emit_report(&report, &args.output_dir) {
        eprintln!("benchmark-local: failed to write report: {error}");
        return 1;
    }

    let json = serde_json::to_string_pretty(&report).unwrap_or_else(|_| "{}".to_string());
    println!("{json}");

    if any_failure {
        1
    } else {
        0
    }
}

async fn run_one(scenario: &Scenario, run: u32, mode: TransferMode) -> RunResult {
    match execute_scenario(scenario, mode).await {
        Ok(metrics) => RunResult {
            scenario: scenario.name,
            run,
            bytes: scenario.bytes,
            time_to_ticket_ms: metrics.time_to_ticket.as_millis(),
            connect_ms: metrics.connect_ms,
            download_ms: metrics.download_ms,
            export_ms: metrics.export_ms,
            total_ms: metrics.total.as_millis(),
            effective_mbps: mbps(scenario.bytes, metrics.total),
            route_kind: metrics.route_kind,
            bottleneck_estimate: estimate_bottleneck(
                metrics.download_ms,
                metrics.export_ms,
                metrics.first_byte_ms,
            ),
            success: true,
            error: None,
        },
        Err(error) => RunResult {
            scenario: scenario.name,
            run,
            bytes: scenario.bytes,
            time_to_ticket_ms: 0,
            connect_ms: 0,
            download_ms: 0,
            export_ms: 0,
            total_ms: 0,
            effective_mbps: 0.0,
            route_kind: "unknown".to_string(),
            bottleneck_estimate: "unknown",
            success: false,
            error: Some(redact_error(&error.to_string())),
        },
    }
}

/// Coarse heuristic that maps the timing breakdown of a single run to a
/// human-readable bottleneck tag. Denominator is `download_ms + export_ms`
/// (`first_byte_ms` overlaps with download time and is measured against the
/// same denominator). Gates are tuned so the categories cover roughly:
///   - "first_byte"   first-byte latency >= 30% of total → peer setup dominates
///   - "export"       export_ms >= 30% of total          → per-file disk syscalls dominate
///   - "download"     download_ms > 75% of total         → transport/storage pipeline dominates
///   - "balanced"     none of the above passes its gate
///     (typical zone: download 50-75%, export < 30%, first_byte < 30%)
fn estimate_bottleneck(download_ms: u64, export_ms: u64, first_byte_ms: u64) -> &'static str {
    let total = download_ms.saturating_add(export_ms).max(1);
    let first_byte_pct = first_byte_ms.saturating_mul(100) / total;
    let export_pct = export_ms.saturating_mul(100) / total;
    let download_pct = download_ms.saturating_mul(100) / total;

    if first_byte_pct >= 30 {
        "first_byte"
    } else if export_pct >= 30 {
        "export"
    } else if download_pct > 75 {
        "download"
    } else {
        "balanced"
    }
}

struct ScenarioMetrics {
    time_to_ticket: Duration,
    connect_ms: u64,
    download_ms: u64,
    export_ms: u64,
    first_byte_ms: u64,
    total: Duration,
    route_kind: String,
}

async fn execute_scenario(
    scenario: &Scenario,
    mode: TransferMode,
) -> BenchResult<ScenarioMetrics> {
    let root = TempRoot::new("lightning-p2p-bench")?;
    let source_dir = root.path().join("source");
    let receive_dir = root.path().join("received");
    fs::create_dir_all(&source_dir)?;
    fs::create_dir_all(&receive_dir)?;

    let source_paths = create_scenario_payload(&source_dir, scenario)?;
    let profile = mode.profile();

    let sender_node = LightningP2PNode::start_with_dirs_and_relay(
        root.path().join("sender-data"),
        root.path().join("sender-downloads"),
        None,
        None,
        profile,
    )
    .await?;
    let receiver_node = LightningP2PNode::start_with_dirs_and_relay(
        root.path().join("receiver-data"),
        root.path().join("receiver-downloads"),
        None,
        None,
        profile,
    )
    .await?;

    let ticket_started = Instant::now();
    let share = sender::create_share(&sender_node, source_paths).await?;
    let parsed = ShareTicket::parse(&share.ticket.to_string())?;
    let time_to_ticket = ticket_started.elapsed();

    let total_started = Instant::now();
    let outcome = receiver::receive_ticket(&receiver_node, parsed, receive_dir.clone()).await?;
    let total = total_started.elapsed();

    sender_node.shutdown().await?;
    receiver_node.shutdown().await?;

    Ok(ScenarioMetrics {
        time_to_ticket,
        connect_ms: outcome.connect_ms,
        download_ms: outcome.download_ms,
        export_ms: outcome.export_ms,
        first_byte_ms: outcome.first_byte_ms,
        total,
        route_kind: format!("{:?}", outcome.route_kind).to_lowercase(),
    })
}

fn build_summary(scenarios: &[&Scenario], runs: &[RunResult]) -> Vec<ScenarioSummary> {
    scenarios
        .iter()
        .map(|scenario| {
            let scenario_runs: Vec<&RunResult> = runs
                .iter()
                .filter(|run| run.scenario == scenario.name)
                .collect();
            let successes: Vec<&RunResult> = scenario_runs
                .iter()
                .copied()
                .filter(|run| run.success)
                .collect();

            ScenarioSummary {
                scenario: scenario.name,
                bytes: scenario.bytes,
                runs: scenario_runs.len() as u32,
                successes: successes.len() as u32,
                failures: (scenario_runs.len() - successes.len()) as u32,
                median_total_ms: median_u128(successes.iter().map(|run| run.total_ms)),
                median_download_ms: median_u128(
                    successes.iter().map(|run| u128::from(run.download_ms)),
                ),
                median_export_ms: median_u128(
                    successes.iter().map(|run| u128::from(run.export_ms)),
                ),
                median_effective_mbps: median_f64(successes.iter().map(|run| run.effective_mbps)),
            }
        })
        .collect()
}

fn emit_report(report: &BenchmarkReport, output_dir: &Path) -> BenchResult<()> {
    fs::create_dir_all(output_dir)?;
    let stamp = report.generated_at_unix;

    let json_path = output_dir.join(format!("{stamp}-local.json"));
    let json = serde_json::to_string_pretty(report)?;
    fs::write(&json_path, json)?;

    let csv_path = output_dir.join(format!("{stamp}-local.csv"));
    write_csv(&csv_path, report)?;

    let latest_json = output_dir.join("latest.json");
    let _ = fs::copy(&json_path, &latest_json);
    let latest_csv = output_dir.join("latest.csv");
    let _ = fs::copy(&csv_path, &latest_csv);

    eprintln!("benchmark-local: wrote {}", json_path.display());
    eprintln!("benchmark-local: wrote {}", csv_path.display());
    Ok(())
}

fn write_csv(path: &Path, report: &BenchmarkReport) -> BenchResult<()> {
    let file = fs::File::create(path)?;
    let mut writer = BufWriter::new(file);
    writeln!(
        writer,
        "app_version,commit_hash,os,arch,mode,scenario,run,bytes,time_to_ticket_ms,connect_ms,download_ms,export_ms,total_ms,effective_mbps,route_kind,bottleneck_estimate,success,error,hardware_notes"
    )?;
    for run in &report.runs {
        writeln!(
            writer,
            "{},{},{},{},{},{},{},{},{},{},{},{},{},{:.4},{},{},{},{},{}",
            csv_escape(&report.app_version),
            csv_escape(&report.commit_hash),
            csv_escape(report.os),
            csv_escape(report.arch),
            csv_escape(report.mode),
            csv_escape(run.scenario),
            run.run,
            run.bytes,
            run.time_to_ticket_ms,
            run.connect_ms,
            run.download_ms,
            run.export_ms,
            run.total_ms,
            run.effective_mbps,
            csv_escape(&run.route_kind),
            csv_escape(run.bottleneck_estimate),
            run.success,
            csv_escape(run.error.as_deref().unwrap_or("")),
            csv_escape(&report.hardware_notes),
        )?;
    }
    writer.flush()?;
    Ok(())
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        let escaped = value.replace('"', "\"\"");
        format!("\"{escaped}\"")
    } else {
        value.to_string()
    }
}

fn redact_error(message: &str) -> String {
    message
        .lines()
        .map(|line| {
            line.split_whitespace()
                .map(|token| {
                    if token.starts_with("fd2:") || token.starts_with("blob") {
                        "[redacted-ticket]"
                    } else {
                        token
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn mbps(bytes: u64, elapsed: Duration) -> f64 {
    if elapsed.is_zero() {
        return 0.0;
    }
    let seconds = elapsed.as_secs_f64();
    (bytes as f64 * 8.0) / 1_000_000.0 / seconds
}

fn median_u128(values: impl Iterator<Item = u128>) -> Option<u128> {
    let mut values: Vec<u128> = values.collect();
    if values.is_empty() {
        return None;
    }
    values.sort_unstable();
    let middle = values.len() / 2;
    if values.len() % 2 == 1 {
        Some(values[middle])
    } else {
        Some((values[middle - 1] + values[middle]) / 2)
    }
}

fn median_f64(values: impl Iterator<Item = f64>) -> Option<f64> {
    let mut values: Vec<f64> = values.collect();
    if values.is_empty() {
        return None;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let middle = values.len() / 2;
    if values.len() % 2 == 1 {
        Some(values[middle])
    } else {
        Some((values[middle - 1] + values[middle]) / 2.0)
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn commit_hash() -> String {
    Command::new("git")
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn create_scenario_payload(source_dir: &Path, scenario: &Scenario) -> BenchResult<Vec<PathBuf>> {
    if scenario.file_count <= 1 {
        let source_file = source_dir.join("payload.bin");
        create_pattern_file(&source_file, scenario.bytes)?;
        return Ok(vec![source_file]);
    }

    let per_file = scenario.bytes / u64::from(scenario.file_count);
    if per_file == 0 {
        return Err("scenario file_count exceeds total bytes".into());
    }
    let mut paths = Vec::with_capacity(scenario.file_count as usize);
    for index in 0..scenario.file_count {
        let path = source_dir.join(format!("payload-{index:04}.bin"));
        create_pattern_file(&path, per_file)?;
        paths.push(path);
    }
    Ok(paths)
}

fn create_pattern_file(path: &Path, size: u64) -> BenchResult<()> {
    let file = fs::File::create(path)?;
    let mut writer = BufWriter::with_capacity(CHUNK_BYTES, file);
    let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut buffer = vec![0_u8; CHUNK_BYTES];
    let mut remaining = size;

    while remaining > 0 {
        for byte in &mut buffer {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            *byte = (state & 0xff) as u8;
        }
        let chunk_len = remaining.min(CHUNK_BYTES as u64) as usize;
        writer.write_all(&buffer[..chunk_len])?;
        remaining -= chunk_len as u64;
    }

    writer.flush()?;
    Ok(())
}

struct TempRoot {
    path: PathBuf,
}

impl TempRoot {
    fn new(prefix: &str) -> BenchResult<Self> {
        let stamp = unix_now();
        let pid = std::process::id();
        let path = env::temp_dir().join(format!("{prefix}-{stamp}-{pid}"));
        fs::create_dir_all(&path)?;
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::estimate_bottleneck;

    #[test]
    fn first_byte_wins_when_warmup_dominates() {
        // 60% first_byte → wins regardless of download/export split.
        assert_eq!(estimate_bottleneck(60, 40, 60), "first_byte");
    }

    #[test]
    fn export_wins_for_many_small_workloads() {
        // many-small bench: download ~ 50%, export ~ 50%, first byte negligible.
        assert_eq!(estimate_bottleneck(500, 500, 5), "export");
    }

    #[test]
    fn download_wins_for_large_single_file() {
        // 100 MB: export hardlink ~ 8 ms vs ~ 2000 ms download → download > 75%.
        assert_eq!(estimate_bottleneck(2000, 8, 5), "download");
    }

    #[test]
    fn balanced_when_no_axis_dominates() {
        // download 60ms (66%), export 25ms (28%), first_byte 15ms (16%):
        // no gate is crossed → balanced.
        assert_eq!(estimate_bottleneck(60, 25, 15), "balanced");
    }

    #[test]
    fn all_zero_input_falls_through_to_balanced() {
        assert_eq!(estimate_bottleneck(0, 0, 0), "balanced");
    }
}
