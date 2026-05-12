import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  ChevronDown,
  ClipboardCheck,
  CloudOff,
  Code2,
  DatabaseZap,
  Download,
  FileCheck2,
  FileLock2,
  Files,
  Github,
  Globe2,
  HardDriveDownload,
  KeyRound,
  LockKeyhole,
  Menu,
  Minus,
  MonitorDown,
  Network,
  PackageCheck,
  QrCode,
  RadioTower,
  Route,
  ShieldCheck,
  Sparkles,
  Terminal,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import siteLogoUrl from "../assets/lightning-p2p-site-logo.png";
import pages from "../content/web-pages.json";
import {
  MSI_DOWNLOAD_URL,
  NSIS_DOWNLOAD_URL,
  RELEASE_URL,
  REPO_URL,
  VELOPACK_DOWNLOAD_URL,
  canonicalWebPath,
} from "../lib/shareLinks";
import { ReceiveHandoffPage } from "./ReceiveHandoffPage";

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

type ButtonVariant = "primary" | "secondary" | "ghost";
type CellTone = "positive" | "negative" | "neutral";

interface ComparisonCell {
  label: "Yes" | "No" | "Partial";
  tone: CellTone;
}

interface ComparisonRow {
  tool: string;
  detail: string;
  cloudUpload: ComparisonCell;
  account: ComparisonCell;
  wan: ComparisonCell;
  openSource: ComparisonCell;
  nativeWindows: ComparisonCell;
  verifiedContent: ComparisonCell;
}

interface KeyFact {
  label: string;
  value: string;
}

interface AnswerContent {
  answer: string;
  keyFacts: KeyFact[];
  caveats: string[];
}

const webPages = pages as WebPage[];

const publicReleaseVersion = "v0.4.0";

const baseKeyFacts: KeyFact[] = [
  { label: "Product", value: "Lightning P2P" },
  { label: "Category", value: "Peer-to-peer file transfer app" },
  { label: "Platform", value: "Windows public release" },
  { label: "License", value: "MIT" },
  { label: "Account required", value: "No" },
  { label: "Cloud upload", value: "No" },
  { label: "Artificial file-size cap", value: "No" },
  { label: "Transfer model", value: "Direct-first P2P" },
  { label: "Transport", value: "iroh / QUIC" },
  { label: "Verification", value: "BLAKE3" },
  { label: "Source code", value: "GitHub" },
  { label: "Cost", value: "Free" },
];

const baseCaveats = [
  "Sender must stay online until the receiver finishes.",
  "Tickets are capability tokens and should be treated as secrets.",
  "Relay fallback helps connectivity, but it is not cloud storage.",
  "The browser website is receive handoff and marketing, not the transfer engine.",
  "Public speed leadership claims require repeatable benchmark results.",
];

function answerContentForPage(page: WebPage): AnswerContent {
  const byPath: Record<string, string> = {
    "/":
      "Lightning P2P is a free open-source peer-to-peer file transfer app for Windows. It sends files directly between devices using iroh and QUIC, verifies content with BLAKE3, and does not require cloud upload, accounts, or artificial file-size caps.",
    "/download":
      "Download Lightning P2P from GitHub Releases when you want the public Windows installer for direct-first P2P file transfer. The recommended asset is the one-click Windows setup, with NSIS and MSI options available for alternate deployment paths.",
    "/security":
      "Lightning P2P avoids cloud file hosting, uses encrypted peer transport through iroh, verifies content with BLAKE3, and treats tickets as capability tokens. It makes specific security claims instead of broad privacy promises.",
    "/benchmarks":
      "Lightning P2P is designed for high-throughput direct transfer, but public speed claims should be tied to repeatable benchmark reports covering LAN direct, WAN direct, relay fallback, many small files, and large single files.",
    "/alternatives/airdrop-for-windows":
      "Lightning P2P is an open-source AirDrop-style file transfer app for Windows, focused on direct-first transfers, QR/link handoff, no account, and no cloud upload.",
    "/free-p2p-file-transfer":
      "Lightning P2P is a free P2P file transfer app for Windows with no account, no cloud upload, no artificial file-size cap, direct-first transfer, and BLAKE3 verification.",
    "/best-p2p-file-transfer":
      "Lightning P2P is a strong best-fit P2P file transfer choice for Windows users who want a free open-source desktop app, direct-first LAN and WAN transfer, no cloud upload, and verified content.",
    "/wetransfer-alternative":
      "WeTransfer is useful for hosted cloud links. Lightning P2P is better when you want to avoid uploading files to a cloud storage service and transfer directly from sender to receiver.",
    "/wormhole-alternative":
      "Magic Wormhole is a strong CLI file transfer tool. Lightning P2P serves users who want a graphical Windows app with link and QR handoff, iroh connectivity, and BLAKE3 verification.",
    "/localsend-vs-lightning-p2p":
      "LocalSend is best for cross-platform LAN sharing today. Lightning P2P is Windows-first and focuses on direct-first LAN and WAN transfers with iroh, QUIC, relay fallback, and BLAKE3 verification.",
    "/how-to-send-large-files":
      "To send large files peer-to-peer on Windows, install Lightning P2P, drop files into the Send view, share the receive link or QR, and keep the sender online while the receiver streams verified bytes to disk.",
    "/send-files-between-windows-computers":
      "Lightning P2P sends files between Windows computers through a native desktop app with no account, no cloud upload, no artificial file-size cap, direct-first connectivity, and BLAKE3 verification.",
  };

  return {
    answer: byPath[page.path] ?? `${page.intro} ${page.focus}`,
    keyFacts: baseKeyFacts,
    caveats: baseCaveats,
  };
}

const defaultFaqs: Faq[] = [
  {
    q: "Is Lightning P2P free?",
    a: "Yes. Lightning P2P is free, open source, and MIT licensed.",
  },
  {
    q: "Does it upload files to the cloud?",
    a: "No cloud upload is part of the product model. The sender stays online and the receiver pulls the file through iroh connectivity.",
  },
  {
    q: "Does relay fallback store my files?",
    a: "No. Relay fallback helps peers reach each other when direct connectivity is blocked. It is not a cloud bucket or hosted retention service.",
  },
  {
    q: "Do I need an account?",
    a: "No. There is no login, email capture, or paid account tier required to send or receive.",
  },
  {
    q: "Can I use it in a browser?",
    a: "No. The browser site handles receive handoff and marketing. Real file transfer requires the native Lightning P2P app.",
  },
  {
    q: "Does the sender need to stay online?",
    a: "Yes. The sender must keep Lightning P2P open and keep the content available until the receiver finishes.",
  },
  {
    q: "Is there a file size limit?",
    a: "Lightning P2P does not impose an artificial file-size cap. Disk space, filesystem limits, network stability, and time still matter.",
  },
  {
    q: "Is it open source?",
    a: "Yes. The project is MIT licensed and available on GitHub with Rust, Tauri, React, TypeScript, iroh, QUIC, and BLAKE3 in the stack.",
  },
  {
    q: "Is it available for macOS or Linux?",
    a: "Not yet. Windows is the public release target. macOS and Linux packaging are planned after the Windows path is stable.",
  },
  {
    q: "How does it compare to LocalSend?",
    a: "LocalSend is excellent for cross-platform LAN sharing. Lightning P2P is Windows-first and designed around direct-first LAN and WAN transfer through iroh.",
  },
  {
    q: "How does it compare to WeTransfer?",
    a: "WeTransfer uploads files to a hosted service. Lightning P2P keeps the file on the sender and streams it to the receiver directly when possible.",
  },
  {
    q: "Are tickets secret?",
    a: "Yes. Tickets are capability tokens. Anyone with a valid ticket can request that transfer while the sender is online, so treat tickets like secrets.",
  },
];

