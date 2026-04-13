#![allow(
    clippy::cast_possible_truncation,
    clippy::ignored_unit_patterns
)]

use fastdrop_lib::node::FastDropNode;
use fastdrop_lib::transfer::{receiver, sender};
use iroh_blobs::ticket::BlobTicket;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::OnceLock;
use std::time::Duration;

const CHUNK_BYTES: usize = 1024 * 1024;

type TestResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

struct TransferFixture {
    _root: tempfile::TempDir,
    sender_node: FastDropNode,
    receiver_node: FastDropNode,
    source_path: PathBuf,
    receive_dir: PathBuf,
}

impl TransferFixture {
    async fn new_file(size: u64) -> TestResult<Self> {
        let root = tempfile::tempdir()?;
        let source_dir = root.path().join("source");
        let receive_dir = root.path().join("received");
        fs::create_dir_all(&source_dir)?;
        fs::create_dir_all(&receive_dir)?;

        let source_path = source_dir.join("payload.bin");
        create_pattern_file(&source_path, size)?;
        let (sender_node, receiver_node) = start_nodes(root.path()).await?;

        Ok(Self {
            _root: root,
            sender_node,
            receiver_node,
            source_path,
            receive_dir,
        })
    }

    async fn new_sparse_file(size: u64) -> TestResult<Self> {
        let root = tempfile::tempdir()?;
        let source_dir = root.path().join("source");
        let receive_dir = root.path().join("received");
        fs::create_dir_all(&source_dir)?;
        fs::create_dir_all(&receive_dir)?;

        let source_path = source_dir.join("payload.bin");
        create_sparse_file(&source_path, size)?;
        let (sender_node, receiver_node) = start_nodes(root.path()).await?;

        Ok(Self {
            _root: root,
            sender_node,
            receiver_node,
            source_path,
            receive_dir,
        })
    }

    async fn new_directory(file_count: usize, file_size: usize) -> TestResult<Self> {
        let root = tempfile::tempdir()?;
        let source_path = root.path().join("source-dir");
        let receive_dir = root.path().join("received");
        fs::create_dir_all(&source_path)?;
        fs::create_dir_all(&receive_dir)?;
        create_directory_fixture(&source_path, file_count, file_size)?;
        let (sender_node, receiver_node) = start_nodes(root.path()).await?;

        Ok(Self {
            _root: root,
            sender_node,
            receiver_node,
            source_path,
            receive_dir,
        })
    }

    async fn shutdown(&self) -> TestResult<()> {
        self.sender_node.shutdown().await?;
        self.receiver_node.shutdown().await?;
        Ok(())
    }
}

#[tokio::test]
async fn transfers_one_megabyte_end_to_end() -> TestResult<()> {
    run_file_transfer_smoke_test(1024 * 1024, false).await
}

#[tokio::test]
async fn transfers_directory_with_thousand_files_end_to_end() -> TestResult<()> {
    init_tracing();
    let fixture = TransferFixture::new_directory(1024, 4096).await?;
    let share = create_share(&fixture).await?;
    let receive = receive_share(&fixture, &share.ticket.to_string()).await?;
    let received_dir = fixture.receive_dir.join(file_name(&fixture.source_path)?);

    assert_eq!(receive.hash, share.hash.to_string());
    assert_eq!(
        directory_hashes(&fixture.source_path)?,
        directory_hashes(&received_dir)?
    );

    fixture.shutdown().await?;
    Ok(())
}

#[tokio::test]
#[ignore = "manual large transfer smoke test"]
async fn transfers_ten_megabytes_end_to_end() -> TestResult<()> {
    run_file_transfer_smoke_test(10 * 1024 * 1024, false).await
}

#[tokio::test]
#[ignore = "manual high-throughput smoke test"]
async fn transfers_hundred_megabytes_end_to_end() -> TestResult<()> {
    run_file_transfer_smoke_test(100 * 1024 * 1024, false).await
}

#[tokio::test]
#[ignore = "manual large-file smoke test"]
async fn transfers_one_gigabyte_end_to_end() -> TestResult<()> {
    run_file_transfer_smoke_test(1024 * 1024 * 1024, false).await
}

#[tokio::test]
#[ignore = "manual sparse-file smoke test"]
async fn transfers_ten_gigabytes_end_to_end() -> TestResult<()> {
    run_file_transfer_smoke_test(10 * 1024 * 1024 * 1024, true).await
}

