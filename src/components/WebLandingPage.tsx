import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Download,
  Github,
  Globe2,
  LockKeyhole,
  Network,
  RadioTower,
  ShieldCheck,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import packageJson from "../../package.json";
import markUrl from "../assets/lightning-p2p-mark.png";
import pages from "../content/web-pages.json";

interface WebPage {
  path: string;
  label: string;
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  intro: string;
  focus: string;
}

const SITE_URL = "https://lightning-p2p.netlify.app";
const APP_VERSION = packageJson.version;
const RELEASE_URL = "https://github.com/Kerim-Sabic/lightning-p2p/releases/latest";
const EXE_DOWNLOAD_URL = `https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/Lightning.P2P_${APP_VERSION}_x64-setup.exe`;
const MSI_DOWNLOAD_URL = `https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/Lightning.P2P_${APP_VERSION}_x64_en-US.msi`;
const REPO_URL = "https://github.com/Kerim-Sabic/lightning-p2p";
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
  "Comparison runs against LocalSend, PairDrop, Snapdrop, Magic Wormhole, and cloud upload/download flows",
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

const faqs = [
  {
    question: "Can I use Lightning P2P in a mobile browser today?",
    answer:
      "The public website works on mobile, but real transfers currently require the Windows desktop app. Browser and native mobile transfer support are planned as separate workstreams.",
  },
  {
    question: "Why not promise the fastest transfer app immediately?",
    answer:
      "The app is designed for high-throughput P2P transfer, but public fastest claims should be backed by repeatable tests with hardware, network route, file size, and version details.",
  },
  {
    question: "Does relay fallback mean my files are stored on a server?",
    answer:
      "No. Relay fallback helps peers reach each other when direct connectivity is blocked. Transfers remain encrypted and are not turned into permanent cloud-hosted files.",
  },
  {
    question: "Is the project open source?",
    answer:
      "Yes. The app is MIT licensed and built with Rust, Tauri, React, TypeScript, iroh, and iroh-blobs on GitHub.",
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

export function WebLandingPage() {
  const page = currentPage();
  const canonicalUrl = `${SITE_URL}${page.path === "/" ? "" : page.path}`;

  return (
    <div className="min-h-screen bg-[#08120f] text-white">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-[#08120f]/82 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="flex min-w-0 items-center gap-3">
            <img
              src={markUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-[10px]"
            />
            <span className="truncate text-sm font-semibold tracking-[0.02em]">
              Lightning P2P
            </span>
          </a>
          <nav className="hidden items-center gap-1 lg:flex">
            {webPages.slice(0, 4).map((item) => (
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
              EXE
            </a>
          </div>
        </div>
      </header>

      <main>
        <section
          className="relative flex min-h-[92vh] items-end overflow-hidden bg-cover bg-center pt-24"
          style={{ backgroundImage: "url('/web-hero.png')" }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,18,15,0.96)_0%,rgba(8,18,15,0.76)_45%,rgba(8,18,15,0.42)_100%)]" />
          <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 pb-12 sm:px-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(320px,0.58fr)] lg:pb-16">
            <div className="max-w-4xl">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-200">
                {page.eyebrow}
              </p>
              <h1 className="mt-5 max-w-4xl text-5xl font-semibold leading-[0.98] text-white sm:text-6xl lg:text-7xl">
                {page.heading}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
                {page.intro}
              </p>
              <p className="mt-4 max-w-2xl text-base leading-7 text-emerald-100/84">
                {page.focus}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={EXE_DOWNLOAD_URL}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-300 px-5 py-3 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-200"
                >
                  <Download className="h-4 w-4" />
                  Download EXE
                </a>
                <a
                  href={MSI_DOWNLOAD_URL}
                  className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-white/8 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/14"
                >
                  <Download className="h-4 w-4" />
                  Download MSI
                </a>
                <a
                  href={REPO_URL}
                  className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-white/8 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/14"
                >
                  <Github className="h-4 w-4" />
                  Star on GitHub
                </a>
              </div>
            </div>
            <aside className="self-end border-l border-white/12 pl-5 text-sm leading-6 text-slate-300">
              <p className="font-semibold text-white">Current launch target</p>
              <p className="mt-2">
                Windows desktop transfers now. Netlify-hosted website now.
                Browser and mobile transfer engines after the desktop path is
                benchmarked and stable.
              </p>
            </aside>
          </div>
        </section>

        <section className="border-y border-white/8 bg-[#0e1b15]">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px px-4 py-px sm:px-6 lg:grid-cols-4">
            {[
              ["0 USD", "Free and open source"],
              ["No account", "No cloud storage login"],
              ["QUIC + BLAKE3", "Encrypted, verified transfer"],
              ["v0.3.1", "Signed Windows release"],
            ].map(([value, label]) => (
              <div key={label} className="bg-[#0a1511] px-4 py-5">
                <p className="text-2xl font-semibold text-white">{value}</p>
                <p className="mt-1 text-sm text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="download" className="bg-[#08120f] px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
                  Desktop app
                </p>
                <h2 className="mt-4 text-4xl font-semibold leading-tight text-white">
                  Built for the transfer path that browsers cannot provide yet.
                </h2>
                <p className="mt-5 text-base leading-7 text-slate-300">
                  The desktop app can use iroh networking, local file access,
                  nearby discovery, firewall setup, signed updates, and native
                  installers. The web launch focuses on discovery and download
                  until browser/mobile transfer support is implemented honestly.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <a
                    href={EXE_DOWNLOAD_URL}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-300 px-5 py-3 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-200"
                  >
                    <Download className="h-4 w-4" />
                    Windows setup .exe
                  </a>
                  <a
                    href={MSI_DOWNLOAD_URL}
                    className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-white/8 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/14"
                  >
                    <Download className="h-4 w-4" />
                    Windows installer .msi
                  </a>
                  <a
                    href={RELEASE_URL}
                    className="inline-flex items-center gap-2 rounded-full border border-white/16 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/8 hover:text-white"
                  >
                    Checksums and signatures
                  </a>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {proofPoints.map((item) => (
                  <article
                    key={item.title}
                    className="rounded-[8px] border border-white/10 bg-white/[0.04] p-5"
                  >
                    <item.icon className="h-6 w-6 text-emerald-200" />
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
          </div>
        </section>

        <section id="security" className="bg-[#f3ead7] px-4 py-20 text-[#17201b] sm:px-6">
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
                    className="grid gap-1 rounded-[8px] border border-[#d7c69d] bg-white/50 p-4 sm:grid-cols-[130px_1fr]"
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
                  className="flex items-start gap-3 rounded-[8px] border border-white/10 bg-white/[0.04] p-4"
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
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {capabilityCards.map((item) => (
                <article
                  key={item.title}
                  className="rounded-[8px] border border-white/10 bg-white/[0.04] p-5"
                >
                  <item.icon className="h-6 w-6 text-emerald-200" />
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

        <section id="faq" className="bg-[#f8faf7] px-4 py-20 text-[#111b16] sm:px-6">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#51733f]">
              FAQ
            </p>
            <h2 className="mt-4 text-4xl font-semibold leading-tight">
              Clear answers beat hype.
            </h2>
            <div className="mt-8 divide-y divide-[#d8e2d4] border-y border-[#d8e2d4]">
              {faqs.map((item) => (
                <article key={item.question} className="py-6">
                  <h3 className="text-lg font-semibold">{item.question}</h3>
                  <p className="mt-3 leading-7 text-[#405249]">{item.answer}</p>
                </article>
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

      <footer className="border-t border-white/10 bg-[#08120f] px-4 py-8 text-sm text-slate-400 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p>Lightning P2P is MIT licensed and open source.</p>
          <div className="flex flex-wrap gap-4">
            {webPages.map((item) => (
              <a key={item.path} href={item.path} className="hover:text-white">
                {item.label}
              </a>
            ))}
            <a href={REPO_URL} className="hover:text-white">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