const trustBadges: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Github, label: "Open source" },
  { icon: BadgeCheck, label: "MIT licensed" },
  { icon: Code2, label: "Rust-native" },
  { icon: MonitorDown, label: "Tauri v2" },
  { icon: Route, label: "QUIC transport" },
  { icon: FileCheck2, label: "BLAKE3 verification" },
  { icon: CloudOff, label: "No cloud bucket" },
  { icon: KeyRound, label: "No sign-up" },
];

const problemCards = [
  {
    icon: CloudOff,
    title: "Cloud tools add a middleman",
    copy: "Private files are uploaded to someone else's storage before the receiver downloads them.",
  },
  {
    icon: RadioTower,
    title: "LAN-only tools stop at the router",
    copy: "Nearby sharing feels great until the devices are on different networks.",
  },
  {
    icon: Terminal,
    title: "CLI tools are not for everyone",
    copy: "Powerful transfer primitives need a simple Windows workflow for normal users.",
  },
];

const workflowSteps = [
  {
    icon: Upload,
    title: "Drop files",
    copy: "Choose a file or folder. Lightning P2P prepares it locally.",
  },
  {
    icon: QrCode,
    title: "Share ticket",
    copy: "Send a link, QR code, or raw ticket to the receiver.",
  },
  {
    icon: ClipboardCheck,
    title: "Receive directly",
    copy: "The receiver connects and streams verified bytes to disk.",
  },
];

const featureCards: Array<{
  icon: LucideIcon;
  title: string;
  copy: string;
  className?: string;
}> = [
  {
    icon: CloudOff,
    title: "No cloud upload",
    copy: "Files are not stored in a third-party bucket.",
    className: "lg:col-span-2",
  },
  {
    icon: KeyRound,
    title: "No account",
    copy: "No login, email capture, or paid tier required.",
  },
  {
    icon: Network,
    title: "Direct-first transfer",
    copy: "Peers connect directly when the network allows it.",
    className: "lg:row-span-2",
  },
  {
    icon: Globe2,
    title: "WAN capable",
    copy: "Relay-assisted fallback helps when NAT or firewalls block the direct path.",
  },
  {
    icon: FileCheck2,
    title: "Verified bytes",
    copy: "BLAKE3 verification checks content integrity during transfer.",
  },
  {
    icon: MonitorDown,
    title: "Native Windows app",
    copy: "A real desktop app, not just a browser tab.",
  },
  {
    icon: Github,
    title: "Open source",
    copy: "MIT licensed and auditable.",
  },
  {
    icon: Code2,
    title: "Built with Rust",
    copy: "Designed for reliability, performance, and safety.",
    className: "lg:col-span-2",
  },
  {
    icon: PackageCheck,
    title: "Installer options",
    copy: "Velopack, NSIS, MSI, and source build paths.",
  },
  {
    icon: QrCode,
    title: "QR and link handoff",
    copy: "Share a normal link, QR code, or raw ticket.",
  },
  {
    icon: RadioTower,
    title: "Nearby LAN discovery",
    copy: "Active shares can appear automatically on the same network.",
  },
  {
    icon: ClipboardCheck,
    title: "Transfer history",
    copy: "Review completed sends and receives locally.",
  },
  {
    icon: Route,
    title: "Relay-aware diagnostics",
    copy: "See whether the current route is direct, relay, or still unknown.",
    className: "lg:col-span-2",
  },
];

const securityCards = [
  {
    icon: LockKeyhole,
    title: "Transport",
    copy: "QUIC TLS through iroh peer connectivity.",
  },
  {
    icon: FileCheck2,
    title: "Integrity",
    copy: "BLAKE3 verified streaming through iroh-blobs.",
  },
  {
    icon: DatabaseZap,
    title: "Storage",
    copy: "No server-side file bucket in the transfer path.",
  },
  {
    icon: KeyRound,
    title: "Tickets",
    copy: "Capability tokens. Treat them as secrets.",
  },
  {
    icon: Upload,
    title: "Sender availability",
    copy: "The sender must stay online until the receiver finishes.",
  },
  {
    icon: RadioTower,
    title: "Relay fallback",
    copy: "Connectivity helper, not a cloud file bucket.",
  },
  {
    icon: BadgeCheck,
    title: "Updates",
    copy: "Updater metadata signatures when release signing is configured.",
  },
  {
    icon: ShieldCheck,
    title: "Windows",
    copy: "Code-signing support is built into the release pipeline.",
  },
];

