#![allow(
    clippy::used_underscore_binding,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::ignored_unit_patterns
)]

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use fastdrop_lib::node::FastDropNode;
use fastdrop_lib::transfer::{receiver, sender};
use iroh::endpoint::{RelayMode, TransportConfig};
use iroh::protocol::Router;
use iroh::Endpoint;
use iroh_blobs::net_protocol::Blobs;
use iroh_blobs::rpc::client::blobs::{DownloadMode, DownloadOptions, MemClient};
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::util::SetTagOption;
use std::fs;
use std::io::{BufWriter, Write};
use std::net::{Ipv4Addr, SocketAddrV4};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const BENCH_SIZE: u64 = 100 * 1024 * 1024;
const CHUNK_BYTES: usize = 1024 * 1024;
const DIRECTORY_FILE_COUNT: usize = 256;
const DIRECTORY_FILE_SIZE: u64 = 512 * 1024;
const MAX_CONCURRENT_STREAMS: u32 = 256;
const CONNECTION_WINDOW_BYTES: u32 = 8_388_608;
const STREAM_WINDOW_BYTES: u32 = 4_194_304;

struct AppFixture {
    _root: tempfile::TempDir,
    sender_node: FastDropNode,
    receiver_node: FastDropNode,
    receive_dir: PathBuf,
    ticket: BlobTicket,
}

struct MemoryNode {
    client: MemClient,
    router: Router,
}

struct MemoryFixture {
    _sender: MemoryNode,
    receiver: MemoryNode,
    ticket: BlobTicket,
}

#[derive(Clone, Copy)]
struct ReceivePhaseMetrics {
    total: Duration,
    download: Duration,
    export: Duration,
}

impl AppFixture {
    async fn new(size: u64) -> Self {
        let root = tempfile::tempdir().expect("bench tempdir");
        let source_dir = root.path().join("source");
        let receive_dir = root.path().join("received");
        fs::create_dir_all(&source_dir).expect("source dir");
        fs::create_dir_all(&receive_dir).expect("receive dir");

        let source_file = source_dir.join("payload.bin");
        create_pattern_file(&source_file, size).expect("source file");

        let sender_node = FastDropNode::start_with_dirs(
            root.path().join("sender-data"),
            root.path().join("sender-downloads"),
        )
        .await
        .expect("sender node");
        let receiver_node = FastDropNode::start_with_dirs(
            root.path().join("receiver-data"),
            root.path().join("receiver-downloads"),
        )
        .await
        .expect("receiver node");
        let share = sender::create_share(&sender_node, vec![source_file])
            .await
            .expect("share creation");
        let ticket = BlobTicket::from_str(&share.ticket.to_string()).expect("ticket parsing");

        Self {
            _root: root,
            sender_node,
            receiver_node,
            receive_dir,
            ticket,
        }
    }

    async fn shutdown(&self) {
        self.sender_node.shutdown().await.expect("sender shutdown");
        self.receiver_node
            .shutdown()
            .await
            .expect("receiver shutdown");
    }
}

impl MemoryNode {
    async fn new() -> Self {
        let endpoint = Endpoint::builder()
            .relay_mode(RelayMode::Disabled)
            .bind_addr_v4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .transport_config(tuned_transport_config())
            .bind()
            .await
            .expect("memory endpoint");
        let blobs = Blobs::memory().build(&endpoint);
        let client = blobs.client().clone();
        let router = Router::builder(endpoint)
            .accept(iroh_blobs::ALPN, blobs.clone())
            .spawn()
            .await
            .expect("memory router");
        Self { client, router }
    }

    async fn shutdown(&self) {
        self.router.shutdown().await.expect("memory shutdown");
    }
}

impl MemoryFixture {
    async fn new(payload: &[u8]) -> Self {
        let sender = MemoryNode::new().await;
        let receiver = MemoryNode::new().await;
        let add = sender
            .client
            .add_bytes(payload.to_vec())
            .await
            .expect("memory import");
        let ticket = BlobTicket::new(
            sender
                .router
                .endpoint()
                .node_addr()
                .await
                .expect("sender addr"),
            add.hash,
            add.format,
        )
        .expect("memory ticket");

        Self {
            _sender: sender,
            receiver,
            ticket,
        }
    }

    async fn shutdown(&self) {
        self.receiver.shutdown().await;
        self._sender.shutdown().await;
    }
}

