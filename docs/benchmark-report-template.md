# Lightning P2P Benchmark Report Template

Use this template before publishing any "fastest" or "best" claim. Keep raw notes, failed attempts, and screenshots with the report so results can be repeated.

## Release Under Test

- Lightning P2P version:
- Commit hash:
- Build type: release / debug
- Installer path: NSIS / MSI / Velopack / source build
- Test date:

## Test Matrix

| Scenario | File set | Route | Sender network | Receiver network | Runs | Median speed | Failures |
|----------|----------|-------|----------------|------------------|------|--------------|----------|
| LAN direct | 1 GB single file | Direct | | | 5 | | |
| LAN direct | 10 GB single file | Direct | | | 5 | | |
| LAN direct | Many small files | Direct | | | 5 | | |
| WAN direct | 1 GB single file | Direct | | | 5 | | |
| WAN direct | 10 GB single file | Direct | | | 5 | | |
| Relay fallback | 1 GB single file | Relay | | | 5 | | |

## Hardware And Software

| Device | CPU | RAM | Disk | OS | Network adapter | App versions |
|--------|-----|-----|------|----|-----------------|--------------|
| Sender | | | | | | |
| Receiver | | | | | | |

## Network Conditions

- LAN type: Ethernet / Wi-Fi
- WAN route: same ISP / different ISP / VPN / hotspot
- Relay URL:
- Direct address count before test:
- Firewall profile:
- Background traffic notes:

## Competitor Baselines

| Tool | Version | Scenario | Median speed | Failures | Notes |
|------|---------|----------|--------------|----------|-------|
| LocalSend | | LAN direct | | | |
| PairDrop | | Browser transfer | | | |
| Snapdrop | | Browser/local transfer | | | |
| Windows Nearby Sharing | | OS nearby sharing | | | |
| Cloud upload/download | | Upload then download | | | |
| Magic Wormhole | | CLI encrypted transfer baseline | | | |

## Result Notes

- Median transfer time:
- Median throughput:
- Fastest run:
- Slowest successful run:
- Failure count and category:
- Route badge observed in app:
- Diagnostics copied before run:
- Diagnostics copied after run:

## Claim Decision

- Claim approved for website/README: yes / no
- Exact wording:
- Evidence link:
- Caveats:
