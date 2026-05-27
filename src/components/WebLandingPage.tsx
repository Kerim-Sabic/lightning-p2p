import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  ChevronDown,
  ClipboardCheck,
  CloudOff,
  Code2,
  Download,
  FileCheck2,
  Github,
  KeyRound,
  Menu,
  Minus,
  MonitorDown,
  PackageCheck,
  QrCode,
  RadioTower,
  Route,
  ShieldCheck,
  Smartphone,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import siteLogoUrl from "../assets/lightning-p2p-site-logo.png";
import benchmarkSummary from "../content/local-benchmark-summary.json";
import pages from "../content/web-pages.json";
import {
  ANDROID_APK_DOWNLOAD_URL,
  ANDROID_CHECKSUMS_URL,
  EXPERIMENTAL_RELEASE_URL,
  MSI_DOWNLOAD_URL,
  NSIS_DOWNLOAD_URL,
  RELEASE_URL,
  REPO_URL,
  SITE_URL,
  STABLE_RELEASE_TAG,
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
type StatusTone = "signal" | "amber" | "muted";

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

interface RouteStep {
  label: string;
  detail: string;
  tone: StatusTone;
}

interface CapabilityRow {
  index: string;
  label: string;
  headline: string;
  body: string;
  proof: { text: string; href: string };
}

interface DownloadOptionData {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  copy: string;
  href: string;
  action: string;
  tone: StatusTone;
}

const webPages = pages as WebPage[];

const HORALIX_URL = "https://horalix.com";
const DOWNLOAD_TRUST_URL = `${REPO_URL}/blob/main/docs/download-trust.md`;

const benchmarkTenMb = benchmarkSummary.scenarios.find(
  (scenario) => scenario.scenario === "same_machine_10mb",
);
const benchmarkHundredMb = benchmarkSummary.scenarios.find(
  (scenario) => scenario.scenario === "same_machine_100mb",
);
const benchmarkOneGb = benchmarkSummary.scenarios.find(
  (scenario) => scenario.scenario === "same_machine_1gb",
);

const baseKeyFacts: KeyFact[] = [
  { label: "Product", value: "Lightning P2P" },
  { label: "Maker", value: "Horalix" },
  { label: "Category", value: "Peer-to-peer file transfer app" },
  {
    label: "Platform",
    value: "Windows stable release, Android 10+ sideload release",
  },
  { label: "Stable release", value: "v0.4.6" },
  { label: "Experimental release", value: "v0.5.1 speed modes" },
  { label: "License", value: "Apache-2.0" },
  { label: "Account required", value: "No" },
  { label: "Cloud upload", value: "No" },
  { label: "Artificial file-size cap", value: "No" },
  { label: "Transport", value: "iroh / QUIC" },
  { label: "Verification", value: "BLAKE3" },
  { label: "Source code", value: "GitHub" },
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
    "/": "Lightning P2P is a free open-source peer-to-peer file transfer app made by Horalix. It sends files directly between Windows and Android devices with iroh QUIC, verifies content with BLAKE3, and does not require cloud upload, accounts, or artificial file-size caps.",
    "/download":
      "Download Lightning P2P from GitHub Releases when you want the stable Windows installer or Android 10+ sideload APK for direct-first P2P file transfer. The recommended Windows asset is the one-click setup; Android users should verify the APK checksum before installing.",
    "/android-p2p-file-transfer":
      "Lightning P2P supports Android 10+ sideload installs, Android system share-target sends, smart MediaStore receive routing, direct-first iroh transfer, and BLAKE3 verification.",
    "/security":
      "Lightning P2P avoids cloud file hosting, uses encrypted peer transport through iroh, verifies content with BLAKE3, and treats tickets as capability tokens. It makes specific security claims instead of broad privacy promises.",
    "/benchmarks":
      "Lightning P2P is designed for high-throughput direct transfer, but public speed claims should be tied to repeatable benchmark reports covering LAN direct, WAN direct, relay fallback, many small files, and large single files.",
    "/alternatives/airdrop-for-windows":
      "Lightning P2P is an open-source AirDrop-style file transfer app for Windows, focused on direct-first transfers, QR/link handoff, no account, and no cloud upload.",
    "/free-p2p-file-transfer":
      "Lightning P2P is a free P2P file transfer app for Windows and Android with no account, no cloud upload, no artificial file-size cap, direct-first transfer, and BLAKE3 verification.",
    "/large-file-transfer":
      "Lightning P2P sends huge files directly from sender to receiver without a hosted cloud upload step, no account, no artificial file-size cap, and BLAKE3 verification.",
    "/secure-p2p-file-transfer":
      "Lightning P2P uses encrypted iroh QUIC transport, BLAKE3 content verification through iroh-blobs, capability tickets, release checksums, and documented limitations instead of vague security promises.",
    "/open-source-file-transfer":
      "Lightning P2P is an Apache-2.0 open-source file transfer app built with Rust, Tauri, React, iroh, QUIC, iroh-blobs, and BLAKE3, with NOTICE and CITATION.cff metadata.",
    "/best-p2p-file-transfer":
      "Lightning P2P is a strong best-fit P2P file transfer choice for Windows and Android users who want a free open-source app, direct-first LAN and WAN transfer, no cloud upload, and verified content.",
    "/wetransfer-alternative":
      "WeTransfer is useful for hosted cloud links. Lightning P2P is better when you want to avoid uploading files to a cloud storage service and transfer directly from sender to receiver.",
    "/wormhole-alternative":
      "Magic Wormhole is a strong CLI file transfer tool. Lightning P2P serves users who want a graphical Windows and Android app with link and QR handoff, iroh connectivity, and BLAKE3 verification.",
    "/localsend-vs-lightning-p2p":
      "LocalSend is best for broad cross-platform LAN sharing today. Lightning P2P focuses on Windows and Android direct-first LAN and WAN transfers with iroh, QUIC, relay fallback, and BLAKE3 verification.",
    "/how-to-send-large-files":
      "To send large files peer-to-peer on Windows or Android, install Lightning P2P, drop files into Send, share the receive link or QR, and keep the sender online while the receiver streams verified bytes to disk.",
    "/send-files-between-windows-computers":
      "Lightning P2P sends files between Windows computers through a native app with no account, no cloud upload, no artificial file-size cap, direct-first connectivity, and BLAKE3 verification.",
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
    a: "Yes. Lightning P2P is free, open source, and Apache-2.0 licensed.",
  },
  {
    q: "Who made Lightning P2P?",
    a: "Lightning P2P was made by Horalix. You can find Horalix at horalix.com.",
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
    q: "Is it available for macOS or Linux?",
    a: "Not yet. Windows and Android 10+ are the public release targets. macOS and Linux packaging are planned after the current native paths stay reliable.",
  },
  {
    q: "Are tickets secret?",
    a: "Yes. Tickets are capability tokens. Anyone with a valid ticket can request that transfer while the sender is online, so treat tickets like secrets.",
  },
];

