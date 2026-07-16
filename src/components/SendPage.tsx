import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  Copy,
  FilePlus2,
  FileUp,
  GitBranch,
  Globe,
  Loader2,
  Radio,
  Share2,
  ShieldCheck,
  Square,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import siteLogoUrl from "../assets/lightning-p2p-site-logo.png";
import { REPO_URL } from "../lib/shareLinks";
import {
  BrowserSender,
  browserReceiveSupported,
  receiveLinkForTicket,
  renderQrSvg,
} from "../lib/webReceiver";

// Shares live in tab memory (MemStore), so gate before importing: soft-warn
// past 500 MB, hard-refuse past ~2 GB — same limits as browser receive.
const WARN_BYTES = 500 * 1024 * 1024;
const REFUSE_BYTES = 2 * 1024 * 1024 * 1024;

type Phase = "pick" | "publishing" | "live" | "error";

interface StagedFile {
  name: string;
  size: number;
  file: File;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

function shareLabel(files: StagedFile[]): string {
  if (files.length === 1 && files[0]) return files[0].name;
  return `${files.length} files`;
}

export function SendPage() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("pick");
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The live share IS this object: dropping it stops serving. It must outlive
  // startSharing (a local would be GC'd and the wasm endpoint freed while the
  // UI still says "sharing"), so it lives here for the lifetime of the page.
  const senderRef = useRef<BrowserSender | null>(null);
  const senderPromiseRef = useRef<Promise<BrowserSender> | null>(null);
  const supported = browserReceiveSupported();
  const canWebShare = typeof navigator !== "undefined" && "share" in navigator;

  const totalBytes = staged.reduce((sum, f) => sum + f.size, 0);
  const refused = totalBytes > REFUSE_BYTES;
  const heavy = totalBytes > WARN_BYTES && !refused;

  // Spawning binds the endpoint and connects to the relay, so kicking it off
  // while the user is still picking files makes publish near-instant.
  const ensureSender = () => {
    senderPromiseRef.current ??= BrowserSender.spawn().catch((err: unknown) => {
      senderPromiseRef.current = null;
      throw err;
    });
    return senderPromiseRef.current;
  };

  const releaseSender = () => {
    const sender = senderRef.current;
    senderRef.current = null;
    senderPromiseRef.current = null;
    if (sender) void sender.stop().catch(() => undefined);
  };

  // Navigating away unmounts the page; stop serving instead of leaking the
  // endpoint.
  useEffect(() => {
    return () => {
      const sender = senderRef.current;
      senderRef.current = null;
      senderPromiseRef.current = null;
      if (sender) void sender.stop().catch(() => undefined);
    };
  }, []);

