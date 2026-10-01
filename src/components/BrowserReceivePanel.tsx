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
import { useEffect, useRef, useState } from "react";
import {
  BrowserReceiver,
  browserStreamingReceiveSupported,
  type CollectionFile,
  hasSaveFilePicker,
  inspectTicket,
  saveReceivedFile,
  saveReceivedFileStreaming,
  verifiedCollectionSize,
  type TicketInfo,
} from "../lib/webReceiver";
import { browserReceiveFileKey } from "../lib/browserReceiveFiles";

// The compatibility receive path is memory-backed. Gate advertised size for a
// useful early warning, then enforce the limit against actual bytes in Rust.
const WARN_BYTES = 64 * 1024 * 1024;
const REFUSE_BYTES = 128 * 1024 * 1024;

type Phase =
  | "idle"
  | "inspecting"
  | "ready"
  | "receiving"
  | "done"
  | "error"
  | "cancelled";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

export function BrowserReceivePanel({ ticket }: { ticket: string }) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [info, setInfo] = useState<TicketInfo | null>(null);
  const [streamingAvailable, setStreamingAvailable] = useState(false);
  const [sizeVerified, setSizeVerified] = useState(false);
  const [files, setFiles] = useState<CollectionFile[]>([]);
  const [savedFileKeys, setSavedFileKeys] = useState<Set<string>>(new Set());
  const [streamedReceive, setStreamedReceive] = useState(false);
  const [savingFileKey, setSavingFileKey] = useState<string | null>(null);
  const [savingBytes, setSavingBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [receiver, setReceiver] = useState<BrowserReceiver | null>(null);
  const [receivedBytes, setReceivedBytes] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveAbortControllerRef = useRef<AbortController | null>(null);

  // This must be mount-only: setting the receiver during beginReceive is not
  // a cancellation signal and must not abort the operation being started.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      saveAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!receiver) return;
    return () => {
      void receiver
        .cancel()
        .catch(() => undefined)
        .finally(() => window.setTimeout(() => receiver.stop(), 0));
    };
  }, [receiver]);

  const canStreamToDisk = hasSaveFilePicker() && streamingAvailable;
  const refused = info != null && info.size > REFUSE_BYTES && !canStreamToDisk;
  const heavy =
    info != null && info.size > WARN_BYTES && !canStreamToDisk && !refused;

  const beginInspect = async () => {
    setPhase("inspecting");
    setError(null);
    setSizeVerified(false);
    try {
      const [ticketInfo, canStream] = await Promise.all([
        inspectTicket(ticket),
        browserStreamingReceiveSupported(),
      ]);
      setInfo(ticketInfo);
      setStreamingAvailable(canStream);
      setPhase("ready");
    } catch (err) {
      setError(describe(err));
      setPhase("error");
    }
  };

  const beginReceive = async () => {
    setPhase("receiving");
    setError(null);
    setReceivedBytes(0);
    setFiles([]);
    setSavedFileKeys(new Set());
    setStreamedReceive(false);
    setSizeVerified(false);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    let lastUiUpdate = 0;
    let latestBytes = 0;
    let rx: BrowserReceiver | null = receiver;
    try {
      setStatus("Connecting to the sender over the relay…");
      rx ??= await BrowserReceiver.spawn();
      setReceiver(rx);
      if (controller.signal.aborted) {
        await rx.cancel();
        throw new Error("Browser receive cancelled.");
      }
      if (hasSaveFilePicker() && rx.supportsStreamingReceive()) {
        setStreamedReceive(true);
        setStatus("Verifying the share manifest…");
        const files = await rx.prepareStreamedCollection(ticket, (bytes) => {
          latestBytes = bytes;
          const now = performance.now();
          if (now - lastUiUpdate >= 150) {
            lastUiUpdate = now;
            setReceivedBytes(bytes);
          }
          return !controller.signal.aborted;
        });
        const verifiedSize = verifiedCollectionSize(files);
        setInfo((current) =>
          current ? { ...current, size: verifiedSize } : current,
        );
        setSizeVerified(true);
        setFiles(files);
        setReceivedBytes(latestBytes);
        setStatus("Choose a file to stream it to disk.");
        setPhase("done");
      } else {
        if (info && info.size > REFUSE_BYTES) {
          throw new Error(
            "This browser or its cached receive engine cannot stream this large transfer to disk. Use the native app, or reload the page to update browser support.",
          );
        }
        setStatus("Receiving and verifying (BLAKE3)…");
        const root = await rx.fetch(ticket, REFUSE_BYTES, (bytes) => {
          latestBytes = bytes;
          const now = performance.now();
          if (now - lastUiUpdate >= 150 || bytes >= REFUSE_BYTES) {
            lastUiUpdate = now;
            setReceivedBytes(bytes);
          }
          return !controller.signal.aborted;
        });
        setReceivedBytes(latestBytes);
        setStatus("Reading files…");
        const receivedFiles = await rx.listCollection(root);
        const verifiedSize = verifiedCollectionSize(receivedFiles);
        setInfo((current) =>
          current ? { ...current, size: verifiedSize } : current,
        );
        setSizeVerified(true);
        setFiles(receivedFiles);
        setPhase("done");
      }
    } catch (err) {
      rx?.stop();
      setReceiver(null);
      if (controller.signal.aborted) {
        setError("Receive cancelled. Partial browser data was cleared.");
        setPhase("cancelled");
      } else {
        setError(describe(err));
        setPhase("error");
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  const cancelReceive = async (): Promise<void> => {
    abortControllerRef.current?.abort();
    setStatus("Stopping the receive and clearing partial data…");
    try {
      await receiver?.cancel();
    } catch {
      // The transfer may have completed or the page may already be closing.
    }
  };

  const save = async (file: CollectionFile, fileKey: string) => {
    if (!receiver) return;
    const saveController = streamedReceive ? new AbortController() : null;
    saveAbortControllerRef.current = saveController;
    setSavingFileKey(fileKey);
    setSavingBytes(0);
    try {
      if (streamedReceive) {
        let lastUiUpdate = 0;
        const bytes = await saveReceivedFileStreaming(
          receiver,
          file,
          (count) => {
            const now = performance.now();
            if (now - lastUiUpdate >= 100 || count >= file.size) {
              lastUiUpdate = now;
              setSavingBytes(count);
            }
          },
          saveController?.signal,
        );
        setSavingBytes(bytes);
        setReceivedBytes((current) => current + bytes);
      } else {
        await saveReceivedFile(receiver, file);
      }
      const nextSavedFileKeys = new Set(savedFileKeys).add(fileKey);
      setSavedFileKeys(nextSavedFileKeys);
      if (nextSavedFileKeys.size >= files.length) {
        receiver.stop();
        setReceiver(null);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError"))
        setError(describe(err));
    } finally {
      if (saveAbortControllerRef.current === saveController) {
        saveAbortControllerRef.current = null;
      }
      setSavingFileKey(null);
    }
  };

  const cancelSave = (): void => {
    saveAbortControllerRef.current?.abort();
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[color:var(--signal-green)]/22 bg-[color:var(--signal-green)]/[0.05] p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[color:var(--signal-green)]/30 bg-[color:var(--signal-green)]/12">
          <Globe className="h-5 w-5 text-[var(--signal-green)]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[13.5px] font-semibold text-white">
              Receive in this browser
            </p>
            <span className="rounded-full border border-[color:var(--proof-amber)]/30 bg-[color:var(--proof-amber)]/10 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-[var(--proof-amber)]">
              Beta
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-6 text-[color:var(--soft-copy)]">
            No install. The same Rust engine runs as WebAssembly in this tab and
            pulls the files from the sender over an encrypted connection. A
            relay may forward encrypted traffic when a direct route is blocked;
            it does not host the files. Received bytes are BLAKE3-verified.
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
                  <p
                    className="truncate text-sm font-semibold text-white"
                    title={info.label}
                  >
                    {info.label || "Shared files"}
                  </p>
                  <p className="shrink-0 text-right text-[13px] text-[color:var(--muted-copy)]">
                    {sizeVerified ? "Verified" : "Sender estimate"}
                    <span className="ml-1.5 font-mono text-[13px] text-[var(--signal-green)]">
                      {formatBytes(info.size)}
                    </span>
                  </p>
                </div>
                {refused && (
                  <p className="mt-3 flex items-start gap-2 text-[13px] leading-6 text-[color:var(--proof-amber)]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    This browser cannot stream this transfer to disk. Use the
                    native app or reload after the browser receive engine has
                    updated.
                  </p>
                )}
                {heavy && (
                  <p className="mt-3 flex items-start gap-2 text-[13px] leading-6 text-[color:var(--soft-copy)]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--proof-amber)]" />
                    Large transfer — received bytes stay in this tab's memory
                    until saved. The ticket size is supplied by the sender;
                    actual incoming bytes are capped at 128&nbsp;MiB during the
                    transfer.
                  </p>
                )}
                {info.size > WARN_BYTES && canStreamToDisk && !refused && (
                  <p className="mt-3 text-[13px] leading-6 text-[color:var(--soft-copy)]">
                    This browser can stream verified chunks to a file you
                    choose. Make sure the destination has enough free space.
                  </p>
                )}
                <p className="mt-3 text-[13px] leading-6 text-[color:var(--muted-copy)]">
                  Sender identity is not verified by the link. Confirm who
                  shared it before saving files.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void beginReceive()}
                disabled={refused}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--signal-green)] px-5 py-3 text-[13.5px] font-semibold text-[var(--text-ink)] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />{" "}
                {heavy
                  ? "Receive anyway"
                  : info.size > REFUSE_BYTES
                    ? "Receive and stream to disk"
                    : "Receive here"}
              </button>
            </Frame>
          )}

          {phase === "receiving" && (
            <Frame key="receiving" reduce={reduce}>
              <Busy label={status} />
              <p className="mt-3 text-center text-[13px] leading-6 text-[color:var(--muted-copy)]">
                {formatBytes(receivedBytes)}{" "}
                {streamedReceive
                  ? "of the collection manifest verified so far. Files stream as you save them."
                  : "received and verified so far."}{" "}
                The sender must stay online.
              </p>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
                aria-hidden
              >
                {!reduce && (
                  <motion.div
                    className="h-full w-1/3 rounded-full"
                    style={{
                      background:
                        "linear-gradient(90deg, transparent, oklch(82% 0.16 150 / 0.9), transparent)",
                    }}
                    animate={{ x: ["-120%", "340%"] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => void cancelReceive()}
                className="mt-3 min-h-11 w-full rounded-full border border-white/12 bg-white/[0.04] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)]"
              >
                Cancel receive
              </button>
            </Frame>
          )}

          {phase === "done" && (
            <Frame key="done" reduce={reduce}>
              <motion.div
                initial={reduce ? false : { scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 360, damping: 22 }}
                className="flex items-center gap-2 rounded-lg border border-[color:var(--signal-green)]/25 bg-[color:var(--signal-green)]/10 px-3 py-2 text-sm font-semibold text-[var(--signal-green)]"
              >
                <ShieldCheck className="h-4 w-4" />
                {streamedReceive
                  ? "Share manifest verified — file contents verify as you save them."
                  : "BLAKE3 verified — bytes are proven correct."}
              </motion.div>
              <ul className="mt-3 space-y-2">
                {files.map((file, index) => {
                  const fileKey = browserReceiveFileKey(file.hash, index);
                  const saved = savedFileKeys.has(fileKey);
                  const saving = savingFileKey === fileKey;
                  return (
                    <motion.li
                      key={fileKey}
                      initial={reduce ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: reduce ? 0 : 0.12 + index * 0.08,
                        duration: 0.3,
                      }}
                      className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/30 px-3.5 py-2.5"
                    >
                      <FileDown className="h-4 w-4 shrink-0 text-[color:var(--soft-copy)]" />
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-medium text-white"
                          title={file.name}
                        >
                          {file.name}
                        </p>
                        <p className="font-mono text-[13px] text-[color:var(--muted-copy)]">
                          {formatBytes(file.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void save(file, fileKey)}
                        disabled={savingFileKey !== null}
                        aria-label={
                          saving
                            ? `Saving ${file.name}: ${formatBytes(savingBytes)} of ${formatBytes(file.size)}`
                            : `${saved ? "Saved" : "Save"} ${file.name}`
                        }
                        className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-semibold transition disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)] ${
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
                        {saved
                          ? "Saved"
                          : saving
                            ? streamedReceive
                              ? `${formatBytes(savingBytes)} / ${formatBytes(file.size)}`
                              : "Saving"
                            : "Save"}
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
              {!hasSaveFilePicker() && (
                <p className="mt-2.5 text-[13px] leading-6 text-[color:var(--muted-copy)]">
                  Saved files land in this browser's Downloads folder.
                </p>
              )}
              {streamedReceive && savingFileKey !== null && (
                <button
                  type="button"
                  onClick={cancelSave}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-4 py-2.5 text-[12px] font-semibold text-white transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)]"
                >
                  Stop saving this file
                </button>
              )}
            </Frame>
          )}

          {phase === "error" && (
            <Frame key="error" reduce={reduce}>
              <div className="rounded-xl border border-red-400/25 bg-red-500/10 p-4">
                <p className="flex items-start gap-2 text-sm leading-6 text-red-200">
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
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)]"
              >
                Try again
              </button>
            </Frame>
          )}

          {phase === "cancelled" && (
            <Frame key="cancelled" reduce={reduce}>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
                {error}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPhase("idle");
                  setError(null);
                }}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)]"
              >
                Receive again
              </button>
            </Frame>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Frame({
  children,
  reduce,
}: {
  children: React.ReactNode;
  reduce: boolean | null;
}) {
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
    <div className="flex items-center justify-center gap-2.5 rounded-xl border border-white/8 bg-black/30 px-4 py-3.5 text-sm font-medium text-[color:var(--soft-copy)]">
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