const trustBadges: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Github, label: "Open source" },
  { icon: BadgeCheck, label: "Apache-2.0" },
  { icon: Code2, label: "Rust-native" },
  { icon: MonitorDown, label: "Tauri v2" },
  { icon: Route, label: "iroh QUIC" },
  { icon: FileCheck2, label: "BLAKE3" },
  { icon: CloudOff, label: "No cloud bucket" },
  { icon: KeyRound, label: "No sign-up" },
];

const workflowSteps: Array<{ icon: LucideIcon; title: string; copy: string }> =
  [
    {
      icon: Upload,
      title: "Drop files",
      copy: "Choose a file or folder. Lightning P2P prepares content locally.",
    },
    {
      icon: QrCode,
      title: "Share ticket",
      copy: "Send a link, QR code, or raw ticket to the intended receiver.",
    },
    {
      icon: ClipboardCheck,
      title: "Stream to disk",
      copy: "The receiver pulls verified bytes directly into the native app.",
    },
  ];

const routeSteps: RouteStep[] = [
  {
    label: "Sender",
    detail: "File stays on the device",
    tone: "signal",
  },
  {
    label: "Ticket",
    detail: "Capability link or QR",
    tone: "amber",
  },
  {
    label: "iroh QUIC",
    detail: "Direct first, relay when needed",
    tone: "signal",
  },
  {
    label: "Receiver",
    detail: "BLAKE3-verified output",
    tone: "signal",
  },
];

const capabilityRows: CapabilityRow[] = [
  {
    index: "01",
    label: "Transport",
    headline:
      "Direct-first iroh QUIC with relay fallback when networks block the path.",
    body: "Peers dial directly when possible. If NAT or firewall rules block that path, iroh relay assistance keeps the transfer reachable without becoming hosted storage.",
    proof: {
      text: "Architecture docs",
      href: `${REPO_URL}/blob/main/docs/ARCHITECTURE.md`,
    },
  },
  {
    index: "02",
    label: "Blob transfer",
    headline:
      "iroh-blobs handles content addressing instead of custom chunking.",
    body: "The Rust transfer engine imports content into iroh-blobs, creates a ticket, and streams content-addressed bytes to the receiver.",
    proof: {
      text: "Sender source",
      href: `${REPO_URL}/blob/main/src-tauri/src/transfer/sender.rs`,
    },
  },
  {
    index: "03",
    label: "Verification",
    headline:
      "BLAKE3 verification ties successful output to the expected content hash.",
    body: "The receiver verifies bytes as they land. Hash mismatches surface as structured transfer errors instead of silent corruption.",
    proof: {
      text: "Receiver source",
      href: `${REPO_URL}/blob/main/src-tauri/src/transfer/receiver.rs`,
    },
  },
  {
    index: "04",
    label: "Handoff",
    headline: "Receive links keep raw tickets in the URL fragment.",
    body: "The website can help a receiver open the native app, but file bytes stay in the Rust app path. Browser transfer is intentionally not the engine.",
    proof: {
      text: "Share link source",
      href: `${REPO_URL}/blob/main/src/lib/shareLinks.ts`,
    },
  },
  {
    index: "05",
    label: "Release trust",
    headline:
      "Installers, checksums, signing status, and release notes stay attached.",
    body: "Windows and Android artifacts publish through GitHub Releases with checksum material and documented installer behavior.",
    proof: {
      text: "Release evidence",
      href: `${REPO_URL}/blob/main/docs/release-evidence.md`,
    },
  },
  {
    index: "06",
    label: "Diagnostics",
    headline: "Support data is designed to redact tickets and local paths.",
    body: "Diagnostics are gathered locally, redacted, and copied by the user. Transfer secrets are not posted by the frontend automatically.",
    proof: {
      text: "Diagnostics source",
      href: `${REPO_URL}/blob/main/src-tauri/src/commands/diagnostics.rs`,
    },
  },
];

const comparisonRows: ComparisonRow[] = [
  {
    tool: "Lightning P2P",
    detail: "Direct-first Windows and Android app",
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
    tool: "Magic Wormhole",
    detail: "Command-line transfer",
    cloudUpload: { label: "No", tone: "positive" },
    account: { label: "No", tone: "positive" },
    wan: { label: "Yes", tone: "positive" },
    openSource: { label: "Yes", tone: "positive" },
    nativeWindows: { label: "Partial", tone: "neutral" },
    verifiedContent: { label: "Yes", tone: "positive" },
  },
];

const downloadOptions: DownloadOptionData[] = [
  {
    icon: MonitorDown,
    title: "Windows setup",
    subtitle: "Stable v0.4.6",
    copy: "Recommended for most desktop users. Installs under your user profile and opens the native send and receive app.",
    href: VELOPACK_DOWNLOAD_URL,
    action: "Download for Windows",
    tone: "signal",
  },
  {
    icon: Smartphone,
    title: "Android APK",
    subtitle: "Android 10+ sideload",
    copy: "Use the stable APK from GitHub Releases. Verify the SHA256 file before allowing sideload install.",
    href: ANDROID_APK_DOWNLOAD_URL,
    action: "Download APK",
    tone: "signal",
  },
  {
    icon: PackageCheck,
    title: "MSI package",
    subtitle: "Managed installs",
    copy: "Use MSI when deployment tooling, inventory, or policy-managed installation matters more than the one-click setup.",
    href: MSI_DOWNLOAD_URL,
    action: "Download MSI",
    tone: "muted",
  },
];

const platformStatus = [
  { label: "Windows", value: "Stable release", tone: "signal" },
  { label: "Android", value: "Stable sideload", tone: "signal" },
  { label: "macOS / Linux", value: "Planned", tone: "amber" },
  { label: "iOS", value: "Not shipped", tone: "muted" },
  { label: "Browser", value: "Receive handoff only", tone: "muted" },
] as const;

const heroProofRows = [
  ["Route", "Direct-first iroh QUIC"],
  ["Fallback", "Relay when networks block direct paths"],
  ["Integrity", "BLAKE3-verified output"],
  ["Browser", "Handoff only, not the transfer engine"],
] as const;