fn transfer_benchmark(c: &mut Criterion) {
    init_tracing();
    let runtime = tokio::runtime::Runtime::new().expect("benchmark runtime");
    let payload = benchmark_payload();

    let share_warmup = runtime.block_on(run_share_preparation(BENCH_SIZE));
    let receive_warmup = runtime.block_on(run_app_receive_phases(BENCH_SIZE));
    let memory_warmup = runtime.block_on(run_memory_transport_transfer(payload));
    let directory_warmup = runtime.block_on(run_directory_share_preparation(
        DIRECTORY_FILE_COUNT,
        DIRECTORY_FILE_SIZE,
    ));
    eprintln!(
        "Sender prep 100MB: {:.2} MB/s in {:.2?}",
        mb_per_second(BENCH_SIZE, share_warmup),
        share_warmup
    );
    eprintln!(
        "Receive download 100MB: {:.2} MB/s in {:.2?}",
        mb_per_second(BENCH_SIZE, receive_warmup.download),
        receive_warmup.download
    );
    eprintln!(
        "Receive export 100MB: {:.2} MB/s in {:.2?}",
        mb_per_second(BENCH_SIZE, receive_warmup.export),
        receive_warmup.export
    );
    eprintln!(
        "App receive total 100MB: {:.2} MB/s in {:.2?}",
        mb_per_second(BENCH_SIZE, receive_warmup.total),
        receive_warmup.total
    );
    eprintln!(
        "Memory transport 100MB: {:.2} MB/s in {:.2?}",
        mb_per_second(BENCH_SIZE, memory_warmup),
        memory_warmup
    );
    eprintln!(
        "Directory prep {}x{}KB: {:.2?}",
        DIRECTORY_FILE_COUNT,
        DIRECTORY_FILE_SIZE / 1024,
        directory_warmup
    );

    let mut throughput_group = c.benchmark_group("lightning_p2p_100mb");
    throughput_group.sample_size(10);
    throughput_group.measurement_time(Duration::from_secs(20));
    throughput_group.throughput(Throughput::Bytes(BENCH_SIZE));
    throughput_group.bench_function("sender_share_prep", |b| {
        b.to_async(&runtime).iter_custom(|iters| async move {
            let mut total = Duration::ZERO;
            for _ in 0..iters {
                total += run_share_preparation(BENCH_SIZE).await;
            }
            total
        });
    });
    throughput_group.bench_function("receive_download_phase", |b| {
        b.to_async(&runtime).iter_custom(|iters| async move {
            let mut total = Duration::ZERO;
            for _ in 0..iters {
                total += run_app_receive_phases(BENCH_SIZE).await.download;
            }
            total
        });
    });
    throughput_group.bench_function("receive_export_phase", |b| {
        b.to_async(&runtime).iter_custom(|iters| async move {
            let mut total = Duration::ZERO;
            for _ in 0..iters {
                total += run_app_receive_phases(BENCH_SIZE).await.export;
            }
            total
        });
    });
    throughput_group.bench_function("receive_total", |b| {
        b.to_async(&runtime).iter_custom(|iters| async move {
            let mut total = Duration::ZERO;
            for _ in 0..iters {
                total += run_app_receive_phases(BENCH_SIZE).await.total;
            }
            total
        });
    });
    throughput_group.bench_function("memory_transport", |b| {
        let payload = payload.to_vec();
        b.to_async(&runtime).iter_custom(move |iters| {
            let payload = payload.clone();
            async move {
                let mut total = Duration::ZERO;
                for _ in 0..iters {
                    total += run_memory_transport_transfer(&payload).await;
                }
                total
            }
        });
    });
    throughput_group.finish();

    let mut directory_group = c.benchmark_group("lightning_p2p_directory_prep");
    directory_group.sample_size(10);
    directory_group.measurement_time(Duration::from_secs(20));
    let directory_total_bytes = DIRECTORY_FILE_COUNT as u64 * DIRECTORY_FILE_SIZE;
    directory_group.throughput(Throughput::Bytes(directory_total_bytes));
    directory_group.bench_with_input(
        BenchmarkId::new("sender_share_directory", DIRECTORY_FILE_COUNT),
        &DIRECTORY_FILE_COUNT,
        |b, &file_count| {
            b.to_async(&runtime).iter_custom(move |iters| async move {
                let mut total = Duration::ZERO;
                for _ in 0..iters {
                    total += run_directory_share_preparation(file_count, DIRECTORY_FILE_SIZE).await;
                }
                total
            });
        },
    );
    directory_group.finish();
}

async fn run_share_preparation(size: u64) -> Duration {
    let root = tempfile::tempdir().expect("share prep tempdir");
    let source_dir = root.path().join("source");
    fs::create_dir_all(&source_dir).expect("source dir");
    let source_file = source_dir.join("payload.bin");
    create_pattern_file(&source_file, size).expect("source file");

    let sender_node = FastDropNode::start_with_dirs(
        root.path().join("sender-data"),
        root.path().join("sender-downloads"),
    )
    .await
    .expect("sender node");
    let started = Instant::now();
    let _share = sender::create_share(&sender_node, vec![source_file])
        .await
        .expect("share creation");
    let elapsed = started.elapsed();
    sender_node.shutdown().await.expect("sender shutdown");
    elapsed
}

