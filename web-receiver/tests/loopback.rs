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

#[tokio::test]
#[ignore = "needs live network; run with -- --ignored"]
async fn browser_engine_share_and_fetch_round_trip() {
    let payload_a = vec![0xA5_u8; 512 * 1024];
    let payload_b = b"lightning p2p browser loopback".to_vec();

    let mut sharer = Sharer::spawn().await.expect("sharer spawn");
    sharer
        .add_file("blob-a.bin".into(), payload_a.clone())
        .await
        .expect("stage a");
    sharer
        .add_file("note.txt".into(), payload_b.clone())
        .await
        .expect("stage b");
    let ticket = sharer.publish("loopback-share").await.expect("publish");
    assert!(ticket.starts_with("fd2:"), "ticket should be an fd2 envelope");

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
}
