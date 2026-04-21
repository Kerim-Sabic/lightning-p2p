import {
  ArrowRight,
  Clipboard,
  Copy,
  Download,
  Github,
  Link2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import siteLogoUrl from "../assets/lightning-p2p-site-logo.png";
import {
  REPO_URL,
  RELEASE_URL,
  VELOPACK_DOWNLOAD_URL,
  createDeepReceiveLink,
  ticketFromReceiveFragment,
} from "../lib/shareLinks";

const PENDING_TICKET_STORAGE_KEY = "lightning-p2p.pendingReceiveTicket";

type TicketSource = "fragment" | "storage" | "missing";

interface HandoffTicket {
  ticket: string | null;
  source: TicketSource;
}

function readStoredTicket(): string | null {
  try {
    return sessionStorage.getItem(PENDING_TICKET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeTicket(ticket: string): void {
  try {
    sessionStorage.setItem(PENDING_TICKET_STORAGE_KEY, ticket);
  } catch {
    // Private browsing modes can reject storage; the fragment still has the ticket.
  }
}

function handoffTicket(): HandoffTicket {
  const fragmentTicket = ticketFromReceiveFragment(window.location.hash);
  if (fragmentTicket) {
    storeTicket(fragmentTicket);
    return {
      ticket: fragmentTicket,
      source: "fragment",
    };
  }

  const storedTicket = readStoredTicket();
  return storedTicket
    ? {
        ticket: storedTicket,
        source: "storage",
      }
    : {
        ticket: null,
        source: "missing",
      };
}

function sourceLabel(source: TicketSource): string {
  switch (source) {
    case "fragment":
      return "Ticket found in the private URL fragment";
    case "storage":
      return "Ticket restored from this browser session";
    case "missing":
      return "Waiting for a receive ticket";
  }
}

export function ReceiveHandoffPage() {
  const handoff = useMemo(handoffTicket, []);
  const [copied, setCopied] = useState(false);
  const deepLink = handoff.ticket
    ? createDeepReceiveLink(handoff.ticket)
    : null;

  useEffect(() => {
    if (!deepLink) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.location.href = deepLink;
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [deepLink]);

  const handleOpenApp = (): void => {
    if (!deepLink) {
      return;
    }

    window.location.href = deepLink;
  };

  const handleCopyTicket = async (): Promise<void> => {
    if (!handoff.ticket) {
      return;
    }

    try {
      await navigator.clipboard.writeText(handoff.ticket);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050706] text-white">
      <header className="border-b border-white/10 bg-[#050706]/84 px-4 py-4 backdrop-blur-2xl sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <a href="/" className="flex min-w-0 items-center gap-3">
            <img
              src={siteLogoUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-[8px]"
            />
            <span className="truncate text-sm font-semibold tracking-[0.02em]">
              Lightning P2P
            </span>
          </a>
          <a
            href={REPO_URL}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-slate-200 transition-colors hover:bg-white/8 hover:text-white"
            aria-label="Open Lightning P2P on GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-4 py-20 sm:px-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-center bg-no-repeat opacity-24 [background-image:url('/web-hero.png')] [background-size:cover]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,6,0.98)_0%,rgba(5,7,6,0.86)_52%,rgba(5,7,6,0.96)_100%)]"
          />
          <div className="relative mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-white/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-100 backdrop-blur-xl">
                <Link2 className="h-3 w-3" />
                Receive handoff
              </p>
              <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[0.98] tracking-tight text-white sm:text-6xl">
                Open this transfer in Lightning P2P.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
                This page keeps the receive ticket in the URL fragment so it is
                not sent to the website server. If the desktop app is installed,
                the transfer should open there automatically.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleOpenApp}
                  disabled={!deepLink}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-black/25 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowRight className="h-4 w-4" />
                  Open desktop app
                </button>
                <a
                  href={VELOPACK_DOWNLOAD_URL}
                  className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-white/8 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/14"
                >
                  <Download className="h-4 w-4" />
                  Install for Windows
                </a>
                <a
                  href={RELEASE_URL}
                  className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-slate-300 transition-colors hover:text-white"
                >
                  Release artifacts
                </a>
              </div>
            </div>

            <aside className="rounded-[8px] border border-white/10 bg-white/[0.045] p-6 backdrop-blur-xl">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-emerald-300/12 text-emerald-200 ring-1 ring-inset ring-emerald-300/20">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {sourceLabel(handoff.source)}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {handoff.ticket
                      ? "Keep this tab open if you still need to install the app."
                      : "Ask the sender for a fresh Lightning P2P receive link."}
                  </p>
                </div>
              </div>

              {handoff.ticket ? (
                <div className="mt-5 space-y-3">
                  <div className="rounded-[8px] border border-white/[0.08] bg-black/30 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                      Raw ticket
                    </p>
                    <code className="mt-3 block max-h-40 overflow-y-auto break-all font-mono text-[12px] leading-6 text-sky-50/88">
                      {handoff.ticket}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyTicket()}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-full border px-5 py-3 text-sm font-semibold transition-colors ${
                      copied
                        ? "border-emerald-300/30 bg-emerald-300/12 text-emerald-100"
                        : "border-white/16 bg-white/8 text-white hover:bg-white/14"
                    }`}
                  >
                    {copied ? (
                      <Clipboard className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied ? "Ticket copied" : "Copy raw ticket"}
                  </button>
                </div>
              ) : null}
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