const pageMotion = {
  ease: [0.16, 1, 0.3, 1],
  duration: 0.76,
} as const;

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

function toneClass(tone: StatusTone): string {
  if (tone === "signal") {
    return "text-[var(--signal-green)]";
  }
  if (tone === "amber") {
    return "text-[var(--proof-amber)]";
  }
  return "text-[color:var(--muted-copy)]";
}

function lightToneClass(tone: StatusTone): string {
  if (tone === "signal") {
    return "text-[var(--signal-ink)]";
  }
  if (tone === "amber") {
    return "text-[var(--amber-ink)]";
  }
  return "text-[color:var(--paper-copy)]";
}

function setMetaContent(selector: string, content: string): void {
  document
    .querySelector<HTMLMetaElement>(selector)
    ?.setAttribute("content", content);
}

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-12% 0px -12% 0px" }}
      transition={{ ...pageMotion, delay }}
    >
      {children}
    </motion.div>
  );
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
        "group relative inline-flex min-h-11 max-w-full items-center justify-center gap-2 overflow-hidden rounded-full px-5 py-3 text-sm font-semibold transition-[background,border-color,color,box-shadow,transform] duration-300 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)] active:scale-[0.985]",
        variant === "primary" &&
          "bg-[var(--signal-green)] text-[var(--text-ink)] shadow-[0_18px_46px_rgba(125,223,156,0.18)] hover:bg-[var(--proof-paper)] hover:shadow-[0_22px_60px_rgba(125,223,156,0.24)]",
        variant === "secondary" &&
          "border border-[color:var(--marketing-border-strong)] bg-[var(--marketing-surface)] text-[var(--proof-paper)] hover:border-[color:var(--signal-green)] hover:bg-[var(--marketing-surface-strong)] hover:shadow-[0_16px_42px_rgba(0,0,0,0.24)]",
        variant === "ghost" &&
          "text-[color:var(--soft-copy)] hover:bg-[var(--marketing-surface)] hover:text-[var(--proof-paper)]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute inset-y-0 left-0 w-10 -translate-x-14 skew-x-[-18deg] bg-[rgba(248,250,247,0.32)] opacity-0 transition duration-700 group-hover:translate-x-[18rem] group-hover:opacity-100",
          variant === "ghost" && "hidden",
        )}
      />
      <span className="relative z-10 inline-flex items-center gap-2">
        {children}
      </span>
    </a>
  );
}

