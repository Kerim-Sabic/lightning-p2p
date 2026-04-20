import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Download,
  Github,
  Globe2,
  LockKeyhole,
  Network,
  Plus,
  RadioTower,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
  type LucideIcon,
} from "lucide-react";
import packageJson from "../../package.json";
import siteLogoUrl from "../assets/lightning-p2p-site-logo.png";
import pages from "../content/web-pages.json";
import { ComparisonTable } from "./landing/ComparisonTable";
import { HowItWorks } from "./landing/HowItWorks";

interface Faq {
  q: string;
  a: string;
}

interface WebPage {
  path: string;
  label: string;
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  intro: string;
  focus: string;
  inNav?: boolean;
  priority?: string;
  related?: string[];
  body?: string[];
  faqs?: Faq[];
}

const SITE_URL = "https://lightning-p2p.netlify.app";
const APP_VERSION = packageJson.version;
const RELEASE_URL = "https://github.com/Kerim-Sabic/lightning-p2p/releases/latest";
const EXE_DOWNLOAD_URL = `https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/Lightning.P2P_${APP_VERSION}_x64-setup.exe`;
const MSI_DOWNLOAD_URL = `https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/Lightning.P2P_${APP_VERSION}_x64_en-US.msi`;
const VELOPACK_DOWNLOAD_URL = `https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-win-Setup.exe`;
const REPO_URL = "https://github.com/Kerim-Sabic/lightning-p2p";
const GH_STARS_BADGE = `https://img.shields.io/github/stars/Kerim-Sabic/lightning-p2p?style=for-the-badge&logo=github&color=10B981&labelColor=08120f`;
const webPages = pages as WebPage[];

const proofPoints = [
  {
    icon: Network,
    title: "Direct when networks allow it",
    body: "iroh connects peers over QUIC and falls back to relay-assisted connectivity when NAT or firewall rules block the direct path.",
  },
  {
    icon: ShieldCheck,
    title: "Verified bytes on disk",
    body: "iroh-blobs and BLAKE3 verification make every received file content-addressed and checked before it becomes transfer history.",
  },
  {
    icon: LockKeyhole,
    title: "No storage account in the middle",
    body: "Lightning P2P is not a temporary cloud bucket. The sender stays online, the receiver connects, and the transfer completes between peers.",
  },
];

const benchmarkRows = [
  "Windows to Windows on the same LAN",
  "Windows to Windows across WAN with direct connectivity",
  "Windows to Windows across WAN through relay fallback",
  "Comparison runs against cloud upload, browser transfer, OS nearby sharing, and LAN-only alternatives",
];

const capabilityCards: Array<{
  icon: LucideIcon;
  title: string;
  body: string;
}> = [
  {
    icon: Zap,
    title: "Performance",
    body: "High-throughput release tuning, streaming export, and progress sampling.",
  },
  {
    icon: RadioTower,
    title: "Reachability",
    body: "Direct paths first, relay-assisted paths when networks block peer reachability.",
  },
  {
    icon: Globe2,
    title: "Web launch",
    body: "Netlify-hosted SEO site for discovery, download, docs, and launch campaigns.",
  },
  {
    icon: BadgeCheck,
    title: "Open source",
    body: "MIT licensed Rust and React code with public releases and checksums.",
  },
];

const fallbackFaqs: Faq[] = [
  {
    q: "Can I use Lightning P2P in a mobile browser today?",
    a: "The public website works on mobile, but real transfers currently require the Windows desktop app. Browser and native mobile transfer support are planned as separate workstreams.",
  },
  {
    q: "Why not promise the fastest transfer app immediately?",
    a: "The app is designed for high-throughput P2P transfer, but public fastest claims should be backed by repeatable tests with hardware, network route, file size, and version details.",
  },
  {
    q: "Does relay fallback mean my files are stored on a server?",
    a: "No. Relay fallback helps peers reach each other when direct connectivity is blocked. Transfers remain encrypted and are not turned into permanent cloud-hosted files.",
  },
  {
    q: "Is the project open source?",
    a: "Yes. The app is MIT licensed and built with Rust, Tauri, React, TypeScript, iroh, and iroh-blobs on GitHub.",
  },
];

function currentPage(): WebPage {
  const path = window.location.pathname.replace(/\/$/u, "") || "/";
  const homePage = webPages.find((page) => page.path === "/");

  if (!homePage) {
    throw new Error("Missing home page metadata.");
  }

  return webPages.find((page) => page.path === path) ?? homePage;
}