  // While the share is live, this tab IS the server. Three guards:
  // 1. beforeunload — closing the tab kills the share, so the browser asks.
  // 2. A held Web Lock — Chromium (Edge sleeping tabs, Chrome memory saver)
  //    exempts lock-holding tabs from sleep/freeze/discard, which would
  //    silently kill the share the same way. This is the failure users hit
  //    in the wild: "it said it uploaded, but nobody could download".
  // 3. The tab title says the share is live, so it isn't closed as clutter.
  useEffect(() => {
    if (phase !== "live") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older Chromium only honors the legacy returnValue signal.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);

    let releaseLock: (() => void) | undefined;
    if ("locks" in navigator) {
      const held = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      void navigator.locks
        .request("lightning-p2p-live-share", () => held)
        .catch(() => undefined);
    }

    const previousTitle = document.title;
    document.title = "● Sharing live — keep this tab open · Lightning P2P";

    return () => {
      window.removeEventListener("beforeunload", warn);
      releaseLock?.();
      document.title = previousTitle;
    };
  }, [phase]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...staged];
    for (const file of Array.from(list)) {
      if (!next.some((f) => f.name === file.name && f.size === file.size)) {
        next.push({ name: file.name, size: file.size, file });
      }
    }
    setStaged(next);
    // Prewarm the engine + relay connection; errors resurface at publish.
    void ensureSender().catch(() => undefined);
  };

  const removeFile = (name: string) => {
    setStaged((prev) => prev.filter((f) => f.name !== name));
  };

  const startSharing = async () => {
    if (staged.length === 0 || refused) return;
    setPhase("publishing");
    setError(null);
    try {
      setStatus("Starting the engine in this tab…");
      const sender = await ensureSender();
      senderRef.current = sender;
      for (const [index, f] of staged.entries()) {
        setStatus(`Importing ${f.name} (${index + 1}/${staged.length})…`);
        await sender.addFile(f.name, f.file);
      }
      setStatus("Connecting to the relay…");
      const ticket = await sender.publish(shareLabel(staged));
      const receiveLink = receiveLinkForTicket(ticket);
      setLink(receiveLink);
      try {
        setQrSvg(await renderQrSvg(receiveLink));
      } catch {
        setQrSvg(null); // The QR is a bonus; the link still works without it.
      }
      setPhase("live");
    } catch (err) {
      // A half-imported share can't be resumed; drop it so retry starts clean.
      releaseSender();
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const stopSharing = () => {
    releaseSender();
    setLink(null);
    setQrSvg(null);
    setCopied(false);
    setPhase("pick");
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const shareViaSheet = async () => {
    if (!link) return;
    try {
      await navigator.share({
        title: "Lightning P2P",
        text: `Receive "${shareLabel(staged)}" straight in your browser:`,
        url: link,
      });
    } catch {
      // Dismissed the share sheet — nothing to do.
    }
  };

  return (
    <div className="relative min-h-screen bg-[var(--lab-black)] text-white">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 cinematic-grid" />
        {!reduce && (
          <div
            className="cinematic-orb"
            style={{
              top: "-12%", right: "8%", width: 520, height: 520,
              background: "radial-gradient(circle at center, oklch(82% 0.16 150 / 0.35), transparent 62%)",
              animationDuration: "48s",
            }}
          />
        )}
        <div className="lab-scan-line" />
      </div>

      <header className="border-b border-white/[0.06] px-6 py-3.5">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-4">
          <a href="/" className="group flex min-w-0 items-center gap-3" aria-label="Lightning P2P home">
            <img src={siteLogoUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg ring-1 ring-white/10 transition group-hover:ring-[color:var(--signal-green)]/50" />
            <span className="font-display truncate text-[15px] font-bold tracking-[-0.018em]">Lightning P2P</span>
            <span aria-hidden className="signal-dot mt-[2px]" />
          </a>
          <a href={REPO_URL} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/8 text-white/72 transition hover:bg-white/5 hover:text-white" aria-label="GitHub">
            <GitBranch className="h-4 w-4" />
          </a>
        </div>
      </header>

      <main className="px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-[760px]">
          <div className="hero-rise inline-flex items-center gap-2 rounded-full border border-[color:var(--signal-green)]/22 bg-[color:var(--signal-green)]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--signal-green)]">
            <Globe className="h-3 w-3" /> Send from this browser · Beta
          </div>
          <h1 className="font-display hero-rise hero-rise--stagger-1 mt-6 max-w-[18ch] text-balance text-[clamp(2.2rem,5.2vw,3.8rem)] font-extrabold leading-[0.98] tracking-[-0.024em]">
            Share files <span className="text-[var(--signal-green)]">straight from this tab.</span>
          </h1>
          <p className="hero-rise hero-rise--stagger-2 mt-5 max-w-[58ch] text-pretty text-[15.5px] leading-[1.65] text-[color:var(--soft-copy)]">
            The Rust engine runs in this page as WebAssembly and serves your files directly to whoever opens your link — their browser, app, or terminal. Nothing uploads to a server; <strong className="font-semibold text-white">keep this tab open</strong> until they finish.
          </p>

          {!supported && (
            <div className="mt-8 rounded-xl border border-red-400/25 bg-red-500/10 p-4 text-[13px] text-red-200">
              This environment can't run the WebAssembly engine. Use the desktop app or CLI to send.
            </div>
          )}

          {supported && (
            <div className="mt-9">
              <AnimatePresence mode="wait">
                {phase === "pick" && (
                  <motion.div
                    key="pick"
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                  >
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(event) => { event.preventDefault(); setDragOver(false); addFiles(event.dataTransfer.files); }}
                      className={`grid w-full place-items-center rounded-3xl border-2 border-dashed px-6 py-14 transition ${
                        dragOver
                          ? "border-[color:var(--signal-green)]/70 bg-[color:var(--signal-green)]/10"
                          : "border-white/12 bg-white/[0.03] hover:border-[color:var(--signal-green)]/40 hover:bg-white/[0.05]"
                      }`}
                    >
                      <span className="grid place-items-center gap-3">
                        <UploadCloud className={`h-9 w-9 transition ${dragOver ? "text-[var(--signal-green)]" : "text-white/40"}`} />
                        <span className="text-[15px] font-semibold text-white">Drop files here or click to pick</span>
                        <span className="text-[12px] text-[color:var(--muted-copy)]">Stays in this tab's memory — best under {formatBytes(WARN_BYTES)}, hard limit ~2 GB</span>
                      </span>
                    </button>
                    <input
                      ref={inputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }}
                    />

                    {staged.length > 0 && (
                      <div className="mt-5">
                        <ul className="space-y-2">
                          {staged.map((f, index) => (
                            <motion.li
                              key={`${f.name}-${f.size}`}
                              initial={reduce ? false : { opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: reduce ? 0 : index * 0.04, duration: 0.22 }}
                              className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/30 px-3.5 py-2.5"
                            >
                              <FileUp className="h-4 w-4 shrink-0 text-[color:var(--soft-copy)]" />
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white" title={f.name}>{f.name}</span>
                              <span className="shrink-0 font-mono text-[10.5px] text-[color:var(--muted-copy)]">{formatBytes(f.size)}</span>
                              <button
                                type="button"
                                onClick={() => removeFile(f.name)}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-white/48 transition hover:border-red-400/40 hover:text-red-300"
                                aria-label={`Remove ${f.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </motion.li>
                          ))}
                        </ul>
                        <div className="mt-3 flex items-center justify-between text-[12px] text-[color:var(--muted-copy)]">
                          <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            className="inline-flex items-center gap-1.5 font-semibold text-[var(--signal-green)] transition hover:brightness-110"
                          >
                            <FilePlus2 className="h-3.5 w-3.5" /> Add more
                          </button>
                          <span className="font-mono">{formatBytes(totalBytes)} total</span>
                        </div>
                        {refused && (
                          <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-5 text-[color:var(--proof-amber)]">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            Over the ~2 GB browser memory limit. Use the desktop app or CLI for shares this big.
                          </p>
                        )}
                        {heavy && (
                          <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-5 text-[color:var(--soft-copy)]">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--proof-amber)]" />
                            Large share — everything is held in this tab's memory. The desktop app streams from disk without limits.
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => void startSharing()}
                          disabled={refused}
                          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--signal-green)] px-6 py-3.5 text-[14px] font-semibold text-[var(--text-ink)] shadow-[0_18px_46px_rgba(125,223,156,0.20)] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Radio className="h-4 w-4" /> Start sharing
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}

                {phase === "publishing" && (
                  <motion.div
                    key="publishing"
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                    className="rounded-2xl border border-white/8 bg-white/[0.03] p-8 text-center"
                  >
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--signal-green)]" />
                    <p className="mt-4 text-[13.5px] font-medium text-[color:var(--soft-copy)]">{status}</p>
                  </motion.div>
                )}

                {phase === "live" && link && (
                  <motion.div
                    key="live"
                    initial={reduce ? false : { opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 24 }}
                    className="rounded-2xl border border-[color:var(--signal-green)]/25 bg-[color:var(--signal-green)]/[0.06] p-7"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="relative flex h-2.5 w-2.5">
                        {!reduce && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--signal-green)] opacity-60" />}
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--signal-green)]" />
                      </span>
                      <p className="text-[14px] font-bold text-white">Sharing live from this tab</p>
                    </div>
                    <p className="mt-2.5 text-[12.5px] leading-6 text-[color:var(--soft-copy)]">
                      {shareLabel(staged)} · {formatBytes(totalBytes)} — anyone with this link can receive it in their browser or app. <strong className="font-semibold text-white">Keep this tab open.</strong>
                    </p>
                    <div className="mt-5 flex items-stretch gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-black/40 px-3.5 py-3 font-mono text-[11.5px] leading-6 text-white/82">
                        {link}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyLink()}
                        className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 text-[13px] font-semibold transition ${
                          copied
                            ? "border-[color:var(--signal-green)]/40 bg-[color:var(--signal-green)]/14 text-[var(--signal-green)]"
                            : "border-white/12 bg-white/[0.05] text-white hover:bg-white/[0.09]"
                        }`}
                      >
                        {copied ? <ClipboardCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied ? "Copied" : "Copy link"}
                      </button>
                      {canWebShare && (
                        <button
                          type="button"
                          onClick={() => void shareViaSheet()}
                          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-4 text-[13px] font-semibold text-white transition hover:bg-white/[0.09]"
                        >
                          <Share2 className="h-4 w-4" /> Share
                        </button>
                      )}
                    </div>
                    {qrSvg && (
                      <div className="mt-5 flex flex-col items-center gap-2.5">
                        <div
                          className="qr-code-frame rounded-[20px] border border-white/[0.08] bg-white p-3"
                          dangerouslySetInnerHTML={{ __html: qrSvg }}
                        />
                        <p className="text-[11px] text-[color:var(--muted-copy)]">
                          Scan with a phone camera — it opens the receive page directly.
                        </p>
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-[color:var(--muted-copy)]">
                      <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-[var(--signal-green)]" /> BLAKE3-verified on arrival</span>
                      <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-[var(--signal-green)]" /> No server ever holds the bytes</span>
                    </div>
                    <button
                      type="button"
                      onClick={stopSharing}
                      className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-[13px] font-semibold text-white/80 transition hover:bg-white/[0.08] hover:text-white"
                    >
                      <Square className="h-3.5 w-3.5" /> Stop sharing
                    </button>
                  </motion.div>
                )}

                {phase === "error" && (
                  <motion.div
                    key="error"
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <div className="rounded-xl border border-red-400/25 bg-red-500/10 p-4">
                      <p className="flex items-start gap-2 text-[12.5px] leading-6 text-red-200">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{error}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPhase("pick")}
                      className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-white/[0.08]"
                    >
                      Try again
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <p className="mt-10 font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/32">
            beta · relay-only in browsers · files live in tab memory · the desktop app streams from disk with no size limit
          </p>
        </div>
      </main>
    </div>
  );
}