const comparisonRows: ComparisonRow[] = [
  {
    tool: "Lightning P2P",
    detail: "Direct-first Windows app",
    cloudUpload: { label: "No", tone: "positive" },
    account: { label: "No", tone: "positive" },
    wan: { label: "Yes", tone: "positive" },
    openSource: { label: "Yes", tone: "positive" },
    nativeWindows: { label: "Yes", tone: "positive" },
    verifiedContent: { label: "Yes", tone: "positive" },
  },
  {
    tool: "WeTransfer",
    detail: "Hosted upload link",
    cloudUpload: { label: "Yes", tone: "negative" },
    account: { label: "Partial", tone: "neutral" },
    wan: { label: "Yes", tone: "positive" },
    openSource: { label: "No", tone: "negative" },
    nativeWindows: { label: "No", tone: "negative" },
    verifiedContent: { label: "No", tone: "negative" },
  },
  {
    tool: "LocalSend",
    detail: "Cross-platform LAN sharing",
    cloudUpload: { label: "No", tone: "positive" },
    account: { label: "No", tone: "positive" },
    wan: { label: "No", tone: "neutral" },
    openSource: { label: "Yes", tone: "positive" },
    nativeWindows: { label: "Yes", tone: "positive" },
    verifiedContent: { label: "Partial", tone: "neutral" },
  },
  {
    tool: "PairDrop",
    detail: "Browser WebRTC sharing",
    cloudUpload: { label: "No", tone: "positive" },
    account: { label: "No", tone: "positive" },
    wan: { label: "Partial", tone: "neutral" },
    openSource: { label: "Yes", tone: "positive" },
    nativeWindows: { label: "No", tone: "neutral" },
    verifiedContent: { label: "No", tone: "negative" },
  },
  {
    tool: "Snapdrop",
    detail: "Browser local sharing",
    cloudUpload: { label: "No", tone: "positive" },
    account: { label: "No", tone: "positive" },
    wan: { label: "No", tone: "neutral" },
    openSource: { label: "Yes", tone: "positive" },
    nativeWindows: { label: "No", tone: "neutral" },
    verifiedContent: { label: "No", tone: "negative" },
  },
  {
    tool: "Magic Wormhole",
    detail: "Command-line transfer",
    cloudUpload: { label: "No", tone: "positive" },
    account: { label: "No", tone: "positive" },
    wan: { label: "Yes", tone: "positive" },
    openSource: { label: "Yes", tone: "positive" },
    nativeWindows: { label: "Partial", tone: "neutral" },
    verifiedContent: { label: "Yes", tone: "positive" },
  },
  {
    tool: "Windows Nearby Sharing",
    detail: "OS proximity sharing",
    cloudUpload: { label: "No", tone: "positive" },
    account: { label: "No", tone: "positive" },
    wan: { label: "No", tone: "neutral" },
    openSource: { label: "No", tone: "negative" },
    nativeWindows: { label: "Yes", tone: "positive" },
    verifiedContent: { label: "No", tone: "negative" },
  },
];

const benchmarkCards = [
  "LAN direct",
  "WAN direct",
  "Relay fallback",
  "Many small files",
  "Large single file",
];

const platformStatus = [
  { label: "Windows", value: "Public release", tone: "positive" },
  { label: "Android", value: "Alpha foundation", tone: "neutral" },
  { label: "macOS / Linux", value: "Planned", tone: "neutral" },
  { label: "iOS", value: "Not shipped", tone: "muted" },
  { label: "Browser", value: "Receive handoff only", tone: "muted" },
];