async fn run_directory_share_preparation(file_count: usize, file_size: u64) -> Duration {
    let root = tempfile::tempdir().expect("directory tempdir");
    let source_dir = root.path().join("source-tree");
    create_pattern_directory(&source_dir, file_count, file_size).expect("source tree");

    let sender_node = FastDropNode::start_with_dirs(
        root.path().join("sender-data"),
        root.path().join("sender-downloads"),
    )
    .await
    .expect("sender node");
    let started = Instant::now();
    let _share = sender::create_share(&sender_node, vec![source_dir])
        .await
        .expect("directory share creation");
    let elapsed = started.elapsed();
    sender_node.shutdown().await.expect("sender shutdown");
    elapsed
}

async fn run_app_receive_phases(size: u64) -> ReceivePhaseMetrics {
    let fixture = AppFixture::new(size).await;
    let started = Instant::now();
    let outcome = receiver::receive_ticket(
        &fixture.receiver_node,
        fixture.ticket.clone(),
        fixture.receive_dir.clone(),
    )
    .await
    .expect("app receive");
    let metrics = ReceivePhaseMetrics {
        total: started.elapsed(),
        download: Duration::from_millis(outcome.download_ms),
        export: Duration::from_millis(outcome.export_ms),
    };
    fixture.shutdown().await;
    metrics
}

async fn run_memory_transport_transfer(payload: &[u8]) -> Duration {
    let fixture = MemoryFixture::new(payload).await;
    let started = Instant::now();
    fixture
        .receiver
        .client
        .download_with_opts(
            fixture.ticket.hash(),
            DownloadOptions {
                format: fixture.ticket.format(),
                nodes: vec![fixture.ticket.node_addr().clone()],
                tag: SetTagOption::Auto,
                mode: DownloadMode::Direct,
            },
        )
        .await
        .expect("memory download")
        .finish()
        .await
        .expect("memory download finish");
    let elapsed = started.elapsed();
    assert!(
        fixture
            .receiver
            .client
            .has(fixture.ticket.hash())
            .await
            .expect("receiver has blob"),
        "downloaded blob missing from receiver store"
    );
    fixture.shutdown().await;
    elapsed
}

fn tuned_transport_config() -> TransportConfig {
    let mut config = TransportConfig::default();
    config.keep_alive_interval(Some(Duration::from_secs(1)));
    config.max_concurrent_bidi_streams(MAX_CONCURRENT_STREAMS.into());
    config.max_concurrent_uni_streams(MAX_CONCURRENT_STREAMS.into());
    config.send_window(u64::from(CONNECTION_WINDOW_BYTES));
    config.receive_window(CONNECTION_WINDOW_BYTES.into());
    config.stream_receive_window(STREAM_WINDOW_BYTES.into());
    config
}

fn benchmark_payload() -> &'static [u8] {
    static PAYLOAD: OnceLock<Vec<u8>> = OnceLock::new();
    PAYLOAD.get_or_init(|| {
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        let mut payload = vec![0_u8; BENCH_SIZE as usize];
        fill_pattern(&mut payload, &mut state);
        payload
    })
}

fn create_pattern_directory(root: &Path, file_count: usize, file_size: u64) -> std::io::Result<()> {
    fs::create_dir_all(root)?;
    for index in 0..file_count {
        let subdir = root.join(format!("batch-{:02}", index / 32));
        fs::create_dir_all(&subdir)?;
        create_pattern_file(&subdir.join(format!("payload-{index:03}.bin")), file_size)?;
    }
    Ok(())
}

fn create_pattern_file(path: &Path, size: u64) -> std::io::Result<()> {
    let file = fs::File::create(path)?;
    let mut writer = BufWriter::with_capacity(CHUNK_BYTES, file);
    let mut state = 0x9e37_79b9_7f4a_7c15_u64;
    let mut buffer = vec![0_u8; CHUNK_BYTES];
    let mut remaining = size;

    while remaining > 0 {
        fill_pattern(&mut buffer, &mut state);
        let chunk_len = remaining.min(CHUNK_BYTES as u64) as usize;
        writer.write_all(&buffer[..chunk_len])?;
        remaining -= chunk_len as u64;
    }

    writer.flush()
}

fn fill_pattern(buffer: &mut [u8], state: &mut u64) {
    for byte in buffer {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        *byte = (*state & 0xff) as u8;
    }
}

fn mb_per_second(bytes: u64, elapsed: Duration) -> f64 {
    if elapsed.is_zero() {
        return 0.0;
    }
    bytes as f64 / elapsed.as_secs_f64() / 1024.0 / 1024.0
}

fn init_tracing() {
    static TRACING: OnceLock<()> = OnceLock::new();
    let _ = TRACING.get_or_init(|| {
        let _ = tracing_subscriber::fmt()
            .with_env_filter("fastdrop=info,iroh=warn")
            .with_test_writer()
            .try_init();
    });
}

criterion_group!(benches, transfer_benchmark);
criterion_main!(benches);
