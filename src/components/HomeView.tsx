import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  Laptop,
  Radar,
  Send,
  ShieldCheck,
  Smartphone,
  Wifi,
} from "lucide-react";
import type { View } from "../App";
import { formatBytes, formatSpeed } from "../lib/format";
import { useTransferStore, type TransferEntry } from "../stores/transferStore";

interface HomeViewProps {
  onNavigate: (view: View) => void;
}

function routeLabel(transfer: TransferEntry | null): string {
  if (!transfer) return "Ready for a direct connection";
  if (transfer.routeKind === "relay") return "Encrypted relay";
  if (transfer.routeKind === "mixed") return "Mixed route";
  if (transfer.routeKind === "direct") return "Direct connection";
  return transfer.phase === "connecting"
    ? "Finding the fastest route"
    : "Route warming";
}

function transferProgress(transfer: TransferEntry | null): number {
  if (!transfer || transfer.total <= 0) return 0;
  return Math.min(100, Math.max(0, (transfer.bytes / transfer.total) * 100));
}

export function HomeView({ onNavigate }: HomeViewProps) {
  const reduceMotion = useReducedMotion();
  const transfers = useTransferStore((state) => state.transfers);
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const transferList = Object.values(transfers);
  const transfer =
    transferList.find(
      (item) => item.status === "running" || item.status === "starting",
    ) ?? transferList.find((item) => item.status === "completed") ?? null;
  const progress = transferProgress(transfer);

  return (
    <section className="home-workspace" aria-labelledby="home-title">
      <header className="home-intro">
        <div>
          <p className="metric-label">Direct-first file transfer</p>
          <h1 id="home-title">Move files without the cloud.</h1>
          <p>Pick an action. Lightning P2P handles the route and verifies every byte.</p>
        </div>
        <button
          className="home-device-link"
          type="button"
          onClick={() => onNavigate("devices")}
        >
          <Wifi className="h-4 w-4" /> Nearby devices
          <ArrowRight className="h-4 w-4" />
        </button>
      </header>

      <div className="home-actions" aria-label="Transfer actions">
        <button
          className="home-action home-action-send"
          type="button"
          onClick={() => onNavigate("send")}
        >
          <span className="home-action-icon"><Send aria-hidden /></span>
          <span><strong>Send</strong><small>Choose files, a folder, or a nearby device</small></span>
          <ArrowRight className="home-action-arrow" aria-hidden />
        </button>
        <button
          className="home-action home-action-receive"
          type="button"
          onClick={() => onNavigate("receive")}
        >
          <span className="home-action-icon"><ArrowDownToLine aria-hidden /></span>
          <span><strong>Receive</strong><small>Paste a link, scan a QR code, or accept nearby</small></span>
          <ArrowRight className="home-action-arrow" aria-hidden />
        </button>
      </div>

      <div className={`transfer-route ${transfer ? "transfer-route-live" : ""}`}>
        <div className="route-heading">
          <div>
            <p className="metric-label">Live route</p>
            <h2>{transfer ? transfer.name : "Ready when you are"}</h2>
          </div>
          <span className={`route-kind route-kind-${transfer?.routeKind ?? "unknown"}`}>
            <Radar className="h-3.5 w-3.5" /> {routeLabel(transfer)}
          </span>
        </div>

        <div className="route-stage" aria-label={routeLabel(transfer)}>
          <span className="route-node"><Laptop aria-hidden /><small>This device</small></span>
          <div className="route-line">
            <motion.span
              className="route-progress"
              initial={false}
              animate={{ scaleX: transfer ? Math.max(progress / 100, 0.04) : 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            />
            {transfer && transfer.status !== "completed" && !reduceMotion ? (
              <span className="route-packet" aria-hidden />
            ) : null}
          </div>
          <span className="route-node"><Smartphone aria-hidden /><small>Receiver</small></span>
        </div>

        <div className="route-stats" aria-live="polite">
          <span><strong>{transfer ? `${progress.toFixed(0)}%` : "Idle"}</strong><small>Progress</small></span>
          <span><strong>{formatSpeed(transfer?.speedBps ?? 0)}</strong><small>Current speed</small></span>
          <span><strong>{transfer ? `${formatBytes(transfer.bytes)} / ${formatBytes(transfer.total)}` : `${nodeStatus.direct_address_count} direct addresses`}</strong><small>{transfer ? "Transferred" : "Network"}</small></span>
          <span className="route-verified"><strong>{transfer?.status === "completed" ? <Check /> : <ShieldCheck />}{transfer?.status === "completed" ? "Verified" : "BLAKE3"}</strong><small>Integrity</small></span>
        </div>
      </div>
    </section>
  );
}