function navClass(active: boolean): string {
  return `rounded-full px-3 py-2 text-sm transition-colors ${
    active
      ? "bg-white text-slate-950"
      : "text-slate-300 hover:bg-white/8 hover:text-white"
  }`;
}

function statCardClass(): string {
  return "relative overflow-hidden rounded-[8px] border border-white/10 bg-white/[0.035] px-5 py-6 backdrop-blur-sm transition-colors hover:border-emerald-300/25 hover:bg-white/[0.06]";
}

export function WebLandingPage() {
  const page = currentPage();
  const canonicalUrl = `${SITE_URL}${page.path === "/" ? "" : page.path}`;
  const homePage = webPages.find((p) => p.path === "/") ?? page;
  const faqs = page.faqs ?? homePage.faqs ?? fallbackFaqs;
  const isHome = page.path === "/";
  const navPages = webPages.filter((p) => p.inNav);

  return (
    <div className="min-h-screen bg-[#050706] text-white">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-[#050706]/74 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
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
          <nav className="hidden items-center gap-1 lg:flex">
            {navPages.map((item) => (
              <a
                key={item.path}
                href={item.path}
                className={navClass(item.path === page.path)}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={REPO_URL}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-slate-200 transition-colors hover:bg-white/8 hover:text-white"
              aria-label="Open Lightning P2P on GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
            <a
              href={EXE_DOWNLOAD_URL}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-100"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Download</span>
              <span className="sm:hidden">EXE</span>
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="relative flex min-h-[92vh] items-end overflow-hidden bg-[#050706] pt-24">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-center bg-no-repeat opacity-42 [background-image:url('/web-hero.png')] [background-size:cover]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,6,0.96)_0%,rgba(5,7,6,0.78)_48%,rgba(5,7,6,0.92)_100%)]"
          />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/12" />
          <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 pb-14 sm:px-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(320px,0.58fr)] lg:pb-20">
            <div className="max-w-4xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-white/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-100 backdrop-blur-xl">
                <Sparkles className="h-3 w-3" />
                {page.eyebrow}
              </p>
              <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-[0.98] tracking-tight text-white sm:text-6xl lg:text-[5.2rem]">
                {isHome ? (
                  <>
                    Move huge files{" "}
                    <span className="font-serif italic font-normal text-emerald-200">
                      directly
                    </span>{" "}
                    between devices.
                  </>
                ) : (
                  page.heading
                )}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
                {page.intro}
              </p>
              <p className="mt-4 max-w-2xl text-base leading-7 text-emerald-100/84">
                {page.focus}
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <a
                  href={EXE_DOWNLOAD_URL}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-black/25 transition-colors hover:bg-emerald-100"
                >
                  <Download className="h-4 w-4" />
                  Download for Windows
                </a>
                <a
                  href={REPO_URL}
                  className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-white/8 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/14"
                >
                  <Github className="h-4 w-4" />
                  Star on GitHub
                </a>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-slate-300 transition-colors hover:text-white"
                >
                  How it works
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
            <aside className="self-end border-l border-white/12 pl-5 text-sm leading-6 text-slate-300">
              <img
                src={siteLogoUrl}
                alt="Lightning P2P dark logo"
                className="mb-6 aspect-square w-40 rounded-[8px] border border-white/12 object-cover shadow-2xl shadow-black/50 sm:w-52"
              />
              <p className="font-semibold text-white">Current launch target</p>
              <p className="mt-2">
                Windows desktop transfers now. Netlify-hosted website now.
                Browser and mobile transfer engines after the desktop path is
                benchmarked and stable.
              </p>
              <a
                href={RELEASE_URL}
                className="mt-4 inline-flex items-center gap-1 text-emerald-200 hover:text-emerald-100"
              >
                Latest release v{APP_VERSION}
                <ArrowRight className="h-3 w-3" />
              </a>
              <div className="mt-6 grid gap-2">
                {["Direct first", "BLAKE3 verified", "No cloud upload"].map(
                  (item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-slate-100 backdrop-blur-xl"
                    >
                      {item}
                    </span>
                  ),
                )}
              </div>
            </aside>
          </div>
        </section>

        {isHome && (
          <section
            id="what-is"
            className="relative border-y border-white/8 bg-[#0a1511] px-4 py-16 sm:px-6"
            aria-labelledby="what-is-heading"
          >
            <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
                  Answer
                </p>
                <h2
                  id="what-is-heading"
                  className="mt-3 text-3xl font-semibold leading-tight text-white"
                >
                  What is Lightning P2P?
                </h2>
              </div>
              <div className="space-y-4 text-base leading-7 text-slate-200">
                <p>
                  <strong className="text-white">Lightning P2P</strong> is a
                  free, open-source Windows app that sends files directly from
                  one device to another over QUIC. Bytes stream from the
                  sender's disk, BLAKE3 verifies each chunk on the receiver,
                  and no file is ever uploaded to a cloud server.
                </p>
                <p className="text-slate-300">
                  It works as an AirDrop alternative for Windows, a WeTransfer
                  alternative without the cloud upload, and a no-terminal way
                  to send files directly with a polished desktop GUI. MIT
                  licensed on GitHub. Built with Rust, Tauri, iroh, and
                  iroh-blobs.
                </p>
              </div>
            </div>
          </section>
        )}

        {isHome && (
          <section
            className="border-b border-white/8 bg-[#f7f8f5] px-4 py-16 text-[#101411] sm:px-6"
            aria-labelledby="aeo-heading"
          >
            <div className="mx-auto max-w-5xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#4d6a3a]">
                Quick answer
              </p>
              <h2
                id="aeo-heading"
                className="mt-3 max-w-3xl text-3xl font-semibold leading-tight"
              >
                Best P2P file transfer for Windows users who want no account,
                no cloud upload, and verified bytes.
              </h2>
              <div className="mt-8 grid gap-3 md:grid-cols-3">
                {[
                  [
                    "For large files",
                    "Lightning P2P streams from disk instead of uploading to a storage bucket first.",
                  ],
                  [
                    "For privacy",
                    "Transfers use encrypted QUIC transport and BLAKE3 content verification.",
                  ],
                  [
                    "For reliability",
                    "iroh tries direct paths first and keeps relay-assisted reachability as fallback.",
                  ],
                ].map(([title, copy]) => (
                  <article
                    key={title}
                    className="rounded-[8px] border border-[#dfe5dc] bg-white/70 p-5"
                  >
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#435047]">
                      {copy}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="border-b border-white/8 bg-[#0e1b15] px-4 py-8 sm:px-6">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["$0", "Free and open source"],
              ["No account", "No cloud login"],
              ["QUIC + BLAKE3", "Encrypted, verified"],
              [`v${APP_VERSION}`, "Signed Windows release"],
            ].map(([value, label]) => (
              <div key={label} className={statCardClass()}>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-emerald-300/10 blur-2xl"
                />
                <p className="relative text-2xl font-semibold text-white">
                  {value}
                </p>
                <p className="relative mt-1 text-sm text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {isHome && <HowItWorks />}

        <section id="download" className="bg-[#08120f] px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
                Download
              </p>
              <h2 className="mt-4 text-4xl font-semibold leading-tight text-white">
                Pick your install flavor.
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-300">
                Three official install paths for Windows. Same signed binary
                underneath - pick the flow you prefer. MSI and checksums are in
                the release page for managed environments.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <article className="relative flex flex-col rounded-[14px] border border-emerald-300/30 bg-emerald-300/[0.04] p-6 transition-colors hover:border-emerald-300/50">
                <span className="absolute right-5 top-5 rounded-full bg-emerald-300/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-200">
                  Recommended
                </span>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-emerald-300/15 text-emerald-200 ring-1 ring-inset ring-emerald-300/25">
                  <Download className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-white">
                  NSIS setup
                </h3>
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-emerald-200/80">
                  Classic installer / signed auto-updates
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Familiar Windows installer flow, signed Tauri updater built
                  in, adds firewall rules for direct peer connections.
                </p>
                <a
                  href={EXE_DOWNLOAD_URL}
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-emerald-300 px-5 py-3 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-200"
                >
                  <Download className="h-4 w-4" />
                  Download .exe (NSIS)
                </a>
              </article>
              <article className="flex flex-col rounded-[14px] border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-emerald-300/25 hover:bg-white/[0.05]">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-white/10 text-white ring-1 ring-inset ring-white/15">
                  <Download className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-white">
                  Velopack setup
                </h3>
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-400">
                  Modern one-click / delta updates
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Discord-style splash, one-click install into your user
                  profile, delta updates (smaller patches) on every release.
                </p>
                <a
                  href={VELOPACK_DOWNLOAD_URL}
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-full border border-white/16 bg-white/8 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/14"
                >
                  <Download className="h-4 w-4" />
                  Download Velopack .exe
                </a>
              </article>
              <article className="flex flex-col rounded-[14px] border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-emerald-300/25 hover:bg-white/[0.05]">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-white/10 text-white ring-1 ring-inset ring-white/15">
                  <Terminal className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-white">
                  winget
                </h3>
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-400">
                  Command line / scriptable installs
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  For terminal regulars and IT provisioning. Pulls the signed
                  installer and tracks updates via the Windows Package Manager.
                </p>
                <code className="mt-6 inline-flex items-center justify-center gap-2 rounded-full border border-white/16 bg-black/40 px-5 py-3 text-sm font-mono text-emerald-200">
                  winget install lightning-p2p
                </code>
              </article>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
              <a
                href={MSI_DOWNLOAD_URL}
                className="inline-flex items-center gap-2 text-slate-300 underline-offset-4 hover:text-white hover:underline"
              >
                <Download className="h-4 w-4" /> Windows installer .msi
              </a>
              <span className="text-slate-700">/</span>
              <a
                href={RELEASE_URL}
                className="inline-flex items-center gap-2 text-slate-300 underline-offset-4 hover:text-white hover:underline"
              >
                Checksums and signatures
              </a>
              <span className="text-slate-700">/</span>
              <a
                href={RELEASE_URL}
                className="inline-flex items-center gap-2 text-slate-300 underline-offset-4 hover:text-white hover:underline"
              >
                All release artifacts
              </a>
            </div>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {proofPoints.map((item) => (
                <article
                  key={item.title}
                  className="rounded-[10px] border border-white/10 bg-white/[0.04] p-5 transition-colors hover:border-emerald-300/25 hover:bg-white/[0.06]"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-emerald-300/10 text-emerald-200 ring-1 ring-inset ring-emerald-300/20">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {isHome && <ComparisonTable />}

        <section
          id="security"
          className="bg-[#f3ead7] px-4 py-20 text-[#17201b] sm:px-6"
        >
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#806016]">
                  Security model
                </p>
                <h2 className="mt-4 text-4xl font-semibold leading-tight">
                  Private transfer claims should be specific.
                </h2>
                <p className="mt-5 text-base leading-7 text-[#425247]">
                  Lightning P2P avoids cloud file hosting, uses encrypted peer
                  transport, verifies content with BLAKE3, and ships signed
                  updater metadata. Those are concrete properties users can
                  inspect in the source and release artifacts.
                </p>
              </div>
              <dl className="grid gap-3">
                {[
                  ["Transport", "QUIC TLS 1.3 through iroh"],
                  ["Integrity", "BLAKE3 verified iroh-blobs streaming"],
                  ["Updates", "Signed Tauri updater releases on GitHub"],
                  ["Storage", "No server-side file bucket in the transfer path"],
                ].map(([term, detail]) => (
                  <div
                    key={term}
                    className="grid gap-1 rounded-[10px] border border-[#d7c69d] bg-white/60 p-4 sm:grid-cols-[130px_1fr]"
                  >
                    <dt className="font-semibold">{term}</dt>
                    <dd className="text-[#526156]">{detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section id="benchmarks" className="bg-[#111013] px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-200">
                Benchmark plan
              </p>
              <h2 className="mt-4 text-4xl font-semibold leading-tight text-white">
                The growth story should be credible before it is loud.
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-300">
                Lightning P2P can target searches like free P2P file transfer,
                AirDrop alternative for Windows, and transfer large files free.
                The strongest speed claims should wait for repeatable published
                measurements.
              </p>
            </div>
            <div className="mt-10 grid gap-3 md:grid-cols-2">
              {benchmarkRows.map((row) => (
                <div
                  key={row}
                  className="flex items-start gap-3 rounded-[10px] border border-white/10 bg-white/[0.04] p-4"
                >
                  <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
                  <p className="text-sm leading-6 text-slate-300">{row}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#08120f] px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {capabilityCards.map((item) => (
                <article
                  key={item.title}
                  className="rounded-[10px] border border-white/10 bg-white/[0.04] p-5 transition-colors hover:border-emerald-300/25 hover:bg-white/[0.06]"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-emerald-300/10 text-emerald-200 ring-1 ring-inset ring-emerald-300/20">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="faq"
          className="bg-[#f8faf7] px-4 py-20 text-[#111b16] sm:px-6"
        >
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#51733f]">
              FAQ
            </p>
            <h2 className="mt-4 text-4xl font-semibold leading-tight">
              Clear answers beat hype.
            </h2>
            <div className="mt-8 divide-y divide-[#d8e2d4] border-y border-[#d8e2d4]">
              {faqs.map((item) => (
                <details
                  key={item.q}
                  className="group py-5 [&_summary::-webkit-details-marker]:hidden"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
                    <h3 className="text-lg font-semibold">{item.q}</h3>
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#bccab2] text-[#51733f] transition-transform group-open:rotate-45"
                    >
                      <Plus className="h-4 w-4" />
                    </span>
                  </summary>
                  <p className="mt-3 pr-12 leading-7 text-[#405249]">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0e1b15] px-4 py-16 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                <Sparkles className="h-4 w-4" />
                Ready for Windows users
              </p>
              <h2 className="mt-3 text-3xl font-semibold text-white">
                Publish the website, collect trust, then ship browser/mobile.
              </h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href={`${canonicalUrl}#download`}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-100"
              >
                Current page
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href={EXE_DOWNLOAD_URL}
                className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-white/8 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/14"
              >
                Get the EXE installer
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#08120f] px-4 py-10 text-sm text-slate-400 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.2fr_2fr]">
          <div>
            <a href="/" className="flex items-center gap-3">
              <img
                src={siteLogoUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-[8px]"
              />
              <span className="text-sm font-semibold text-white">
                Lightning P2P
              </span>
            </a>
            <p className="mt-4 max-w-sm leading-6">
              Direct, encrypted, verified peer-to-peer file transfer for
              Windows. MIT licensed, built with Rust and Tauri.
            </p>
            <a
              href={REPO_URL}
              className="mt-5 inline-block"
              aria-label="GitHub stars for Lightning P2P"
            >
              <img
                src={GH_STARS_BADGE}
                alt="GitHub stars"
                className="h-7"
                loading="lazy"
                decoding="async"
              />
            </a>
          </div>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <div>
              <p className="font-semibold text-white">Product</p>
              <ul className="mt-3 space-y-2">
                {webPages
                  .filter((p) =>
                    [
                      "/",
                      "/download",
                      "/security",
                      "/benchmarks",
                      "/best-p2p-file-transfer",
                    ].includes(p.path),
                  )
                  .map((item) => (
                    <li key={item.path}>
                      <a href={item.path} className="hover:text-white">
                        {item.label}
                      </a>
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white">Compare</p>
              <ul className="mt-3 space-y-2">
                {webPages
                  .filter((p) =>
                    [
                      "/wetransfer-alternative",
                      "/localsend-vs-lightning-p2p",
                      "/alternatives/airdrop-for-windows",
                    ].includes(p.path),
                  )
                  .map((item) => (
                    <li key={item.path}>
                      <a href={item.path} className="hover:text-white">
                        {item.label}
                      </a>
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white">Resources</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <a href={REPO_URL} className="hover:text-white">
                    GitHub
                  </a>
                </li>
                <li>
                  <a href="/llms.txt" className="hover:text-white">
                    llms.txt
                  </a>
                </li>
                <li>
                  <a href="/sitemap.xml" className="hover:text-white">
                    sitemap.xml
                  </a>
                </li>
                <li>
                  <a
                    href={`${REPO_URL}/blob/main/CHANGELOG.md`}
                    className="hover:text-white"
                  >
                    Changelog
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-3 border-t border-white/10 pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>MIT licensed. Built with Rust + Tauri v2.</p>
          <p>
            <a
              href={`${REPO_URL}/blob/main/LICENSE`}
              className="hover:text-white"
            >
              License
            </a>
            <span className="mx-2 text-slate-700">/</span>
            <a
              href={`${REPO_URL}/blob/main/SECURITY.md`}
              className="hover:text-white"
            >
              Security
            </a>
            <span className="mx-2 text-slate-700">/</span>
            <a
              href={`${REPO_URL}/issues/new/choose`}
              className="hover:text-white"
            >
              Report an issue
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