function currentPage(): WebPage {
  const path = window.location.pathname.replace(/\/$/u, "") || "/";
  const homePage = webPages.find((page) => page.path === "/");

  if (!homePage) {
    throw new Error("Missing home page metadata.");
  }

  return webPages.find((page) => page.path === path) ?? homePage;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function MarketingButton({
  href,
  children,
  variant = "primary",
  className,
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      className={cx(
        "group inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 active:scale-[0.98]",
        variant === "primary" &&
          "bg-[linear-gradient(180deg,#b7ffdc,#73f2b7)] text-[#041713] shadow-[0_0_0_1px_rgba(183,255,220,0.45),0_18px_48px_rgba(52,211,153,0.24)] hover:shadow-[0_0_0_1px_rgba(183,255,220,0.72),0_22px_64px_rgba(52,211,153,0.3)]",
        variant === "secondary" &&
          "border border-white/12 bg-white/[0.06] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl hover:border-emerald-200/30 hover:bg-white/[0.1]",
        variant === "ghost" &&
          "text-slate-300 hover:bg-white/[0.06] hover:text-white",
        className,
      )}
    >
      {children}
    </a>
  );
}

function SectionHeading({
  eyebrow,
  title,
  copy,
  align = "left",
}: {
  eyebrow: string;
  title: string;
  copy?: string;
  align?: "left" | "center";
}) {
  return (
    <div
      className={cx(
        "max-w-3xl",
        align === "center" && "mx-auto text-center",
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-[clamp(2.15rem,4.6vw,4.2rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-white">
        {title}
      </h2>
      {copy ? (
        <p className="mt-5 text-base leading-7 text-slate-300 sm:text-lg">
          {copy}
        </p>
      ) : null}
    </div>
  );
}

function Header({ activePath }: { activePath: string }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = (): void => {
      setScrolled(window.scrollY > 12);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navItems = [
    { label: "Product", href: "/#product" },
    { label: "Security", href: "/security" },
    { label: "Compare", href: "/localsend-vs-lightning-p2p" },
    { label: "Download", href: "/download" },
  ];

  return (
    <header
      className={cx(
        "fixed inset-x-0 top-0 z-50 transition duration-200",
        scrolled
          ? "border-b border-white/10 bg-[#050807]/82 shadow-[0_16px_60px_rgba(0,0,0,0.22)] backdrop-blur-2xl"
          : "border-b border-white/0 bg-[#050807]/52 backdrop-blur-xl",
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <a
          href="/"
          className="group flex min-w-0 items-center gap-3 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
          aria-label="Lightning P2P home"
        >
          <img
            src={siteLogoUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-[10px] shadow-[0_0_28px_rgba(52,211,153,0.16)]"
          />
          <span className="truncate text-sm font-semibold tracking-[0.01em] text-white">
            Lightning P2P
          </span>
        </a>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {navItems.map((item) => {
            const active =
              activePath === item.href ||
              (item.href !== "/" && activePath === item.href.split("#")[0]);
            return (
              <a
                key={item.href}
                href={item.href}
                className={cx(
                  "rounded-full px-3 py-1.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300",
                  active
                    ? "bg-white/10 text-white"
                    : "text-slate-300 hover:bg-white/[0.06] hover:text-white",
                )}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden sm:block">
            <a
              href={REPO_URL}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-200 transition hover:border-emerald-200/30 hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
              aria-label="Open Lightning P2P on GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
          <div className="hidden sm:block">
            <MarketingButton href={VELOPACK_DOWNLOAD_URL}>
              <Download className="h-4 w-4" />
              Download
            </MarketingButton>
          </div>
          <div className="md:hidden">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white transition hover:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
              aria-label="Toggle navigation menu"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {open ? (
        <div className="border-t border-white/10 bg-[#050807]/96 px-4 pb-4 pt-2 backdrop-blur-2xl md:hidden">
          <nav className="mx-auto grid max-w-7xl gap-1" aria-label="Mobile">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-[12px] px-3 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/[0.06] hover:text-white"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <a
              href={REPO_URL}
              className="rounded-[12px] px-3 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/[0.06] hover:text-white"
              onClick={() => setOpen(false)}
            >
              GitHub
            </a>
            <MarketingButton
              href={VELOPACK_DOWNLOAD_URL}
              className="mt-2 w-full"
              ariaLabel="Download Lightning P2P for Windows"
            >
              <Download className="h-4 w-4" />
              Download for Windows
            </MarketingButton>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

function Hero({ page, isHome }: { page: WebPage; isHome: boolean }) {
  const headline = isHome ? "Open-source AirDrop for Windows." : page.heading;
  const subheadline = isHome
    ? "Send huge files directly between devices. No cloud upload, no account, no artificial file-size cap. Built with Rust, Tauri, iroh, QUIC, and BLAKE3."
    : `${page.intro} ${page.focus}`;

  return (
    <section
      id="product"
      className="relative isolate min-h-[100svh] overflow-hidden bg-[#050807] px-4 pb-16 pt-28 sm:px-6 lg:flex lg:items-center lg:pb-14 lg:pt-24"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-[radial-gradient(900px_circle_at_18%_12%,rgba(44,255,169,0.18),transparent_44%),radial-gradient(760px_circle_at_78%_18%,rgba(56,189,248,0.12),transparent_44%),linear-gradient(180deg,#050807_0%,#07110d_45%,#050807_100%)]"
      />
      <div aria-hidden="true" className="marketing-grid-bg absolute inset-0 -z-10" />
      <div className="mx-auto grid w-full min-w-0 max-w-[1360px] items-center gap-12 lg:grid-cols-[minmax(0,1.04fr)_minmax(430px,0.76fr)] lg:gap-8 xl:grid-cols-[minmax(0,1.04fr)_minmax(520px,0.76fr)] xl:gap-12">
        <div className="w-full min-w-0 max-w-[calc(100vw-2rem)] overflow-hidden sm:max-w-[820px]">
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200/15 bg-emerald-300/[0.06] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200 shadow-[0_0_32px_rgba(16,185,129,0.08)]">
            <Sparkles className="h-3.5 w-3.5" />
            {isHome ? "Lightning P2P" : page.eyebrow}
          </p>
          <h1 className="mt-6 max-w-[820px] text-[clamp(2.75rem,11vw,3.35rem)] font-semibold leading-[0.96] tracking-[-0.05em] text-white sm:text-[clamp(3.35rem,8vw,4rem)] lg:text-[clamp(4rem,5.2vw,4.7rem)]">
            {isHome ? (
              <>
                <span className="block xl:whitespace-nowrap">Open-source AirDrop</span>
                <span className="block">for Windows.</span>
              </>
            ) : (
              headline
            )}
          </h1>
          <p className="mt-7 max-w-[calc(100vw-2rem)] text-[1.04rem] leading-8 text-slate-300 sm:max-w-[620px] sm:text-xl">
            {subheadline}
          </p>
          <div className="mt-8 flex w-full max-w-[calc(100vw-2rem)] flex-col gap-3 sm:max-w-full sm:flex-row sm:flex-wrap sm:items-center">
            <MarketingButton
              href={VELOPACK_DOWNLOAD_URL}
              className="w-full min-h-12 px-5 sm:w-auto sm:min-w-[188px]"
              ariaLabel="Download Lightning P2P for Windows"
            >
              <Download className="h-4 w-4" />
              Download for Windows
            </MarketingButton>
            <MarketingButton
              href={REPO_URL}
              variant="secondary"
              className="w-full min-h-12 px-5 sm:w-auto sm:min-w-[166px]"
              ariaLabel="Star Lightning P2P on GitHub"
            >
              <Github className="h-4 w-4" />
              Star on GitHub
            </MarketingButton>
            <MarketingButton
              href="#security"
              variant="ghost"
              className="w-full min-h-12 px-4 sm:w-auto"
            >
              Security model
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </MarketingButton>
          </div>
          <ul className="mt-7 flex max-w-[calc(100vw-2rem)] flex-wrap gap-x-4 gap-y-2 text-sm text-slate-400 sm:max-w-[620px]">
            {[
              "MIT licensed",
              "No account",
              "No cloud storage",
              "Verified transfers",
              "Windows-first",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <HeroTransferVisual />
      </div>
    </section>
  );
}

function HeroTransferVisual() {
  return (
    <div
      className="relative mx-auto w-full min-w-0 max-w-full sm:max-w-[620px] lg:mr-0"
      aria-label="Animated peer-to-peer file transfer preview"
    >
      <div className="absolute -inset-6 rounded-[44px] bg-emerald-300/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#07110d]/74 p-4 shadow-[0_32px_140px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:p-5">
        <div className="absolute inset-0 bg-[radial-gradient(680px_circle_at_50%_35%,rgba(74,222,128,0.13),transparent_56%)]" />
        <div className="relative">
          <div className="flex min-h-14 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src={siteLogoUrl}
                alt=""
                className="h-10 w-10 rounded-[10px]"
                loading="eager"
                decoding="async"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Transfer ready</p>
                <p className="truncate text-xs text-slate-400">ticket://iroh/blob</p>
              </div>
            </div>
            <span className="hidden shrink-0 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-200 sm:inline-flex">
              Direct path
            </span>
          </div>

          <div className="relative mt-4 min-h-[360px] overflow-hidden rounded-[24px] border border-white/10 bg-black/28 p-4 sm:min-h-[430px] lg:min-h-[420px] xl:min-h-[460px]">
            <div aria-hidden="true" className="absolute inset-0 transfer-noise" />
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-[9%] h-[82%] w-[82%]"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <path
                className="hero-transfer-path"
                d="M 18 25 C 38 32, 56 58, 82 73"
              />
            </svg>

            <HeroDeviceCard
              className="absolute left-[6%] top-[8%] z-10 w-[40%] max-w-[220px]"
              title="Sender"
              subtitle="Windows PC"
              icon={Files}
              lines={["project.mov", "Ready to share"]}
            />
            <HeroDeviceCard
              className="absolute bottom-[7%] right-[6%] z-10 w-[42%] max-w-[236px]"
              title="Receiver"
              subtitle="Windows laptop"
              icon={HardDriveDownload}
              lines={["Downloads", "BLAKE3"]}
              qrLabel="Capability token"
            />

            <div className="absolute left-[16%] right-[54%] top-[59%] z-[5] rounded-full border border-white/10 bg-white/[0.04] p-1">
              <div className="transfer-progress h-2 rounded-full bg-[linear-gradient(90deg,#5eead4,#86efac,#d9f99d)]" />
            </div>

            <div className="marketing-file-card absolute left-[43%] top-[51%] z-20">
              <div className="flex items-center gap-3 rounded-[16px] border border-emerald-200/30 bg-[#07110d] px-3.5 py-3 shadow-[0_18px_58px_rgba(0,0,0,0.42),0_0_48px_rgba(52,211,153,0.16)] sm:px-4">
                <FileLock2 className="h-5 w-5 text-emerald-200" />
                <div>
                  <p className="text-sm font-semibold text-white">project.mov</p>
                  <p className="text-xs text-slate-400">streaming chunks</p>
                </div>
              </div>
            </div>

            <div className="absolute right-[8%] top-[31%] z-10 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 backdrop-blur-xl">
              Relay fallback ready
            </div>
            <div className="verification-pop absolute bottom-[8%] left-[8%] z-10 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100 backdrop-blur-xl">
              <Check className="mr-1.5 inline h-3.5 w-3.5" />
              BLAKE3 verified
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroDeviceCard({
  title,
  subtitle,
  icon: Icon,
  lines,
  qrLabel,
  className,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  lines: string[];
  qrLabel?: string;
  className: string;
}) {
  return (
    <div
      className={cx(
        "rounded-[18px] border border-white/10 bg-white/[0.065] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl sm:p-3.5",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-emerald-300/20 bg-emerald-300/10 text-emerald-200 sm:h-9 sm:w-9">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="mt-3 hidden gap-1.5 sm:grid">
        {lines.map((line) => (
          <div
            key={line}
            className="truncate rounded-full border border-white/8 bg-black/20 px-3 py-1 text-xs text-slate-300"
          >
            {line}
          </div>
        ))}
      </div>
      {qrLabel ? (
        <div className="mt-3 hidden items-center justify-between gap-3 rounded-[14px] border border-white/10 bg-black/20 p-2 sm:flex">
          <span className="min-w-0 truncate text-[0.68rem] font-medium text-slate-300">
            {qrLabel}
          </span>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-emerald-300/20 bg-emerald-300/10 text-emerald-100 sm:h-9 sm:w-9">
            <QrCode className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
            <span className="sr-only">QR ticket visual</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function TrustBadges() {
  return (
    <section className="border-y border-white/8 bg-[#08110d] px-4 py-6 sm:px-6">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {trustBadges.map((badge) => (
          <div
            key={badge.label}
            className="group flex items-center gap-2 rounded-[12px] border border-white/8 bg-white/[0.035] px-3 py-3 text-sm text-slate-300 transition hover:-translate-y-0.5 hover:border-emerald-300/24 hover:bg-white/[0.06] hover:text-white"
          >
            <badge.icon className="h-4 w-4 shrink-0 text-emerald-300 transition group-hover:drop-shadow-[0_0_10px_rgba(110,231,183,0.6)]" />
            <span className="truncate">{badge.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AnswerBlocks({ page }: { page: WebPage }) {
  const content = answerContentForPage(page);

  return (
    <section className="border-b border-white/8 bg-[#050807] px-4 py-16 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1.08fr_0.92fr]">
        <article className="rounded-[22px] border border-emerald-300/18 bg-emerald-300/[0.055] p-6 shadow-[0_0_72px_rgba(16,185,129,0.07)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200">
            Direct answer
          </p>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
            What answer engines should know.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-200">
            {content.answer}
          </p>
        </article>

        <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-[22px] border border-white/10 bg-white/[0.035] p-6">
            <p className="text-sm font-semibold text-white">Key facts</p>
            <dl className="mt-4 grid gap-2">
              {content.keyFacts.slice(0, 8).map((fact) => (
                <div
                  key={fact.label}
                  className="flex items-start justify-between gap-4 rounded-[12px] border border-white/8 bg-black/20 px-3 py-2"
                >
                  <dt className="text-xs text-slate-500">{fact.label}</dt>
                  <dd className="text-right text-xs font-semibold text-slate-200">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/[0.035] p-6">
            <p className="text-sm font-semibold text-white">Caveats</p>
            <ul className="mt-4 grid gap-2">
              {content.caveats.slice(0, 4).map((caveat) => (
                <li
                  key={caveat}
                  className="flex gap-2 text-sm leading-6 text-slate-400"
                >
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300/80" />
                  <span>{caveat}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}

function RouteArticle({ page }: { page: WebPage }) {
  const relatedPages = useMemo(
    () =>
      (page.related ?? [])
        .map((path) => webPages.find((candidate) => candidate.path === path))
        .filter((candidate): candidate is WebPage => Boolean(candidate)),
    [page.related],
  );

  if (!page.body?.length && relatedPages.length === 0) {
    return null;
  }

  return (
    <section className="border-b border-white/8 bg-[#050807] px-4 py-16 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.035] p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">
            Page focus
          </p>
          <div className="mt-5 grid gap-5 text-base leading-7 text-slate-300">
            {(page.body ?? [page.intro, page.focus]).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
        {relatedPages.length > 0 ? (
          <aside className="rounded-[22px] border border-white/10 bg-white/[0.035] p-6">
            <p className="text-sm font-semibold text-white">Related pages</p>
            <div className="mt-4 grid gap-2">
              {relatedPages.map((related) => (
                <a
                  key={related.path}
                  href={canonicalWebPath(related.path)}
                  className="group rounded-[14px] border border-white/8 bg-black/18 p-4 transition hover:border-emerald-300/24 hover:bg-white/[0.05]"
                >
                  <span className="text-sm font-semibold text-white">
                    {related.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-400">
                    {related.description}
                  </span>
                </a>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

function ProblemSection() {
  return (
    <section className="bg-[#050807] px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Why this exists"
          title="File sharing still feels broken."
          copy="Cloud tools are convenient, but they put someone else's server in the middle. LAN tools are fast, but often fail outside the same network. Lightning P2P keeps the workflow simple and makes the transfer direct-first."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {problemCards.map((card) => (
            <article
              key={card.title}
              className="group rounded-[18px] border border-white/10 bg-white/[0.035] p-6 transition duration-200 hover:-translate-y-1 hover:border-emerald-300/25 hover:bg-white/[0.055]"
            >
              <span className="grid h-11 w-11 place-items-center rounded-[12px] border border-white/10 bg-white/[0.05] text-emerald-200 transition group-hover:border-emerald-300/25 group-hover:bg-emerald-300/10">
                <card.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-6 text-xl font-semibold tracking-[-0.01em] text-white">
                {card.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                {card.copy}
              </p>
            </article>
          ))}
        </div>
        <p className="mt-8 max-w-3xl text-xl leading-8 text-slate-200">
          Lightning P2P keeps the simple workflow, but removes the cloud
          middleman.
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-24 bg-[#07110d] px-4 py-24 sm:px-6"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Product demo"
          title="Three steps. No cloud round trip."
          copy="A sender creates a ticket, the receiver opens it, and verified bytes stream to disk."
          align="center"
        />
        <div className="relative mt-14">
          <div
            aria-hidden="true"
            className="absolute left-[16%] right-[16%] top-12 hidden h-px bg-[linear-gradient(90deg,transparent,rgba(110,231,183,0.72),transparent)] md:block"
          />
          <ol className="grid gap-4 md:grid-cols-3">
            {workflowSteps.map((step, index) => (
              <li
                key={step.title}
                className="group relative rounded-[20px] border border-white/10 bg-[#0b1712] p-6 transition duration-200 hover:-translate-y-1 hover:border-emerald-300/25 hover:bg-[#0f1f18]"
              >
                <span className="absolute right-5 top-5 text-5xl font-semibold leading-none text-white/[0.045]">
                  {index + 1}
                </span>
                <span className="relative z-10 grid h-12 w-12 place-items-center rounded-[14px] border border-emerald-300/18 bg-emerald-300/10 text-emerald-200 shadow-[0_0_30px_rgba(16,185,129,0.08)]">
                  <step.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-6 text-xl font-semibold text-white">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  {step.copy}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const proofItems: Array<{ icon: LucideIcon; title: string; copy: string }> = [
  {
    icon: Upload,
    title: "Drop zone",
    copy: "Choose files or folders, then generate one receive link.",
  },
  {
    icon: QrCode,
    title: "QR and raw ticket",
    copy: "Receivers can scan, open a link, or paste the raw ticket.",
  },
  {
    icon: RadioTower,
    title: "Nearby shares",
    copy: "Same-LAN senders appear automatically when discovery is enabled.",
  },
  {
    icon: FileCheck2,
    title: "Active progress",
    copy: "Route, speed, ETA, verification, and saved path stay visible.",
  },
  {
    icon: Route,
    title: "Network state",
    copy: "Direct, relay, and warming states are explicit in the app.",
  },
  {
    icon: ClipboardCheck,
    title: "Transfer history",
    copy: "Completed sends can be found and re-shared from local history.",
  },
];

function NativeAppProof() {
  return (
    <section className="bg-[#050807] px-4 py-24 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <SectionHeading
          eyebrow="Native app proof"
          title="The website is the handoff. The app does the transfer."
          copy="Lightning P2P's real transfer flow lives in the Rust/Tauri desktop app: send staging, receive tickets, nearby discovery, active progress, diagnostics, and history."
        />

        <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1712] p-4 shadow-[0_28px_100px_rgba(0,0,0,0.35)]">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(420px_circle_at_18%_10%,rgba(110,231,183,0.13),transparent_50%),radial-gradient(520px_circle_at_88%_90%,rgba(56,189,248,0.1),transparent_54%)]"
          />
          <div className="relative rounded-[20px] border border-white/10 bg-black/28 p-4">
            <div className="flex items-center justify-between border-b border-white/8 pb-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-300/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/80" />
              </div>
              <span className="rounded-full border border-emerald-300/18 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                Direct ready
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {proofItems.map((item) => (
                <article
                  key={item.title}
                  className="rounded-[16px] border border-white/8 bg-white/[0.04] p-4"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-[12px] border border-white/10 bg-white/[0.05] text-emerald-200">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {item.copy}
                  </p>
                </article>
              ))}
            </div>

            <div className="mt-4 rounded-[16px] border border-emerald-300/16 bg-emerald-300/[0.07] p-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-semibold text-emerald-100">
                  sample-video.mov
                </span>
                <span className="text-slate-300">BLAKE3 verified</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/35">
                <div className="marketing-progress-fill h-full rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureBento() {
  return (
    <section className="bg-[#050807] px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="What you get"
          title="A serious file transfer tool without service baggage."
          copy="The app keeps the user-facing workflow small while the Rust backend handles connectivity, transfer, and verification."
        />
        <div className="mt-12 grid auto-rows-[minmax(180px,auto)] gap-4 md:grid-cols-2 lg:grid-cols-4">
          {featureCards.map((card) => (
            <article
              key={card.title}
              className={cx(
                "group relative overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035] p-6 transition duration-200 hover:-translate-y-1 hover:border-emerald-300/25 hover:bg-white/[0.055]",
                card.className,
              )}
            >
              <div
                aria-hidden="true"
                className="absolute -right-14 -top-14 h-32 w-32 rounded-full bg-emerald-300/8 blur-3xl transition group-hover:bg-emerald-300/14"
              />
              <span className="relative grid h-11 w-11 place-items-center rounded-[12px] border border-white/10 bg-white/[0.05] text-emerald-200">
                <card.icon className="h-5 w-5" />
              </span>
              <h3 className="relative mt-6 text-xl font-semibold tracking-[-0.01em] text-white">
                {card.title}
              </h3>
              <p className="relative mt-3 max-w-sm text-sm leading-6 text-slate-400">
                {card.copy}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SecurityCards() {
  return (
    <section
      id="security"
      className="scroll-mt-24 bg-[#07110d] px-4 py-24 sm:px-6"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-[0.86fr_1.14fr] lg:items-start">
          <SectionHeading
            eyebrow="Security model"
            title="Specific privacy, not vague promises."
            copy="Lightning P2P avoids cloud file hosting, uses encrypted peer transport, verifies content with BLAKE3, and treats tickets as capability tokens."
          />
          <div>
            <div className="grid gap-4 sm:grid-cols-2">
              {securityCards.map((card) => (
                <article
                  key={card.title}
                  className="group rounded-[18px] border border-white/10 bg-white/[0.035] p-5 transition duration-200 hover:-translate-y-1 hover:border-emerald-300/24 hover:bg-white/[0.055]"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-[12px] border border-emerald-300/16 bg-emerald-300/10 text-emerald-200">
                    <card.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 font-semibold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {card.copy}
                  </p>
                </article>
              ))}
            </div>
            <MarketingButton href="/security" variant="secondary" className="mt-6">
              Read the security model
              <ArrowRight className="h-4 w-4" />
            </MarketingButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function DownloadCards() {
  return (
    <section
      id="download"
      className="scroll-mt-24 bg-[#050807] px-4 py-24 sm:px-6"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Download"
          title="Start with the Windows installer."
          copy="Best for most users: install, open, send. Release files live on GitHub so downloads, checksums, signatures, and updater metadata stay inspectable."
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-[1.15fr_0.85fr_0.85fr]">
          <article className="relative overflow-hidden rounded-[24px] border border-emerald-300/28 bg-emerald-300/[0.06] p-7 shadow-[0_0_80px_rgba(16,185,129,0.08)]">
            <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-emerald-300/16 blur-3xl" />
            <span className="relative inline-flex rounded-full border border-emerald-200/20 bg-emerald-200/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100">
              Recommended
            </span>
            <span className="relative ml-2 inline-flex rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-slate-200">
              Latest public release: {publicReleaseVersion}
            </span>
            <div className="relative mt-8 flex items-start gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-[16px] border border-emerald-200/24 bg-emerald-200/12 text-emerald-100">
                <Download className="h-6 w-6" />
              </span>
              <div>
                <h3 className="text-2xl font-semibold tracking-[-0.02em] text-white">
                  Windows installer
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                  Best for most users. Install Lightning P2P, open the app, and
                  send files without an account.
                </p>
              </div>
            </div>
            <div className="relative mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <MarketingButton href={VELOPACK_DOWNLOAD_URL}>
                <Download className="h-4 w-4" />
                Download for Windows
              </MarketingButton>
              <MarketingButton href={RELEASE_URL} variant="secondary">
                View all releases
                <ArrowRight className="h-4 w-4" />
              </MarketingButton>
            </div>
            <div className="relative mt-7 flex flex-wrap gap-2 text-xs text-slate-300">
              {[
                "MIT licensed",
                "No account required",
                "GitHub Releases",
                "SHA256SUMS.txt published",
              ].map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5"
                >
                  {item}
                </span>
              ))}
            </div>
          </article>

          <DownloadOption
            icon={PackageCheck}
            title="MSI"
            subtitle="Managed deployments"
            copy="Use the MSI path when you need deployment tooling, inventory, or policy-managed installs."
            href={MSI_DOWNLOAD_URL}
            action="Download MSI"
          />
          <DownloadOption
            icon={Terminal}
            title="Build from source"
            subtitle="Developers"
            copy="Clone the repo, install dependencies, and run the Tauri app locally. winget is tracked but not presented as the primary live install path yet."
            href={REPO_URL}
            action="View source"
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-400">
          <a
            href={NSIS_DOWNLOAD_URL}
            className="inline-flex items-center gap-2 underline-offset-4 transition hover:text-white hover:underline"
          >
            <Download className="h-4 w-4" />
            Classic NSIS installer
          </a>
          <a
            href={RELEASE_URL}
            className="inline-flex items-center gap-2 underline-offset-4 transition hover:text-white hover:underline"
          >
            <FileCheck2 className="h-4 w-4" />
            Checksums and signatures
          </a>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-4">
          {[
            {
              title: "Requirements",
              copy: "Windows 10 or Windows 11 x64 with WebView2 available through the app bundle when needed.",
            },
            {
              title: "Install steps",
              copy: "Download the Windows setup, run it, launch Lightning P2P, then allow firewall access if Windows asks.",
            },
            {
              title: "Firewall note",
              copy: "Nearby LAN discovery uses local networking. If peers do not appear, send the receive link or check firewall rules.",
            },
            {
              title: "Release artifacts",
              copy: "GitHub Releases contain installer assets, updater metadata, SHA256 checksums, and signatures for published builds.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-[18px] border border-white/10 bg-white/[0.03] p-5"
            >
              <p className="font-semibold text-white">{item.title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {item.copy}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DownloadOption({
  icon: Icon,
  title,
  subtitle,
  copy,
  href,
  action,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  copy: string;
  href: string;
  action: string;
}) {
  return (
    <article className="rounded-[24px] border border-white/10 bg-white/[0.035] p-6 transition duration-200 hover:-translate-y-1 hover:border-emerald-300/24 hover:bg-white/[0.055]">
      <span className="grid h-12 w-12 place-items-center rounded-[15px] border border-white/10 bg-white/[0.05] text-emerald-200">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-6 text-xl font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        {subtitle}
      </p>
      <p className="mt-4 text-sm leading-6 text-slate-400">{copy}</p>
      <a
        href={href}
        className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-emerald-200 underline-offset-4 transition hover:text-emerald-100 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
      >
        {action}
        <ArrowRight className="h-4 w-4" />
      </a>
    </article>
  );
}

function ComparisonTable() {
  const columns: Array<{ key: keyof Omit<ComparisonRow, "tool" | "detail">; label: string }> = [
    { key: "cloudUpload", label: "Cloud upload" },
    { key: "account", label: "Account" },
    { key: "wan", label: "Works across WAN" },
    { key: "openSource", label: "Open source" },
    { key: "nativeWindows", label: "Native Windows app" },
    { key: "verifiedContent", label: "Verified content" },
  ];

  return (
    <section
      id="compare"
      className="scroll-mt-24 bg-[#07110d] px-4 py-24 sm:px-6"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Compare"
          title="A direct-first alternative to cloud file sharing."
          copy="Comparison focuses on product model and documented behavior, not benchmark speed."
        />
        <div className="mt-12 overflow-x-auto rounded-[22px] border border-white/10 bg-white/[0.03]">
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.035]">
                <th className="px-5 py-4 font-semibold text-white">Tool</th>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className="px-5 py-4 text-center font-semibold text-white"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr
                  key={row.tool}
                  className={cx(
                    "border-t border-white/6",
                    row.tool === "Lightning P2P"
                      ? "bg-emerald-300/[0.055]"
                      : "odd:bg-white/[0.018]",
                  )}
                >
                  <th className="px-5 py-4 text-left font-normal" scope="row">
                    <span
                      className={cx(
                        "block font-semibold",
                        row.tool === "Lightning P2P"
                          ? "text-emerald-100"
                          : "text-white",
                      )}
                    >
                      {row.tool}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {row.detail}
                    </span>
                  </th>
                  {columns.map((column) => (
                    <td key={column.key} className="px-5 py-4 text-center">
                      <ComparisonIndicator cell={row[column.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-500">
          This table is intentionally about model and availability. Speed claims
          belong in repeatable benchmark reports.
        </p>
      </div>
    </section>
  );
}

function ComparisonIndicator({ cell }: { cell: ComparisonCell }) {
  const Icon =
    cell.label === "Yes" ? Check : cell.label === "No" ? X : Minus;
  return (
    <span
      className={cx(
        "inline-flex min-w-24 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold",
        cell.tone === "positive" &&
          "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
        cell.tone === "negative" &&
          "border-rose-300/16 bg-rose-300/8 text-rose-200",
        cell.tone === "neutral" &&
          "border-amber-300/16 bg-amber-300/8 text-amber-200",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{cell.label}</span>
    </span>
  );
}

function BenchmarkPreview() {
  return (
    <section
      id="benchmarks"
      className="scroll-mt-24 bg-[#050807] px-4 py-24 sm:px-6"
    >
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <SectionHeading
          eyebrow="Benchmarks"
          title="Benchmarks should be repeatable."
          copy="Lightning P2P is designed for high-throughput transfer, but public speed claims should be tied to repeatable benchmark reports."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {benchmarkCards.map((card) => (
            <div
              key={card}
              className="rounded-[18px] border border-white/10 bg-white/[0.035] p-5"
            >
              <BarChart3 className="h-5 w-5 text-amber-200" />
              <p className="mt-4 font-semibold text-white">{card}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Methodology before marketing claims.
              </p>
            </div>
          ))}
          <a
            href={`${REPO_URL}/blob/main/docs/benchmark-report-template.md`}
            className="group rounded-[18px] border border-emerald-300/20 bg-emerald-300/8 p-5 text-emerald-100 transition hover:border-emerald-300/36 hover:bg-emerald-300/12"
          >
            <FileCheck2 className="h-5 w-5" />
            <p className="mt-4 font-semibold">View benchmark methodology</p>
            <p className="mt-2 text-sm leading-6 text-emerald-100/72">
              LAN, WAN, relay, small files, and large single-file reports.
            </p>
          </a>
        </div>
      </div>
    </section>
  );
}

function PlatformStatus() {
  return (
    <section className="bg-[#07110d] px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Status"
          title="Windows-first, with a clear platform roadmap."
          copy="The project is public where the desktop path is strongest. Other platforms are tracked deliberately."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-5">
          {platformStatus.map((item) => (
            <div
              key={item.label}
              className="rounded-[18px] border border-white/10 bg-white/[0.035] p-5"
            >
              <p className="text-sm text-slate-500">{item.label}</p>
              <p
                className={cx(
                  "mt-3 text-xl font-semibold",
                  item.tone === "positive" && "text-emerald-200",
                  item.tone === "neutral" && "text-white",
                  item.tone === "muted" && "text-slate-400",
                )}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQAccordion({ faqs }: { faqs: Faq[] }) {
  return (
    <section className="bg-[#050807] px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <SectionHeading
          eyebrow="FAQ"
          title="Clear answers beat vague claims."
          align="center"
        />
        <div className="mt-10 divide-y divide-white/10 rounded-[22px] border border-white/10 bg-white/[0.035]">
          {faqs.map((faq) => (
            <details
              key={faq.q}
              className="group p-5 open:bg-white/[0.025] sm:p-6 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[12px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300">
                <h3 className="text-base font-semibold text-white sm:text-lg">
                  {faq.q}
                </h3>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition group-open:rotate-180 group-open:text-emerald-200">
                  <ChevronDown className="h-4 w-4" />
                </span>
              </summary>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400 sm:text-base">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="relative isolate overflow-hidden bg-[#07110d] px-4 py-24 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(800px_circle_at_50%_20%,rgba(110,231,183,0.14),transparent_56%)]"
      />
      <div className="mx-auto max-w-5xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">
          Lightning P2P
        </p>
        <h2 className="mt-5 text-[clamp(2.5rem,7vw,5.9rem)] font-semibold leading-[0.94] tracking-[-0.055em] text-white">
          Send files directly. Keep the cloud out of the middle.
        </h2>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <MarketingButton href={VELOPACK_DOWNLOAD_URL}>
            <Download className="h-4 w-4" />
            Download for Windows
          </MarketingButton>
          <MarketingButton href={REPO_URL} variant="secondary">
            <Github className="h-4 w-4" />
            Star on GitHub
          </MarketingButton>
        </div>
      </div>
    </section>
  );
}

function HomeSections({ faqs }: { faqs: Faq[] }) {
  return (
    <>
      <ProblemSection />
      <HowItWorks />
      <NativeAppProof />
      <FeatureBento />
      <SecurityCards />
      <DownloadCards />
      <ComparisonTable />
      <BenchmarkPreview />
      <PlatformStatus />
      <FAQAccordion faqs={faqs} />
    </>
  );
}

function RouteSections({ page, faqs }: { page: WebPage; faqs: Faq[] }) {
  if (page.path === "/download") {
    return (
      <>
        <DownloadCards />
        <SecurityCards />
        <ComparisonTable />
        <BenchmarkPreview />
        <FAQAccordion faqs={faqs} />
      </>
    );
  }

  if (page.path === "/security") {
    return (
      <>
        <SecurityCards />
        <DownloadCards />
        <FAQAccordion faqs={faqs} />
        <ComparisonTable />
      </>
    );
  }

  if (page.path === "/benchmarks") {
    return (
      <>
        <BenchmarkPreview />
        <ComparisonTable />
        <DownloadCards />
        <FAQAccordion faqs={faqs} />
      </>
    );
  }

  if (
    [
      "/alternatives/airdrop-for-windows",
      "/wetransfer-alternative",
      "/wormhole-alternative",
      "/localsend-vs-lightning-p2p",
    ].includes(page.path)
  ) {
    return (
      <>
        <ComparisonTable />
        <FeatureBento />
        <DownloadCards />
        <FAQAccordion faqs={faqs} />
      </>
    );
  }

  return (
    <>
      <HowItWorks />
      <FeatureBento />
      <SecurityCards />
      <DownloadCards />
      <FAQAccordion faqs={faqs} />
    </>
  );
}

function Footer() {
  const footerLinks = [
    {
      title: "Product",
      links: [
        ["Download", "/download"],
        ["Security", "/security"],
        ["Benchmarks", "/benchmarks"],
        ["Receive", "/receive"],
      ],
    },
    {
      title: "Compare",
      links: [
        ["AirDrop for Windows", "/alternatives/airdrop-for-windows"],
        ["WeTransfer alternative", "/wetransfer-alternative"],
        ["LocalSend comparison", "/localsend-vs-lightning-p2p"],
        ["Magic Wormhole alternative", "/wormhole-alternative"],
      ],
    },
    {
      title: "Open source",
      links: [
        ["GitHub", REPO_URL],
        ["License", `${REPO_URL}/blob/main/LICENSE`],
        ["Report issue", `${REPO_URL}/issues/new/choose`],
        ["Changelog", `${REPO_URL}/blob/main/CHANGELOG.md`],
      ],
    },
  ] as const;

  return (
    <footer className="border-t border-white/10 bg-[#050807] px-4 py-12 text-sm text-slate-400 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.1fr_1.7fr]">
        <div>
          <a
            href="/"
            className="inline-flex items-center gap-3 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
          >
            <img src={siteLogoUrl} alt="" className="h-10 w-10 rounded-[10px]" />
            <span className="font-semibold text-white">Lightning P2P</span>
          </a>
          <p className="mt-4 max-w-sm leading-6">
            Free, open-source peer-to-peer file transfer for Windows. No cloud
            upload, no account, no artificial file-size cap.
          </p>
          <p className="mt-4 text-xs text-slate-600">
            MIT licensed. Built with Rust, Tauri, iroh, QUIC, and BLAKE3.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          {footerLinks.map((group) => (
            <div key={group.title}>
              <p className="font-semibold text-white">{group.title}</p>
              <ul className="mt-4 grid gap-2">
                {group.links.map(([label, href]) => (
                  <li key={href}>
                    <a
                      href={href}
                      className="transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}

export function WebLandingPage() {
  const page = currentPage();
  const isHome = page.path === "/";
  const faqs = page.faqs ?? defaultFaqs;

  useEffect(() => {
    document.documentElement.dataset.runtime = "browser";
    document.body.dataset.runtime = "browser";
  }, []);

  if (page.path === "/receive") {
    return <ReceiveHandoffPage />;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#050807] text-white">
      <Header activePath={page.path} />
      <main>
        <Hero page={page} isHome={isHome} />
        <TrustBadges />
        <AnswerBlocks page={page} />
        {!isHome ? <RouteArticle page={page} /> : null}
        {isHome ? (
          <HomeSections faqs={faqs} />
        ) : (
          <RouteSections page={page} faqs={faqs} />
        )}
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