function SectionHeading({
  eyebrow,
  title,
  copy,
  surface = "dark",
}: {
  eyebrow: string;
  title: string;
  copy?: string;
  surface?: "dark" | "light";
}) {
  const light = surface === "light";

  return (
    <div className="max-w-4xl">
      <p
        className={cx(
          "text-xs font-bold uppercase tracking-[0.24em]",
          light ? "text-[var(--text-ink)]" : "text-[var(--signal-green)]",
        )}
      >
        {eyebrow}
      </p>
      <h2
        className={cx(
          "mt-4 max-w-4xl text-4xl font-semibold leading-[0.98] sm:text-5xl lg:text-6xl xl:text-7xl",
          light ? "text-[var(--text-ink)]" : "text-[var(--proof-paper)]",
        )}
      >
        {title}
      </h2>
      {copy ? (
        <p
          className={cx(
            "mt-5 max-w-3xl text-base leading-7 sm:text-lg",
            light
              ? "text-[color:var(--paper-copy)]"
              : "text-[color:var(--soft-copy)]",
          )}
        >
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
    { label: "Benchmarks", href: "/benchmarks" },
    { label: "Download", href: "/download" },
  ];

  return (
    <header
      className={cx(
        "fixed inset-x-0 top-0 z-50 border-b transition-[background,border-color,box-shadow] duration-300",
        scrolled
          ? "border-[color:var(--marketing-border)] bg-[color:var(--lab-black)]/94 shadow-[0_16px_48px_rgba(0,0,0,0.22)] backdrop-blur-xl"
          : "border-transparent bg-[color:var(--lab-black)]/74 backdrop-blur-md",
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <a
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal-green)]"
          aria-label="Lightning P2P home"
        >
          <img
            src={siteLogoUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg object-cover shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
          />
          <span className="hidden text-sm font-semibold text-[var(--proof-paper)] sm:inline">
            Lightning P2P
          </span>
        </a>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {navItems.map((item) => {
            const pathOnly = item.href.split("#")[0] || "/";
            const active = activePath === item.href || activePath === pathOnly;
            return (
              <a
                key={item.href}
                href={item.href}
                className={cx(
                  "rounded-full px-3 py-1.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)]",
                  active
                    ? "bg-[var(--marketing-surface-strong)] text-[var(--proof-paper)]"
                    : "text-[color:var(--soft-copy)] hover:bg-[var(--marketing-surface)] hover:text-[var(--proof-paper)]",
                )}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <a
            href={HORALIX_URL}
            className="hidden rounded-full px-3 py-2 text-sm font-semibold text-[color:var(--soft-copy)] transition hover:bg-[var(--marketing-surface)] hover:text-[var(--proof-paper)] lg:inline-flex"
          >
            Horalix
          </a>
          <a
            href={REPO_URL}
            className="hidden h-10 w-10 items-center justify-center rounded-full border border-[color:var(--marketing-border)] bg-[var(--marketing-surface)] text-[color:var(--soft-copy)] transition hover:border-[color:var(--signal-green)] hover:text-[var(--proof-paper)] sm:inline-flex"
            aria-label="Open Lightning P2P on GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
          <div className="hidden sm:block">
            <MarketingButton href={VELOPACK_DOWNLOAD_URL}>
              <Download className="h-4 w-4" />
              Download
            </MarketingButton>
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--marketing-border)] bg-[var(--marketing-surface)] text-[var(--proof-paper)] transition hover:border-[color:var(--signal-green)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)] lg:hidden"
            aria-label="Toggle navigation menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-[color:var(--marketing-border)] bg-[var(--lab-black)] px-4 pb-4 pt-2 shadow-[0_24px_60px_rgba(0,0,0,0.36)] lg:hidden">
          <nav className="mx-auto grid max-w-7xl gap-1" aria-label="Mobile">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-3 text-sm font-medium text-[color:var(--soft-copy)] transition hover:bg-[var(--marketing-surface)] hover:text-[var(--proof-paper)]"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <a
              href={HORALIX_URL}
              className="rounded-lg px-3 py-3 text-sm font-medium text-[color:var(--soft-copy)] transition hover:bg-[var(--marketing-surface)] hover:text-[var(--proof-paper)]"
              onClick={() => setOpen(false)}
            >
              Made by Horalix
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
  const reduceMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const visualY = useTransform(scrollY, [0, 700], [0, 70]);
  const copyY = useTransform(scrollY, [0, 700], [0, -18]);

  return (
    <section
      id="product"
      className="relative isolate overflow-hidden bg-[var(--lab-black)] px-4 pb-10 pt-24 sm:px-6 sm:pb-12 lg:pt-28"
    >
      <div
        aria-hidden="true"
        className="marketing-grid-bg absolute inset-0 -z-30 opacity-50"
      />
      <motion.img
        src={
          isHome && !reduceMotion ? "/demo-lightning-p2p.gif" : "/web-hero.png"
        }
        alt=""
        aria-hidden="true"
        className="absolute top-28 -z-20 hidden w-[820px] max-w-none opacity-[0.24] sm:right-[-15rem] sm:block lg:right-[-6rem] lg:w-[940px] lg:opacity-[0.46] xl:right-[2vw] xl:w-[980px]"
        style={{ y: reduceMotion ? 0 : visualY }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,var(--lab-black)_0%,rgba(5,7,6,0.98)_34%,rgba(5,7,6,0.42)_64%,rgba(5,7,6,0.68)_100%),linear-gradient(180deg,rgba(5,7,6,0.16),var(--lab-black)_78%,var(--lab-green))]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-[linear-gradient(0deg,var(--lab-green),transparent)]"
      />

      <div className="mx-auto max-w-7xl">
        <motion.div
          className="max-w-[360px] py-10 sm:max-w-5xl sm:py-16 lg:py-20"
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ ...pageMotion, duration: 0.9 }}
          style={{ y: reduceMotion ? 0 : copyY }}
        >
          <p className="max-w-fit border-y border-[color:var(--signal-border)] py-2 text-xs font-bold uppercase tracking-[0.24em] text-[var(--signal-green)]">
            {isHome
              ? `Stable ${STABLE_RELEASE_TAG} / made by Horalix`
              : page.eyebrow}
          </p>
          <h1 className="mt-7 max-w-[9ch] text-6xl font-semibold leading-[0.86] text-[var(--proof-paper)] sm:max-w-[10ch] sm:text-7xl lg:text-8xl xl:text-[8.4rem]">
            {isHome ? "Lightning P2P" : page.heading}
          </h1>
          <p className="mt-7 max-w-[68ch] text-lg leading-8 text-[color:var(--soft-copy)] sm:text-xl sm:leading-9">
            {isHome
              ? "Direct file transfer for Windows and Android. No cloud upload, no account, no artificial size cap. Rust, Tauri, iroh QUIC, and BLAKE3 stay in the transfer path."
              : `${page.intro} ${page.focus}`}
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <MarketingButton
              href={VELOPACK_DOWNLOAD_URL}
              className="w-full sm:w-auto"
              ariaLabel="Download Lightning P2P for Windows"
            >
              <Download className="h-4 w-4" />
              Download for Windows
            </MarketingButton>
            <MarketingButton
              href={ANDROID_APK_DOWNLOAD_URL}
              variant="secondary"
              className="w-full sm:w-auto"
              ariaLabel="Download Lightning P2P Android APK"
            >
              <Smartphone className="h-4 w-4" />
              Android APK
            </MarketingButton>
            <MarketingButton
              href={REPO_URL}
              variant="ghost"
              className="w-full sm:w-auto"
            >
              <Github className="h-4 w-4" />
              GitHub source
            </MarketingButton>
          </div>
          <p className="mt-6 max-w-[66ch] text-sm leading-6 text-[color:var(--muted-copy)]">
            Website handoff only. Native apps move bytes, verify content, and
            keep the sender in control until the receiver finishes.
          </p>
        </motion.div>

        <HeroReadout />
      </div>
    </section>
  );
}

function HeroReadout() {
  return (
    <dl className="grid overflow-hidden rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-green)] shadow-[0_24px_90px_rgba(0,0,0,0.28)] sm:grid-cols-2 lg:grid-cols-4">
      {heroProofRows.map(([label, value], index) => (
        <div
          key={label}
          className="border-b border-[color:var(--marketing-border)] p-5 last:border-b-0 sm:border-r sm:odd:border-r lg:border-b-0 lg:last:border-r-0"
        >
          <dt className="text-xs font-bold uppercase tracking-[0.2em] text-[color:var(--muted-copy)]">
            {label}
          </dt>
          <dd
            className={cx(
              "mt-2 text-base font-semibold leading-6",
              index === 1
                ? "text-[var(--proof-amber)]"
                : "text-[var(--signal-green)]",
            )}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TrustRibbon() {
  return (
    <section className="border-y border-[color:var(--marketing-border)] bg-[var(--lab-black)] px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-7xl overflow-x-auto">
        <ul className="flex min-w-max items-center gap-7 text-sm font-semibold text-[color:var(--soft-copy)] lg:justify-between">
          {trustBadges.map((badge) => (
            <li key={badge.label} className="flex items-center gap-2">
              <badge.icon className="h-4 w-4 text-[var(--signal-green)]" />
              <span>{badge.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function AnswerBlocks({ page }: { page: WebPage }) {
  const content = answerContentForPage(page);

  return (
    <section className="bg-[var(--proof-paper)] px-4 py-20 text-[var(--text-ink)] sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_430px] lg:items-start">
        <Reveal>
          <article>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[color:var(--paper-copy)]">
              Direct answer
            </p>
            <h2 className="mt-4 max-w-4xl text-4xl font-semibold leading-[0.98] sm:text-5xl lg:text-6xl xl:text-7xl">
              Direct transfer is the claim. The route is the proof.
            </h2>
            <p className="mt-6 max-w-[72ch] text-lg leading-8 text-[color:var(--paper-copy)]">
              {content.answer}
            </p>
          </article>
        </Reveal>

        <Reveal delay={0.08} className="grid gap-5">
          <div className="rounded-lg border border-[var(--border-light)] bg-[var(--security-paper)] p-5 shadow-[0_20px_60px_rgba(17,27,22,0.08)]">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[color:var(--paper-copy)]">
              Facts
            </p>
            <dl className="mt-4 grid gap-2">
              {content.keyFacts.slice(0, 8).map((fact) => (
                <div
                  key={fact.label}
                  className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-[var(--border-light)] pb-2 text-sm last:border-b-0 last:pb-0"
                >
                  <dt className="text-[color:var(--paper-copy)]">
                    {fact.label}
                  </dt>
                  <dd className="font-semibold text-[var(--text-ink)]">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-lg border border-[var(--border-light)] bg-[var(--security-paper)] p-5 shadow-[0_20px_60px_rgba(17,27,22,0.08)]">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[color:var(--paper-copy)]">
              Caveats
            </p>
            <ul className="mt-4 grid gap-2 text-sm leading-6 text-[color:var(--paper-copy)]">
              {content.caveats.slice(0, 4).map((caveat) => (
                <li key={caveat} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--proof-amber)]"
                  />
                  <span>{caveat}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
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
    <section className="bg-[var(--lab-black)] px-4 py-16 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article className="rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-green)] p-6 sm:p-8">
          <p className="text-xs font-bold uppercase text-[var(--signal-green)]">
            Page focus
          </p>
          <div className="mt-5 grid gap-5 text-base leading-8 text-[color:var(--soft-copy)]">
            {(page.body ?? [page.intro, page.focus]).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </article>
        {relatedPages.length > 0 ? (
          <aside className="rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-green)] p-5">
            <p className="text-xs font-bold uppercase text-[color:var(--muted-copy)]">
              Related pages
            </p>
            <div className="mt-4 grid gap-2">
              {relatedPages.map((related) => (
                <a
                  key={related.path}
                  href={canonicalWebPath(related.path)}
                  className="rounded-lg border border-[color:var(--marketing-border)] bg-[var(--marketing-surface)] p-3 transition hover:border-[color:var(--signal-green)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)]"
                >
                  <span className="block text-sm font-semibold text-[var(--proof-paper)]">
                    {related.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[color:var(--muted-copy)]">
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

function RouteLab() {
  return (
    <section className="relative overflow-hidden bg-[var(--lab-green)] px-4 py-24 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(125,223,156,0.06)_1px,transparent_1px),linear-gradient(rgba(125,223,156,0.04)_1px,transparent_1px)] bg-[length:86px_86px] opacity-60"
      />
      <div className="relative mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="Route model"
            title="The transfer story is a path, not a promise."
            copy="Lightning P2P is not a cloud storage workflow with different branding. The sender, ticket, route, receiver, and verification state all matter."
          />
        </Reveal>

        <Reveal delay={0.08}>
          <ol className="mt-12 grid overflow-hidden rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-black)] shadow-[0_28px_90px_rgba(0,0,0,0.28)] md:grid-cols-4">
            {routeSteps.map((step, index) => (
              <li
                key={step.label}
                className="relative min-h-[220px] border-b border-[color:var(--marketing-border)] p-6 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"
              >
                <span
                  className={cx(
                    "text-xs font-bold uppercase tracking-[0.22em]",
                    toneClass(step.tone),
                  )}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-5 text-2xl font-semibold text-[var(--proof-paper)]">
                  {step.label}
                </h3>
                <p className="mt-3 max-w-[32ch] text-sm leading-6 text-[color:var(--soft-copy)]">
                  {step.detail}
                </p>
                <span
                  aria-hidden="true"
                  className={cx(
                    "absolute bottom-6 left-6 h-3 w-3 rounded-full shadow-[0_0_24px_currentColor]",
                    toneClass(step.tone),
                  )}
                />
                {index < routeSteps.length - 1 ? (
                  <ArrowRight
                    aria-hidden="true"
                    className="absolute bottom-5 right-5 hidden h-5 w-5 text-[color:var(--muted-copy)] md:block"
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="bg-[var(--lab-black)] px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="Workflow"
            title="Drop. Share. Stream."
            copy="The UI stays simple because the engine is strict: stage content locally, share a capability ticket, stream verified bytes to disk."
          />
        </Reveal>
        <Reveal delay={0.08}>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-lg border border-[color:var(--marketing-border)] bg-[color:var(--marketing-border)] md:grid-cols-3">
            {workflowSteps.map((step, index) => (
              <li
                key={step.title}
                className="group bg-[var(--lab-green)] p-6 transition hover:bg-[var(--marketing-surface-strong)] sm:p-8"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--signal-green)]">
                    0{index + 1}
                  </span>
                  <span className="grid h-11 w-11 place-items-center rounded-lg border border-[color:var(--marketing-border)] bg-[var(--marketing-surface)] text-[var(--signal-green)] transition group-hover:border-[color:var(--signal-green)]">
                    <step.icon className="h-5 w-5" />
                  </span>
                </div>
                <h3 className="mt-10 text-2xl font-semibold text-[var(--proof-paper)]">
                  {step.title}
                </h3>
                <p className="mt-3 max-w-[32ch] text-sm leading-6 text-[color:var(--soft-copy)]">
                  {step.copy}
                </p>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}

function NativeTrace() {
  const reduceMotion = useReducedMotion();
  const traceRows = [
    {
      label: "route",
      value: `${benchmarkSummary.transport}, same-machine direct`,
      tone: "muted" as const,
    },
    {
      label: "10 MB median",
      value: `${benchmarkTenMb?.medianEffectiveMbps ?? "n/a"} Mbps`,
      tone: "signal" as const,
    },
    {
      label: "100 MB median",
      value: `${benchmarkHundredMb?.medianEffectiveMbps ?? "n/a"} Mbps`,
      tone: "signal" as const,
    },
    {
      label: "failure count",
      value: `${benchmarkTenMb?.failures ?? 0}`,
      tone: "signal" as const,
    },
    {
      label: "commit",
      value: benchmarkSummary.commitHash.slice(0, 8),
      tone: "muted" as const,
    },
  ];

  return (
    <section className="bg-[var(--lab-green)] px-4 py-24 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <Reveal>
          <SectionHeading
            eyebrow="Native trace"
            title="The browser is the doorway. Rust moves the bytes."
            copy="The public page can explain a ticket, but transfer work stays in the native app through Tauri IPC, iroh, and iroh-blobs."
          />
        </Reveal>

        <Reveal delay={0.08} className="grid gap-4">
          <div className="overflow-hidden rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-black)] shadow-[0_28px_90px_rgba(0,0,0,0.28)]">
            <img
              src={reduceMotion ? "/web-hero.png" : "/demo-lightning-p2p.gif"}
              alt="Lightning P2P send and receive flow showing drop, hash, link, QUIC connection, stream, and verification steps."
              className="aspect-[16/9] w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-black)] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.2)] sm:p-6">
            <div className="flex flex-col gap-3 border-b border-[color:var(--marketing-border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[color:var(--muted-copy)]">
                receive-trace / sample artifact
              </p>
              <span className="inline-flex w-fit rounded-full border border-[color:var(--signal-border)] bg-[var(--signal-bg)] px-3 py-1 text-xs font-semibold text-[var(--signal-green)]">
                Direct route
              </span>
            </div>
            <dl className="mt-5 grid gap-3">
              {traceRows.map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[130px_minmax(0,1fr)] gap-4 border-b border-[color:var(--marketing-border)] pb-3 last:border-b-0 last:pb-0"
                >
                  <dt className="text-sm text-[color:var(--muted-copy)]">
                    {row.label}
                  </dt>
                  <dd
                    className={cx(
                      "truncate font-mono text-sm",
                      row.tone === "signal"
                        ? "text-[var(--signal-green)]"
                        : "text-[color:var(--soft-copy)]",
                    )}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-sm leading-6 text-[color:var(--muted-copy)]">
              Same-machine numbers are useful for regression checks, not public
              speed leadership claims. Real-device reports belong in the
              benchmark evidence page.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function CapabilityRows() {
  return (
    <section className="bg-[var(--lab-black)] px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="Useful features"
            title="Everything important is visible, cited, or downloadable."
            copy="The page keeps practical evidence close to the pitch: downloads, tickets, route state, security limits, benchmark data, and source links."
          />
        </Reveal>
        <Reveal delay={0.08}>
          <ol className="mt-12 overflow-hidden rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-green)] shadow-[0_28px_90px_rgba(0,0,0,0.24)]">
            {capabilityRows.map((row) => (
              <li
                key={row.index}
                className="border-b border-[color:var(--marketing-border)] last:border-b-0"
              >
                <a
                  href={row.proof.href}
                  className="group grid gap-3 p-5 transition hover:bg-[var(--marketing-surface-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)] sm:grid-cols-[72px_150px_minmax(0,1fr)] sm:gap-6 sm:p-6"
                >
                  <span className="text-xs font-bold uppercase tracking-[0.22em] text-[color:var(--muted-copy)]">
                    {row.index}
                  </span>
                  <span className="text-sm font-bold text-[var(--signal-green)]">
                    {row.label}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold leading-7 text-[var(--proof-paper)]">
                      {row.headline}
                    </h3>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--soft-copy)]">
                      {row.body}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--signal-green)]">
                      {row.proof.text}
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </a>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}

function SecuritySection() {
  const protects = [
    "Encrypted iroh QUIC transport.",
    "BLAKE3 content verification through iroh-blobs.",
    "Tickets treated as capability tokens.",
    "No hosted file-retention bucket.",
  ];
  const limits = [
    "No public third-party audit yet.",
    "Sender must remain online.",
    "Relays can observe connection metadata.",
    "Compromised endpoints remain compromised.",
  ];

  return (
    <section
      id="security"
      className="scroll-mt-24 bg-[var(--security-paper)] px-4 py-24 text-[var(--text-ink)] sm:px-6"
    >
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="Security model"
            title="Specific guarantees. Specific limits."
            copy="The website says what the app can actually prove, then stops. That is the trust model."
            surface="light"
          />
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <SecurityList title="Protects" tone="signal" items={protects} />
            <SecurityList title="Does not claim" tone="amber" items={limits} />
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <MarketingButton href="/security" variant="secondary">
              Read security page
              <ArrowRight className="h-4 w-4" />
            </MarketingButton>
            <MarketingButton
              href={`${REPO_URL}/blob/main/SECURITY.md`}
              variant="ghost"
            >
              SECURITY.md
            </MarketingButton>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function SecurityList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "signal" | "amber";
  items: string[];
}) {
  const lightTone = lightToneClass(tone);
  const Icon = tone === "signal" ? Check : Minus;

  return (
    <div className="rounded-lg border border-[var(--border-light)] bg-[var(--proof-paper)] p-6 shadow-[0_20px_60px_rgba(17,27,22,0.08)]">
      <h3 className={cx("text-xl font-semibold", lightTone)}>{title}</h3>
      <ul className="mt-5 grid gap-3">
        {items.map((item) => (
          <li
            key={item}
            className="flex gap-3 text-base leading-7 text-[color:var(--paper-copy)]"
          >
            <Icon
              className={cx("mt-1 h-5 w-5 shrink-0", lightTone)}
              aria-hidden="true"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DownloadSection() {
  return (
    <section
      id="download"
      className="scroll-mt-24 bg-[var(--lab-black)] px-4 py-24 sm:px-6"
    >
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="Download"
            title="Start with the native app."
            copy="Windows and Android are the practical paths today. Browser pages exist for handoff, docs, search, and install support."
          />
        </Reveal>

        <Reveal delay={0.08}>
          <div className="mt-12 grid gap-4 lg:grid-cols-[1.15fr_0.9fr_0.9fr]">
            {downloadOptions.map((option, index) => (
              <DownloadOption
                key={option.title}
                option={option}
                featured={index === 0}
              />
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.12}>
          <div className="mt-8 grid gap-3 text-sm text-[color:var(--soft-copy)] md:grid-cols-2 lg:grid-cols-5">
            <DownloadLink href={NSIS_DOWNLOAD_URL} icon={Download}>
              Classic NSIS
            </DownloadLink>
            <DownloadLink href={RELEASE_URL} icon={FileCheck2}>
              All release assets
            </DownloadLink>
            <DownloadLink href={ANDROID_CHECKSUMS_URL} icon={ShieldCheck}>
              Android checksums
            </DownloadLink>
            <DownloadLink href={DOWNLOAD_TRUST_URL} icon={BadgeCheck}>
              Download trust
            </DownloadLink>
            <DownloadLink href={EXPERIMENTAL_RELEASE_URL} icon={RadioTower}>
              Experimental v0.5.1
            </DownloadLink>
          </div>
        </Reveal>

        <Reveal delay={0.16}>
          <AndroidInstallGuide />
        </Reveal>
      </div>
    </section>
  );
}

function DownloadOption({
  option,
  featured,
}: {
  option: DownloadOptionData;
  featured: boolean;
}) {
  const Icon = option.icon;

  return (
    <article
      className={cx(
        "rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-green)] p-6 transition hover:border-[color:var(--signal-green)] hover:bg-[var(--marketing-surface-strong)]",
        featured &&
          "bg-[linear-gradient(180deg,var(--grid-green),var(--lab-green))]",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-[color:var(--marketing-border)] bg-[var(--marketing-surface)]">
          <Icon className={cx("h-5 w-5", toneClass(option.tone))} />
        </span>
        <span
          className={cx(
            "rounded-full px-3 py-1 text-xs font-semibold",
            toneClass(option.tone),
            "bg-[var(--marketing-surface)]",
          )}
        >
          {option.subtitle}
        </span>
      </div>
      <h3 className="mt-6 text-2xl font-semibold text-[var(--proof-paper)]">
        {option.title}
      </h3>
      <p className="mt-3 min-h-[72px] text-sm leading-6 text-[color:var(--soft-copy)]">
        {option.copy}
      </p>
      <MarketingButton href={option.href} className="mt-6 w-full sm:w-auto">
        <Download className="h-4 w-4" />
        {option.action}
      </MarketingButton>
    </article>
  );
}

function DownloadLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[color:var(--marketing-border)] bg-[var(--marketing-surface)] px-3 py-2 transition hover:border-[color:var(--signal-green)] hover:text-[var(--proof-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)]"
    >
      <Icon className="h-4 w-4 text-[var(--signal-green)]" />
      <span>{children}</span>
    </a>
  );
}

function AndroidInstallGuide() {
  const steps = [
    "Download the APK and SHA256SUMS-android.txt from the same GitHub Release.",
    "Compare the APK hash against the checksum file.",
    "Allow your browser or file manager to install unknown apps.",
    "Launch Lightning P2P and keep it open while sending or receiving.",
  ];

  return (
    <section className="mt-12 rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-green)] p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase text-[var(--proof-amber)]">
            Android sideload
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-[var(--proof-paper)]">
            Verify the APK before installing.
          </h3>
          <p className="mt-3 text-sm leading-6 text-[color:var(--soft-copy)]">
            The Android build is distributed through GitHub Releases. That keeps
            installation explicit while native Android transfer work stays on
            the same Rust and iroh path as desktop.
          </p>
        </div>
        <MarketingButton href={ANDROID_CHECKSUMS_URL} variant="secondary">
          <ShieldCheck className="h-4 w-4" />
          Checksums
        </MarketingButton>
      </div>
      <ol className="mt-6 grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step}
            className="rounded-lg border border-[color:var(--marketing-border)] bg-[var(--marketing-surface)] p-4 text-sm leading-6 text-[color:var(--soft-copy)]"
          >
            <span className="mb-3 block text-xs font-bold uppercase text-[var(--signal-green)]">
              {String(index + 1).padStart(2, "0")}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ComparisonTable() {
  const columns: Array<{
    key: keyof Omit<ComparisonRow, "tool" | "detail">;
    label: string;
  }> = [
    { key: "cloudUpload", label: "Cloud upload" },
    { key: "account", label: "Account" },
    { key: "wan", label: "WAN" },
    { key: "openSource", label: "Open source" },
    { key: "nativeWindows", label: "Native Windows" },
    { key: "verifiedContent", label: "Verified content" },
  ];

  return (
    <section
      id="compare"
      className="scroll-mt-24 bg-[var(--lab-green)] px-4 py-24 sm:px-6"
    >
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="Compare"
            title="Choose by model first, then measure speed."
            copy="This comparison is about transfer model and availability. Benchmark claims need route, hardware, file size, and version data."
          />
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mt-12 overflow-x-auto rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-black)] shadow-[0_28px_90px_rgba(0,0,0,0.24)]">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--marketing-border)]">
                  <th className="px-5 py-4 font-semibold text-[var(--proof-paper)]">
                    Tool
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className="px-5 py-4 text-center font-semibold text-[var(--proof-paper)]"
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
                      "border-t border-[color:var(--marketing-border)]",
                      row.tool === "Lightning P2P" && "bg-[var(--signal-bg)]",
                    )}
                  >
                    <th className="px-5 py-4 text-left font-normal" scope="row">
                      <span className="block font-semibold text-[var(--proof-paper)]">
                        {row.tool}
                      </span>
                      <span className="mt-1 block text-xs text-[color:var(--muted-copy)]">
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
        </Reveal>
      </div>
    </section>
  );
}

function ComparisonIndicator({ cell }: { cell: ComparisonCell }) {
  const Icon = cell.label === "Yes" ? Check : cell.label === "No" ? X : Minus;
  return (
    <span
      className={cx(
        "inline-flex min-w-24 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold",
        cell.tone === "positive" &&
          "border-[color:var(--signal-border)] bg-[var(--signal-bg)] text-[var(--signal-green)]",
        cell.tone === "negative" &&
          "border-[color:var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-copy)]",
        cell.tone === "neutral" &&
          "border-[color:var(--amber-border)] bg-[var(--amber-bg)] text-[var(--proof-amber)]",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{cell.label}</span>
    </span>
  );
}

function BenchmarkPreview() {
  const benchmarkRows = [
    {
      label: "10 MB same-machine",
      value: `${benchmarkTenMb?.medianEffectiveMbps ?? "n/a"} Mbps`,
    },
    {
      label: "100 MB same-machine",
      value: `${benchmarkHundredMb?.medianEffectiveMbps ?? "n/a"} Mbps`,
    },
    {
      label: "1 GB same-machine",
      value: `${benchmarkOneGb?.medianEffectiveMbps ?? "n/a"} Mbps`,
    },
    { label: "Transport", value: benchmarkSummary.transport },
    { label: "App version", value: benchmarkSummary.appVersion },
    { label: "Commit", value: benchmarkSummary.commitHash.slice(0, 8) },
  ];

  return (
    <section
      id="benchmarks"
      className="scroll-mt-24 bg-[var(--lab-black)] px-4 py-24 sm:px-6"
    >
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <Reveal>
          <SectionHeading
            eyebrow="Benchmarks"
            title="Proof first, claim second."
            copy="Lightning P2P is built for throughput, but public speed claims stay tied to repeatable reports and their caveats."
          />
        </Reveal>
        <Reveal delay={0.08}>
          <div className="rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-green)] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.24)]">
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {benchmarkRows.map((row) => (
                <div
                  key={row.label}
                  className="rounded-lg border border-[color:var(--marketing-border)] bg-[var(--marketing-surface)] p-4"
                >
                  <dt className="text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--muted-copy)]">
                    {row.label}
                  </dt>
                  <dd className="mt-2 font-mono text-lg font-semibold text-[var(--proof-paper)]">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-sm leading-6 text-[color:var(--muted-copy)]">
              {benchmarkSummary.caveat}
            </p>
            <MarketingButton
              href={`${REPO_URL}/blob/main/docs/BENCHMARKS.md`}
              variant="secondary"
              className="mt-6"
            >
              <BarChart3 className="h-4 w-4" />
              Benchmark methodology
            </MarketingButton>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function PlatformStatus() {
  return (
    <section className="bg-[var(--proof-paper)] px-4 py-24 text-[var(--text-ink)] sm:px-6">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="Platform status"
            title="Windows and Android now, broader native targets later."
            copy="The roadmap keeps the native transfer model intact instead of weakening it into a browser-only path."
            surface="light"
          />
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mt-12 grid gap-3 md:grid-cols-5">
            {platformStatus.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-[var(--border-light)] bg-[var(--security-paper)] p-5 shadow-[0_18px_50px_rgba(17,27,22,0.07)]"
              >
                <p className="text-sm text-[color:var(--paper-copy)]">
                  {item.label}
                </p>
                <p
                  className={cx(
                    "mt-3 text-xl font-semibold leading-7",
                    lightToneClass(item.tone),
                  )}
                >
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FAQAccordion({ faqs }: { faqs: Faq[] }) {
  return (
    <section className="bg-[var(--lab-black)] px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <Reveal>
          <SectionHeading
            eyebrow="FAQ"
            title="Fast answers without broad promises."
          />
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mt-10 divide-y divide-[color:var(--marketing-border)] overflow-hidden rounded-lg border border-[color:var(--marketing-border)] bg-[var(--lab-green)] shadow-[0_28px_90px_rgba(0,0,0,0.24)]">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="group p-5 open:bg-[var(--marketing-surface)] sm:p-6 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal-green)]">
                  <h3 className="text-base font-semibold text-[var(--proof-paper)] sm:text-lg">
                    {faq.q}
                  </h3>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[color:var(--marketing-border)] bg-[var(--marketing-surface)] text-[color:var(--soft-copy)] transition group-open:rotate-180 group-open:text-[var(--signal-green)]">
                    <ChevronDown className="h-4 w-4" />
                  </span>
                </summary>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-[color:var(--soft-copy)] sm:text-base">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-[var(--lab-green)] px-4 py-24 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--signal-green),transparent)] opacity-70"
      />
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="border-y border-[color:var(--marketing-border)] py-14">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--signal-green)]">
              Lightning P2P
            </p>
            <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <h2 className="max-w-5xl text-5xl font-semibold leading-[0.9] text-[var(--proof-paper)] sm:text-6xl lg:text-7xl xl:text-8xl">
                Send files directly. Keep the cloud out of the middle.
              </h2>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
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
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function HomeSections({ faqs }: { faqs: Faq[] }) {
  return (
    <>
      <RouteLab />
      <HowItWorks />
      <NativeTrace />
      <CapabilityRows />
      <SecuritySection />
      <DownloadSection />
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
        <DownloadSection />
        <SecuritySection />
        <BenchmarkPreview />
        <FAQAccordion faqs={faqs} />
      </>
    );
  }

  if (page.path === "/security") {
    return (
      <>
        <SecuritySection />
        <CapabilityRows />
        <DownloadSection />
        <FAQAccordion faqs={faqs} />
      </>
    );
  }

  if (page.path === "/benchmarks") {
    return (
      <>
        <BenchmarkPreview />
        <ComparisonTable />
        <DownloadSection />
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
      "/large-file-transfer",
      "/secure-p2p-file-transfer",
      "/open-source-file-transfer",
    ].includes(page.path)
  ) {
    return (
      <>
        <ComparisonTable />
        <CapabilityRows />
        <DownloadSection />
        <FAQAccordion faqs={faqs} />
      </>
    );
  }

  return (
    <>
      <RouteLab />
      <HowItWorks />
      <CapabilityRows />
      <SecuritySection />
      <DownloadSection />
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
        ["Android", "/android-p2p-file-transfer"],
        ["Security", "/security"],
        ["Large files", "/large-file-transfer"],
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
        ["Open-source transfer", "/open-source-file-transfer"],
      ],
    },
    {
      title: "Project",
      links: [
        ["Horalix", HORALIX_URL],
        ["GitHub", REPO_URL],
        ["License", `${REPO_URL}/blob/main/LICENSE`],
        ["Report issue", `${REPO_URL}/issues/new/choose`],
        ["Changelog", `${REPO_URL}/blob/main/CHANGELOG.md`],
      ],
    },
  ] as const;

  return (
    <footer className="border-t border-[color:var(--marketing-border)] bg-[var(--lab-black)] px-4 py-12 text-sm text-[color:var(--soft-copy)] sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.1fr_1.7fr]">
        <div>
          <a
            href="/"
            className="inline-flex items-center gap-3 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal-green)]"
          >
            <img
              src={siteLogoUrl}
              alt=""
              className="h-10 w-10 rounded-lg object-cover"
            />
            <span className="font-semibold text-[var(--proof-paper)]">
              Lightning P2P
            </span>
          </a>
          <p className="mt-4 max-w-sm leading-6">
            Free, open-source peer-to-peer file transfer for Windows and
            Android. No cloud upload, no account, no artificial file-size cap.
          </p>
          <p className="mt-4 max-w-sm text-xs leading-5 text-[color:var(--muted-copy)]">
            Made by{" "}
            <a
              href={HORALIX_URL}
              className="font-semibold text-[var(--signal-green)] underline-offset-4 hover:underline"
            >
              Horalix
            </a>
            . Built with Rust, Tauri, iroh, QUIC, and BLAKE3.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          {footerLinks.map((group) => (
            <div key={group.title}>
              <p className="font-semibold text-[var(--proof-paper)]">
                {group.title}
              </p>
              <ul className="mt-4 grid gap-2">
                {group.links.map(([label, href]) => (
                  <li key={href}>
                    <a
                      href={href}
                      className="transition hover:text-[var(--proof-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal-green)]"
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
    document.title = page.title;

    const canonicalUrl =
      page.path === "/"
        ? `${SITE_URL}/`
        : `${SITE_URL}${canonicalWebPath(page.path)}`;
    const canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );

    canonical?.setAttribute("href", canonicalUrl);
    setMetaContent('meta[name="description"]', page.description);
    setMetaContent('meta[property="og:title"]', page.title);
    setMetaContent('meta[property="og:description"]', page.description);
    setMetaContent('meta[property="og:url"]', canonicalUrl);
    setMetaContent('meta[name="twitter:title"]', page.title);
    setMetaContent('meta[name="twitter:description"]', page.description);
  }, [page]);

  if (page.path === "/receive") {
    return <ReceiveHandoffPage />;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--lab-black)] text-[var(--proof-paper)]">
      <Header activePath={page.path} />
      <main>
        <Hero page={page} isHome={isHome} />
        <TrustRibbon />
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
