import {
  ArrowRight,
  ClipboardCheck,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  GitBranch,
  Link2,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import siteLogoUrl from "../assets/lightning-p2p-site-logo.png";
import { BrowserReceivePanel } from "./BrowserReceivePanel";
import { browserReceiveSupported } from "../lib/webReceiver";
import {
  ANDROID_APK_DOWNLOAD_URL,
  RELEASE_URL,
  REPO_URL,
  VELOPACK_DOWNLOAD_URL,
  createDeepReceiveLink,
  ticketFromReceiveFragment,
} from "../lib/shareLinks";
import { writeClipboardText } from "../lib/tauri";

const PENDING_TICKET_STORAGE_KEY = "lightning-p2p.pendingReceiveTicket";
const AUTO_OPEN_DELAY_MS = 700;

type TicketSource = "fragment" | "storage" | "missing";
interface HandoffTicket {
  ticket: string | null;
  source: TicketSource;
}

function readStoredTicket(): string | null {
  try { return sessionStorage.getItem(PENDING_TICKET_STORAGE_KEY); } catch { return null; }
}
function storeTicket(ticket: string): void {
  try { sessionStorage.setItem(PENDING_TICKET_STORAGE_KEY, ticket); } catch { /* private browsing */ }
}
function handoffTicket(): HandoffTicket {
  const fragmentTicket = ticketFromReceiveFragment(window.location.hash);
  if (fragmentTicket) { storeTicket(fragmentTicket); return { ticket: fragmentTicket, source: "fragment" }; }
  const storedTicket = readStoredTicket();
  return storedTicket ? { ticket: storedTicket, source: "storage" } : { ticket: null, source: "missing" };
}
function sourceLabel(source: TicketSource): string {
  switch (source) {
    case "fragment": return "Ticket pulled from the URL fragment — never sent to the website server.";
    case "storage":  return "Ticket restored from this browser session.";
    case "missing":  return "Waiting for a receive ticket.";
  }
}
function ticketDigest(ticket: string): string {
  if (ticket.length <= 16) return ticket;
  return `${ticket.slice(0, 8)}…${ticket.slice(-8)}`;
}

export function ReceiveHandoffPage() {
  const handoff = useMemo(handoffTicket, []);
  const reduce = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const [showRawTicket, setShowRawTicket] = useState(false);
  const [autoOpenedAt, setAutoOpenedAt] = useState<number | null>(null);
  const deepLink = handoff.ticket ? createDeepReceiveLink(handoff.ticket) : null;
  const showBrowserReceive = Boolean(handoff.ticket) && browserReceiveSupported();

  useEffect(() => {
    if (!deepLink) return;
    const timer = window.setTimeout(() => {
      setAutoOpenedAt(Date.now());
      window.location.href = deepLink;
    }, AUTO_OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deepLink]);

  const handleOpenApp = () => { if (deepLink) window.location.href = deepLink; };
  const handleCopyTicket = async () => {
    if (!handoff.ticket) return;
    try {
      await writeClipboardText(handoff.ticket);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  };

  return (
    <div className="relative min-h-screen bg-[var(--lab-black)] text-white">
      {/* Atmosphere */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 cinematic-grid" />
        {!reduce && (
          <>
            <div className="cinematic-orb" style={{ top: "-10%", left: "12%", width: 480, height: 480,
              background: "radial-gradient(circle at center, oklch(82% 0.16 150 / 0.40), transparent 62%)",
              animationDuration: "44s" }} />
            <div className="cinematic-orb" style={{ bottom: "-22%", right: "-4%", width: 580, height: 580,
              background: "radial-gradient(circle at center, oklch(81% 0.13 83 / 0.28), transparent 64%)",
              animationDuration: "62s", animationDirection: "reverse" }} />
          </>
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

      <main>
        <section className="relative px-6 py-16 sm:py-24">
          <div className="mx-auto grid max-w-[1100px] gap-12 lg:grid-cols-[1fr_400px] lg:gap-14">
            <div className="relative">
              <div className="hero-rise inline-flex items-center gap-2 rounded-full border border-[color:var(--signal-green)]/22 bg-[color:var(--signal-green)]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--signal-green)]">
                <Link2 className="h-3 w-3" /> Receive handoff
              </div>
              <h1 className="font-display hero-rise hero-rise--stagger-1 mt-6 max-w-[16ch] text-balance text-[clamp(2.4rem,5.6vw,4.6rem)] font-extrabold leading-[0.96] tracking-[-0.024em] text-white">
                Open this transfer in <span className="text-[var(--signal-green)]">Lightning P2P</span>.
              </h1>
              <p className="hero-rise hero-rise--stagger-2 mt-6 max-w-[56ch] text-pretty text-[16.5px] leading-[1.65] text-[color:var(--soft-copy)]">
                The ticket stays in the URL fragment, which means it never reaches the website server. If the native app is installed, the transfer should open there in about a second.
              </p>
              <div className="hero-rise hero-rise--stagger-3 mt-9 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleOpenApp}
                  disabled={!deepLink}
                  className="group relative inline-flex min-h-12 items-center gap-2 overflow-hidden rounded-full bg-[var(--signal-green)] px-6 py-3.5 text-[14px] font-semibold text-[var(--text-ink)] shadow-[0_18px_46px_rgba(125,223,156,0.20)] transition hover:shadow-[0_26px_72px_rgba(125,223,156,0.32)] hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Open transfer in the native Lightning P2P app"
                >
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-12 -translate-x-16 skew-x-[-18deg] bg-white/30 opacity-0 transition duration-700 group-hover:translate-x-[24rem] group-hover:opacity-100" />
                  <span className="relative z-10 inline-flex items-center gap-2"><ArrowRight className="h-4 w-4" /> Open desktop app</span>
                </button>
                <a href={VELOPACK_DOWNLOAD_URL} className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 py-3 text-[13.5px] font-semibold text-white transition hover:border-[color:var(--signal-green)]/40 hover:bg-white/[0.07]">
                  <Download className="h-3.5 w-3.5" /> Install for Windows
                </a>
                <a href={ANDROID_APK_DOWNLOAD_URL} className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 py-3 text-[13.5px] font-semibold text-white transition hover:border-[color:var(--signal-green)]/40 hover:bg-white/[0.07]">
                  <Smartphone className="h-3.5 w-3.5" /> Android APK
                </a>
                <a href={RELEASE_URL} className="inline-flex items-center gap-2 px-2 py-2 text-[13px] font-semibold text-[color:var(--soft-copy)] transition hover:text-white">
                  Release artifacts
                </a>
              </div>
              <div className="hero-rise hero-rise--stagger-4 mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-[color:var(--muted-copy)]">
                <span className="inline-flex items-center gap-1.5"><FileCheck2 className="h-3.5 w-3.5 text-[var(--signal-green)]" /> BLAKE3 verified at receive</span>
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-[var(--signal-green)]" /> Capability token, never a server upload</span>
              </div>

              {showBrowserReceive && handoff.ticket && (
                <div className="hero-rise hero-rise--stagger-4 mt-8 max-w-[52ch]">
                  <BrowserReceivePanel ticket={handoff.ticket} />
                </div>
              )}

              {deepLink && (
                <motion.p
                  className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-[11.5px] font-medium text-white/72"
                  initial={reduce ? false : { opacity: 0 }}
                  animate={reduce ? undefined : { opacity: 1 }}
                  transition={{ delay: 0.6, duration: 0.4 }}
                >
                  <span aria-hidden className="signal-dot !h-1.5 !w-1.5" />
                  {autoOpenedAt ? "Asked the OS to launch the app." : `Auto-launching the app in ~${Math.round(AUTO_OPEN_DELAY_MS / 100) * 100}ms…`}
                </motion.p>
              )}
            </div>

            <aside className="relative overflow-hidden rounded-3xl border border-white/8 bg-[var(--lab-black)]/82 p-7 shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
              <div className="absolute inset-0 cinematic-grid opacity-60" />
              <div className="lab-scan-line" />
              <div className="relative">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[color:var(--signal-green)]/30 bg-[color:var(--signal-green)]/12">
                    <ShieldCheck className="h-5 w-5 text-[var(--signal-green)]" />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-white">{sourceLabel(handoff.source)}</p>
                    <p className="mt-2 text-[12.5px] leading-6 text-[color:var(--soft-copy)]">
                      {handoff.ticket ? "Keep this tab open if you still need to install the app." : "Ask the sender for a fresh Lightning P2P receive link."}
                    </p>
                  </div>
                </div>

                {handoff.ticket && (
                  <div className="mt-6 space-y-3">
                    <div className="rounded-xl border border-white/8 bg-black/30 p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-white/40">Raw ticket</p>
                        <p className="font-mono text-[10px] font-semibold tracking-[0.04em] text-[var(--signal-green)]">{ticketDigest(handoff.ticket)}</p>
                      </div>
                      {showRawTicket ? (
                        <code className="mt-3 block max-h-40 overflow-y-auto break-all font-mono text-[11.5px] leading-6 text-white/82">{handoff.ticket}</code>
                      ) : (
                        <p className="mt-3 text-[12.5px] leading-6 text-[color:var(--soft-copy)]">
                          Hidden by default. Tickets are capability tokens; only reveal when you need a manual paste fallback.
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setShowRawTicket((v) => !v)}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[12.5px] font-semibold text-white transition hover:bg-white/[0.08]"
                      >
                        {showRawTicket ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {showRawTicket ? "Hide" : "Reveal"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyTicket()}
                        className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-[12.5px] font-semibold transition ${
                          copied ? "border-[color:var(--signal-green)]/40 bg-[color:var(--signal-green)]/14 text-[var(--signal-green)]" : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                        }`}
                      >
                        {copied ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </section>

        <section className="border-t border-white/[0.06] px-6 py-12">
          <div className="mx-auto grid max-w-[1100px] gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <article className="rounded-2xl border border-white/8 bg-white/[0.03] p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-[var(--signal-green)]">How the handoff works</p>
              <h2 className="font-display mt-3 text-[22px] font-bold tracking-[-0.012em] text-white">Receive links keep the ticket out of server logs.</h2>
              <p className="mt-3 text-[13.5px] leading-7 text-[color:var(--soft-copy)]">
                Lightning P2P receive URLs are <code className="font-mono text-[12px] text-white/82">/receive#t=&lt;ticket&gt;</code>. Browsers don't send the fragment in HTTP requests, so the ticket never reaches a web server. From here you can open the native app via the <code className="font-mono text-[12px] text-white/82">lightning-p2p://</code> scheme, or receive right in this tab — the same Rust engine runs as WebAssembly and pulls the files directly from the sender, BLAKE3-verified, no server in the middle.
              </p>
            </article>
            <aside className="rounded-2xl border border-white/8 bg-white/[0.03] p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-[var(--proof-amber)]">Key facts</p>
              <dl className="mt-3 grid gap-2 text-[13px]">
                <Fact label="Ticket location"   value="URL fragment" />
                <Fact label="Browser receive"   value="iroh + BLAKE3 in WASM" />
                <Fact label="Deep link scheme"  value="lightning-p2p://receive" />
                <Fact label="Transfer engine"   value="Rust (iroh QUIC / relay)" />
                <Fact label="Sender requirement" value="Sender stays online" />
                <Fact label="Ticket model"      value="Capability token" />
              </dl>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] pb-1.5 last:border-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">{label}</dt>
      <dd className="text-right text-white/82">{value}</dd>
    </div>
  );
}
