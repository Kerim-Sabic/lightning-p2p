use fastdrop_lib::node::FastDropNode;
use fastdrop_lib::transfer::{receiver, sender};
use iroh_blobs::ticket::BlobTicket;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::OnceLock;
use std::time::Duration;

type TestResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

struct TransferFixture {
    _root: tempfile::TempDir,
    sender_node: FastDropNode,
    receiver_node: FastDropNode,
    source_file: PathBuf,
    receive_dir: PathBuf,
}

impl TransferFixture {
    async fn new(size: usize) -> TestResult<Self> {
        let root = tempfile::tempdir()?;
        let source_dir = root.path().join("source");
        let receive_dir = root.path().join("received");
        fs::create_dir_all(&source_dir)?;
        fs::create_dir_all(&receive_dir)?;

        let source_file = source_dir.join("payload.bin");
        fs::write(&source_file, pseudo_random_bytes(size))?;

        let sender_node = FastDropNode::start_with_dirs(
            root.path().join("sender-data"),
            root.path().join("sender-downloads"),
        )
        .await?;
        let receiver_node = FastDropNode::start_with_dirs(
            root.path().join("receiver-data"),
            root.path().join("receiver-downloads"),
        )
        .await?;

        Ok(Self {
            _root: root,
            sender_node,
            receiver_node,
            source_file,
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
    run_transfer_smoke_test(1024 * 1024).await
}

#[tokio::test]
#[ignore = "manual large transfer smoke test"]
async fn transfers_ten_megabytes_end_to_end() -> TestResult<()> {
    run_transfer_smoke_test(10 * 1024 * 1024).await
}

async fn run_transfer_smoke_test(size: usize) -> TestResult<()> {
    init_tracing();
    let fixture = TransferFixture::new(size).await?;
    eprintln!("creating share for {} bytes", size);
    let share = tokio::time::timeout(
        Duration::from_secs(90),
        sender::create_share(&fixture.sender_node, vec![fixture.source_file.clone()]),
    )
    .await??;
    let ticket_string = share.ticket.to_string();
    assert!(ticket_string.starts_with("blob"));

    eprintln!("receiving ticket {}", ticket_string);
    let parsed_ticket = BlobTicket::from_str(&ticket_string)?;
    let receive = tokio::time::timeout(
        Duration::from_secs(90),
        receiver::receive_ticket(
            &fixture.receiver_node,
            parsed_ticket,
            fixture.receive_dir.clone(),
        ),
    )
    .await??;

    let destination_file = fixture.receive_dir.join(file_name(&fixture.source_file)?);
    assert_eq!(receive.size as usize, size);
    assert_eq!(receive.hash, share.hash.to_string());
    assert_eq!(file_sha256(&fixture.source_file)?, file_sha256(&destination_file)?);

    fixture.shutdown().await?;
    Ok(())
}

fn file_name(path: &Path) -> TestResult<&std::ffi::OsStr> {
    path.file_name()
        .ok_or_else(|| "source file has no name".into())
}

fn file_sha256(path: &Path) -> TestResult<String> {
    let bytes = fs::read(path)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn pseudo_random_bytes(size: usize) -> Vec<u8> {
    let mut state = 0x9e37_79b9_7f4a_7c15_u64;
    let mut bytes = Vec::with_capacity(size);
    for _ in 0..size {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        bytes.push((state & 0xff) as u8);
    }
    bytes
}

fn init_tracing() {
    static TRACING: OnceLock<()> = OnceLock::new();
    let _ = TRACING.get_or_init(|| {
        let _ = tracing_subscriber::fmt()
            .with_env_filter("info")
            .with_test_writer()
            .try_init();
    });
}