async fn run_file_transfer_smoke_test(size: u64, sparse: bool) -> TestResult<()> {
    init_tracing();
    let fixture = if sparse {
        TransferFixture::new_sparse_file(size).await?
    } else {
        TransferFixture::new_file(size).await?
    };
    let share = create_share(&fixture).await?;
    let receive = receive_share(&fixture, &share.ticket.to_string()).await?;
    let destination_file = fixture.receive_dir.join(file_name(&fixture.source_path)?);

    assert_eq!(receive.size, size);
    assert_eq!(receive.hash, share.hash.to_string());
    assert_eq!(
        file_sha256(&fixture.source_path)?,
        file_sha256(&destination_file)?
    );

    fixture.shutdown().await?;
    Ok(())
}

async fn start_nodes(root: &Path) -> TestResult<(FastDropNode, FastDropNode)> {
    let sender_node =
        FastDropNode::start_with_dirs(root.join("sender-data"), root.join("sender-downloads"))
            .await?;
    let receiver_node =
        FastDropNode::start_with_dirs(root.join("receiver-data"), root.join("receiver-downloads"))
            .await?;
    Ok((sender_node, receiver_node))
}

async fn create_share(fixture: &TransferFixture) -> TestResult<sender::ShareOutcome> {
    eprintln!("creating share for {}", fixture.source_path.display());
    let share = tokio::time::timeout(
        Duration::from_secs(180),
        sender::create_share(&fixture.sender_node, vec![fixture.source_path.clone()]),
    )
    .await??;
    assert!(share.ticket.to_string().starts_with("blob"));
    Ok(share)
}

async fn receive_share(
    fixture: &TransferFixture,
    ticket_string: &str,
) -> TestResult<receiver::ReceiveOutcome> {
    eprintln!("receiving ticket {ticket_string}");
    let parsed_ticket = BlobTicket::from_str(ticket_string)?;
    tokio::time::timeout(
        Duration::from_secs(180),
        receiver::receive_ticket(
            &fixture.receiver_node,
            parsed_ticket,
            fixture.receive_dir.clone(),
        ),
    )
    .await?
    .map_err(Into::into)
}

fn file_name(path: &Path) -> TestResult<&std::ffi::OsStr> {
    path.file_name()
        .ok_or_else(|| "source path has no name".into())
}

fn create_pattern_file(path: &Path, size: u64) -> TestResult<()> {
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

    writer.flush()?;
    Ok(())
}

fn create_sparse_file(path: &Path, size: u64) -> TestResult<()> {
    let file = fs::File::create(path)?;
    file.set_len(size)?;
    Ok(())
}

fn create_directory_fixture(root: &Path, file_count: usize, file_size: usize) -> TestResult<()> {
    let mut state = 0x1234_5678_9abc_def0_u64;
    for index in 0..file_count {
        let bucket = format!("bucket-{index:04}", index = index / 64);
        let dir = root.join(bucket);
        fs::create_dir_all(&dir)?;
        let path = dir.join(format!("file-{index:04}.bin"));
        create_directory_file(&path, file_size, &mut state)?;
    }
    Ok(())
}

fn create_directory_file(path: &Path, size: usize, state: &mut u64) -> TestResult<()> {
    let file = fs::File::create(path)?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);
    let mut buffer = vec![0_u8; size];
    fill_pattern(&mut buffer, state);
    writer.write_all(&buffer)?;
    writer.flush()?;
    Ok(())
}

fn fill_pattern(buffer: &mut [u8], state: &mut u64) {
    for byte in buffer {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        *byte = (*state & 0xff) as u8;
    }
}

fn file_sha256(path: &Path) -> TestResult<String> {
    let file = fs::File::open(path)?;
    let mut reader = BufReader::with_capacity(CHUNK_BYTES, file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; CHUNK_BYTES];

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn directory_hashes(root: &Path) -> TestResult<Vec<(String, String)>> {
    let mut hashes = Vec::new();
    collect_directory_hashes(root, root, &mut hashes)?;
    hashes.sort();
    Ok(hashes)
}

fn collect_directory_hashes(
    root: &Path,
    current: &Path,
    hashes: &mut Vec<(String, String)>,
) -> TestResult<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_directory_hashes(root, &path, hashes)?;
            continue;
        }

        let relative = path
            .strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/");
        hashes.push((relative, file_sha256(&path)?));
    }
    Ok(())
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
