# Online Handoff Model

Lightning P2P can be shared online without changing the transfer architecture:
the web page is a handoff surface, and the native app remains the transfer
engine.

## What Runs Online

- Senders copy `https://lightning-p2p.netlify.app/receive#t=<ticket>`.
- The ticket is stored in the URL fragment, so normal HTTP requests do not send
  the ticket to Netlify logs.
- The receive page tries to open `lightning-p2p://receive?t=<ticket>`.
- If the native app is not installed, the page keeps the ticket in the browser
  and points the user to the installer.

## What Does Not Run Online

- No browser-to-browser file transfer.
- No WebRTC data channel.
- No HTTP file-transfer endpoint.
- No WebSocket transfer server.
- No cloud storage bucket.

## Why

The app's core promise depends on the Rust backend owning the transfer path:
iroh handles peer connectivity and relay fallback, and iroh-blobs handles
verified content-addressed streaming. A browser-only transfer mode would need a
different transport and would dilute the security, speed, and observability
model.

## Native Transfer Flow

```text
share link -> receive handoff page -> native deep link -> Tauri IPC -> Rust -> iroh ticket fetch
```

If direct connectivity works, iroh uses the direct QUIC path. If NAT or firewall
rules block direct dialing, iroh relay fallback preserves reachability. Relay
fallback is the compatibility path, not the speed path.

## Future Work

- Verified Android App Links for `/receive`.
- Windows clean-VM validation that HTTPS handoff opens the signed app.
- Benchmark rows for direct LAN, direct WAN, and relay fallback.
- Optional self-hosted iroh relay documentation for teams that want controlled
  infrastructure while keeping the same transfer protocol.
