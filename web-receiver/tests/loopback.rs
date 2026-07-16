//! End-to-end loopback of the browser transfer engine, natively.
//!
//! Exercises the exact code both wasm surfaces run: a `Sharer` stages files
//! and publishes an `fd2:` ticket, a `Receiver` parses it, fetches over a
//! real iroh endpoint (n0 preset — relay + direct), and reads back
//! BLAKE3-verified bytes.
//!
//! Ignored by default because it needs live network + the n0 relay
//! infrastructure. Run explicitly with:
//!   cargo test --test loopback -- --ignored

use web_receiver::sender::Sharer;
use web_receiver::Receiver;

/// The streamed (chunked) import must produce the same staged content as the
/// buffered one — same BLAKE3 hash, same byte count. Local-only: binds an
/// endpoint but never touches the relay.
#[tokio::test]
async fn streamed_import_matches_buffered_import() {
    let payload: Vec<u8> = (0..1_500_000_u32).map(|i| (i % 251) as u8).collect();

    let mut buffered = Sharer::spawn().await.expect("buffered sharer spawn");
    buffered
        .add_file("payload.bin".into(), payload.clone())
        .await
        .expect("buffered add");

    let mut streamed = Sharer::spawn().await.expect("streamed sharer spawn");
    streamed.begin_file("payload.bin".into()).expect("begin");
    for chunk in payload.chunks(64 * 1024) {
        streamed.push_chunk(chunk.to_vec()).await.expect("chunk");
    }
    streamed.finish_file().await.expect("finish");

    assert_eq!(streamed.staged_bytes(), payload.len() as u64);
    assert_eq!(streamed.staged_bytes(), buffered.staged_bytes());
    assert_eq!(
        streamed.staged_hashes(),
        buffered.staged_hashes(),
        "chunked and buffered imports must hash identically"
    );
}

/// A second begin_file while one is in flight must be refused, and finishing
/// with nothing in flight must error instead of hanging.
#[tokio::test]
async fn streamed_import_guards_misuse() {
    let mut sharer = Sharer::spawn().await.expect("sharer spawn");
    assert!(sharer.finish_file().await.is_err());
    sharer.begin_file("a.bin".into()).expect("begin");
    assert!(sharer.begin_file("b.bin".into()).is_err());
    sharer.push_chunk(vec![1, 2, 3]).await.expect("chunk");
    sharer.finish_file().await.expect("finish");
    assert_eq!(sharer.staged_bytes(), 3);
}

#[tokio::test]
#[ignore = "needs live network; run with -- --ignored"]
async fn browser_engine_share_and_fetch_round_trip() {
    let payload_a = vec![0xA5_u8; 512 * 1024];
    let payload_b = b"lightning p2p browser loopback".to_vec();

    let mut sharer = Sharer::spawn().await.expect("sharer spawn");
    // Stage one file via the streamed path (what the browser UI uses) and one
    // via the buffered path, so both are proven over a real fetch.
    sharer.begin_file("blob-a.bin".into()).expect("begin a");
    for chunk in payload_a.chunks(128 * 1024) {
        sharer.push_chunk(chunk.to_vec()).await.expect("chunk a");
    }
    sharer.finish_file().await.expect("finish a");
    sharer
        .add_file("note.txt".into(), payload_b.clone())
        .await
        .expect("stage b");
    let ticket = sharer.publish("loopback-share").await.expect("publish");
    assert!(
        ticket.starts_with("fd2:"),
        "ticket should be an fd2 envelope"
    );

    let info = Receiver::inspect(&ticket).expect("inspect");
    assert_eq!(info.label, "loopback-share");
    assert_eq!(info.size, (payload_a.len() + payload_b.len()) as u64);

    let receiver = Receiver::spawn().await.expect("receiver spawn");
    let root = receiver.fetch(&ticket).await.expect("fetch");
    let files = receiver.list_collection(root).await.expect("list");
    assert_eq!(files.len(), 2);

    let a = files.iter().find(|f| f.name == "blob-a.bin").expect("a");
    let b = files.iter().find(|f| f.name == "note.txt").expect("b");
    assert_eq!(
        receiver.read_bytes(a.hash).await.expect("read a"),
        payload_a
    );
    assert_eq!(
        receiver.read_bytes(b.hash).await.expect("read b"),
        payload_b
    );

    // Shutdown must actually stop serving: a fresh receiver may not fetch.
    sharer.shutdown().await;
    let late = Receiver::spawn().await.expect("late receiver spawn");
    let outcome =
        tokio::time::timeout(std::time::Duration::from_secs(20), late.fetch(&ticket)).await;
    assert!(
        !matches!(outcome, Ok(Ok(_))),
        "fetch succeeded after shutdown — the share is still serving"
    );
}
