import {
  AlertTriangle,
  Check,
  Download,
  FileDown,
  Globe,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import {
  BrowserReceiver,
  type CollectionFile,
  hasSaveFilePicker,
  inspectTicket,
  saveBytes,
  type TicketInfo,
} from "../lib/webReceiver";

// The blob lives in WASM memory (~2x its size with the download copy), so we
// gate before fetching: soft-warn past 500 MB, hard-refuse past ~2 GB.
const WARN_BYTES = 500 * 1024 * 1024;
const REFUSE_BYTES = 2 * 1024 * 1024 * 1024;

type Phase = "idle" | "inspecting" | "ready" | "receiving" | "done" | "error";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

export function BrowserReceivePanel({ ticket }: { ticket: string }) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [info, setInfo] = useState<TicketInfo | null>(null);
  const [files, setFiles] = useState<CollectionFile[]>([]);
  const [savedHashes, setSavedHashes] = useState<Set<string>>(new Set());
  const [savingHash, setSavingHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiver, setReceiver] = useState<BrowserReceiver | null>(null);

  const refused = info != null && info.size > REFUSE_BYTES;
  const heavy = info != null && info.size > WARN_BYTES && !refused;

  const beginInspect = async () => {
    setPhase("inspecting");
    setError(null);
    try {
      setInfo(await inspectTicket(ticket));
      setPhase("ready");
    } catch (err) {
      setError(describe(err));
      setPhase("error");
    }
  };

  const beginReceive = async () => {
    setPhase("receiving");
    setError(null);
    try {
      setStatus("Connecting to the sender over the relay…");
      const rx = receiver ?? (await BrowserReceiver.spawn());
      setReceiver(rx);
      setStatus("Receiving and verifying (BLAKE3)…");
      const root = await rx.fetch(ticket);
      setStatus("Reading files…");
      setFiles(await rx.listCollection(root));
      setPhase("done");
    } catch (err) {
      setError(describe(err));
      setPhase("error");
    }
  };

  const save = async (file: CollectionFile) => {
    if (!receiver) return;
    setSavingHash(file.hash);
    try {
      const bytes = await receiver.readBlob(file.hash);
      await saveBytes(file.name, bytes);
      setSavedHashes((prev) => new Set(prev).add(file.hash));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(describe(err));
    } finally {
      setSavingHash(null);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[color:var(--signal-green)]/22 bg-[color:var(--signal-green)]/[0.05] p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[color:var(--signal-green)]/30 bg-[color:var(--signal-green)]/12">
          <Globe className="h-5 w-5 text-[var(--signal-green)]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[13.5px] font-semibold text-white">Receive in this browser</p>
            <span className="rounded-full border border-[color:var(--proof-amber)]/30 bg-[color:var(--proof-amber)]/10 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-[var(--proof-amber)]">
              Beta
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-6 text-[color:var(--soft-copy)]">
            No install. The same Rust engine runs as WebAssembly in this tab and pulls the files
            directly from the sender — BLAKE3-verified, never through a server.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <AnimatePresence mode="wait">
          {phase === "idle" && (
            <Frame key="idle" reduce={reduce}>
              <button
                type="button"
                onClick={() => void beginInspect()}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--signal-green)] px-5 py-3 text-[13.5px] font-semibold text-[var(--text-ink)] transition hover:brightness-[1.04]"
              >
                <Download className="h-4 w-4" /> Receive in this browser
              </button>
            </Frame>
          )}

          {phase === "inspecting" && (
            <Frame key="inspecting" reduce={reduce}>
              <Busy label="Reading ticket…" />
            </Frame>
          )}

          {phase === "ready" && info && (
            <Frame key="ready" reduce={reduce}>
              <div className="rounded-xl border border-white/8 bg-black/30 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-semibold text-white" title={info.label}>
                    {info.label || "Shared files"}
                  </p>
                  <p className="shrink-0 font-mono text-[12px] text-[var(--signal-green)]">
                    {formatBytes(info.size)}
                  </p>
                </div>
                {refused && (
                  <p className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-[color:var(--proof-amber)]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Too large for browser receive (the whole file must fit in this tab's memory).
                    Use the desktop app for transfers over ~2&nbsp;GB.
                  </p>
                )}
                {heavy && (
                  <p className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-[color:var(--soft-copy)]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--proof-amber)]" />
                    Large transfer — it's held in this tab's memory. Keep the tab focused; the
                    desktop app streams to disk without the size limit.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void beginReceive()}
                disabled={refused}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--signal-green)] px-5 py-3 text-[13.5px] font-semibold text-[var(--text-ink)] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> {heavy ? "Receive anyway" : "Receive here"}
              </button>
            </Frame>
          )}

          {phase === "receiving" && (
            <Frame key="receiving" reduce={reduce}>
              <Busy label={status} />
              <p className="mt-2 text-center text-[11px] text-[color:var(--muted-copy)]">
                The sender must stay online until this completes.
              </p>
            </Frame>
          )}

          {phase === "done" && (
            <Frame key="done" reduce={reduce}>
              <div className="flex items-center gap-2 rounded-lg border border-[color:var(--signal-green)]/25 bg-[color:var(--signal-green)]/10 px-3 py-2 text-[12.5px] font-semibold text-[var(--signal-green)]">
                <ShieldCheck className="h-4 w-4" /> BLAKE3 verified — bytes are proven correct.
              </div>
              <ul className="mt-3 space-y-2">
                {files.map((file) => {
                  const saved = savedHashes.has(file.hash);
                  const saving = savingHash === file.hash;
                  return (
                    <li
                      key={file.hash}
                      className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/30 px-3.5 py-2.5"
                    >
                      <FileDown className="h-4 w-4 shrink-0 text-[color:var(--soft-copy)]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-white" title={file.name}>
                          {file.name}
                        </p>
                        <p className="font-mono text-[10.5px] text-[color:var(--muted-copy)]">
                          {formatBytes(file.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void save(file)}
                        disabled={saving}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition disabled:opacity-60 ${
                          saved
                            ? "border-[color:var(--signal-green)]/40 bg-[color:var(--signal-green)]/14 text-[var(--signal-green)]"
                            : "border-white/12 bg-white/[0.05] text-white hover:bg-white/[0.09]"
                        }`}
                      >
                        {saving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : saved ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        {saved ? "Saved" : saving ? "Saving" : "Save"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!hasSaveFilePicker() && (
                <p className="mt-2.5 text-[11px] leading-5 text-[color:var(--muted-copy)]">
                  Saved files land in this browser's Downloads folder.
                </p>
              )}
            </Frame>
          )}

          {phase === "error" && (
            <Frame key="error" reduce={reduce}>
              <div className="rounded-xl border border-red-400/25 bg-red-500/10 p-4">
                <p className="flex items-start gap-2 text-[12.5px] leading-6 text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPhase("idle");
                  setError(null);
                }}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-white/[0.08]"
              >
                Try again
              </button>
            </Frame>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Frame({ children, reduce }: { children: React.ReactNode; reduce: boolean | null }) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, y: -6 }}
      transition={{ duration: 0.22 }}
    >
      {children}
    </motion.div>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 rounded-xl border border-white/8 bg-black/30 px-4 py-3.5 text-[12.5px] font-medium text-[color:var(--soft-copy)]">
      <Loader2 className="h-4 w-4 animate-spin text-[var(--signal-green)]" />
      {label}
    </div>
  );
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Browser receive failed. The sender may be offline or on an older version.";
}
