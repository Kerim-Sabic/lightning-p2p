import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  ClipboardCheck,
  CloudOff,
  Code2,
  Download,
  ExternalLink,
  Eye,
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
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from "react";
import siteLogoUrl from "../assets/lightning-p2p-site-logo.png";
import benchmarkSummary from "../content/local-benchmark-summary.json";
import pages from "../content/web-pages.json";
import {
  ANDROID_APK_DOWNLOAD_URL,
  ANDROID_CHECKSUMS_URL,
  EXPERIMENTAL_RELEASE_URL,
  MSI_DOWNLOAD_URL,
  RELEASE_URL,
  REPO_URL,
  SITE_URL,
  STABLE_RELEASE_TAG,
  VELOPACK_DOWNLOAD_URL,
  canonicalWebPath,
} from "../lib/shareLinks";
import { ReceiveHandoffPage } from "./ReceiveHandoffPage";

// ── Types ────────────────────────────────────────────────────────────────────

interface Faq { q: string; a: string }
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
interface ComparisonCell { label: "Yes" | "No" | "Partial"; tone: CellTone }
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
interface KeyFact { label: string; value: string }
interface AnswerContent { answer: string; keyFacts: KeyFact[]; caveats: string[] }
interface ModeRow {
  key: string;
  name: string;
  tagline: string;
  parallelism: number;
  emitMs: number;
  windowMb: number;
  streamMb: number;
  streams: number;
  tone: StatusTone;
}

const webPages = pages as WebPage[];
const HORALIX_URL = "https://horalix.com";
const DOWNLOAD_TRUST_URL = `${REPO_URL}/blob/main/docs/download-trust.md`;
const AUDIT_URL = `${REPO_URL}/blob/main/AUDIT.md`;
const ROADMAP_URL = `${REPO_URL}/blob/main/docs/ROADMAP_v0.5_to_v0.7.md`;
const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;

// ── Data: bench (live from JSON) ────────────────────────────────────────────

const benchmarkTenMb = benchmarkSummary.scenarios.find((s) => s.scenario === "same_machine_10mb");
const benchmarkHundredMb = benchmarkSummary.scenarios.find((s) => s.scenario === "same_machine_100mb");
const benchmarkOneGb = benchmarkSummary.scenarios.find((s) => s.scenario === "same_machine_1gb");
const benchmarkManySmall = benchmarkSummary.scenarios.find((s) => s.scenario === "same_machine_many_small");

// ── Data: brand content ─────────────────────────────────────────────────────

const baseKeyFacts: KeyFact[] = [
  { label: "Product", value: "Lightning P2P" },
  { label: "Maker", value: "Horalix" },
  { label: "Category", value: "Peer-to-peer file transfer app" },
  { label: "Platform", value: "Windows stable, Android 10+ sideload" },
  { label: "Stable release", value: "v0.4.6" },
  { label: "Experimental release", value: "v0.5.1 speed modes + reliability" },
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
    "/download": "Download Lightning P2P from GitHub Releases when you want the stable Windows installer or Android 10+ sideload APK for direct-first P2P file transfer. The recommended Windows asset is the one-click setup; Android users should verify the APK checksum before installing.",
    "/android-p2p-file-transfer": "Lightning P2P supports Android 10+ sideload installs, Android system share-target sends, smart MediaStore receive routing, direct-first iroh transfer, and BLAKE3 verification.",
    "/security": "Lightning P2P avoids cloud file hosting, uses encrypted peer transport through iroh, verifies content with BLAKE3, and treats tickets as capability tokens. It makes specific security claims instead of broad privacy promises.",
    "/benchmarks": "Lightning P2P is designed for high-throughput direct transfer, but public speed claims should be tied to repeatable benchmark reports covering LAN direct, WAN direct, relay fallback, many small files, and large single files.",
    "/alternatives/airdrop-for-windows": "Lightning P2P is an open-source AirDrop-style file transfer app for Windows, focused on direct-first transfers, QR/link handoff, no account, and no cloud upload.",
    "/free-p2p-file-transfer": "Lightning P2P is a free P2P file transfer app for Windows and Android with no account, no cloud upload, no artificial file-size cap, direct-first transfer, and BLAKE3 verification.",
    "/large-file-transfer": "Lightning P2P sends huge files directly from sender to receiver without a hosted cloud upload step, no account, no artificial file-size cap, and BLAKE3 verification.",
    "/secure-p2p-file-transfer": "Lightning P2P uses encrypted iroh QUIC transport, BLAKE3 content verification through iroh-blobs, capability tickets, release checksums, and documented limitations instead of vague security promises.",
    "/open-source-file-transfer": "Lightning P2P is an Apache-2.0 open-source file transfer app built with Rust, Tauri, React, iroh, QUIC, iroh-blobs, and BLAKE3, with NOTICE and CITATION.cff metadata.",
    "/best-p2p-file-transfer": "Lightning P2P is a strong best-fit P2P file transfer choice for Windows and Android users who want a free open-source app, direct-first LAN and WAN transfer, no cloud upload, and verified content.",
    "/wetransfer-alternative": "WeTransfer is useful for hosted cloud links. Lightning P2P is better when you want to avoid uploading files to a cloud storage service and transfer directly from sender to receiver.",
    "/wormhole-alternative": "Magic Wormhole is a strong CLI file transfer tool. Lightning P2P serves users who want a graphical Windows and Android app with link and QR handoff, iroh connectivity, and BLAKE3 verification.",
    "/localsend-vs-lightning-p2p": "LocalSend is best for broad cross-platform LAN sharing today. Lightning P2P focuses on Windows and Android direct-first LAN and WAN transfers with iroh, QUIC, relay fallback, and BLAKE3 verification.",
    "/how-to-send-large-files": "To send large files peer-to-peer on Windows or Android, install Lightning P2P, drop files into Send, share the receive link or QR, and keep the sender online while the receiver streams verified bytes to disk.",
    "/send-files-between-windows-computers": "Lightning P2P sends files between Windows computers through a native app with no account, no cloud upload, no artificial file-size cap, direct-first connectivity, and BLAKE3 verification.",
  };
  return { answer: byPath[page.path] ?? `${page.intro} ${page.focus}`, keyFacts: baseKeyFacts, caveats: baseCaveats };
}

const defaultFaqs: Faq[] = [
  { q: "Is Lightning P2P free?", a: "Yes. Lightning P2P is free, open source, and Apache-2.0 licensed." },
  { q: "Who made Lightning P2P?", a: "Lightning P2P was made by Horalix. You can find Horalix at horalix.com." },
  { q: "Does it upload files to the cloud?", a: "No cloud upload is part of the product model. The sender stays online and the receiver pulls the file through iroh connectivity." },
  { q: "Does relay fallback store my files?", a: "No. Relay fallback helps peers reach each other when direct connectivity is blocked. It is not a cloud bucket or hosted retention service." },
  { q: "Do I need an account?", a: "No. There is no login, email capture, or paid account tier required to send or receive." },
  { q: "Can I use it in a browser?", a: "No. The browser site handles receive handoff and marketing. Real file transfer requires the native Lightning P2P app." },
  { q: "Does the sender need to stay online?", a: "Yes. The sender must keep Lightning P2P open and keep the content available until the receiver finishes." },
  { q: "Is there a file size limit?", a: "Lightning P2P does not impose an artificial file-size cap. Disk space, filesystem limits, network stability, and time still matter." },
  { q: "Is it available for macOS or Linux?", a: "Not yet. Windows and Android 10+ are the public release targets. macOS and Linux packaging are planned after the current native paths stay reliable." },
  { q: "Are tickets secret?", a: "Yes. Tickets are capability tokens. Anyone with a valid ticket can request that transfer while the sender is online, so treat tickets like secrets." },
];

const trustBadges: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Github, label: "Open source" },
  { icon: BadgeCheck, label: "Apache-2.0" },
  { icon: Code2, label: "Rust" },
  { icon: MonitorDown, label: "Tauri 2" },
  { icon: Route, label: "iroh QUIC" },
  { icon: FileCheck2, label: "BLAKE3" },
  { icon: CloudOff, label: "No cloud" },
  { icon: KeyRound, label: "No account" },
];

const workflowSteps: Array<{ icon: LucideIcon; index: string; title: string; copy: string }> = [
  { index: "01", icon: Upload, title: "Drop files", copy: "Pick a file or folder in the native app. Lightning P2P prepares it locally and produces a content hash." },
  { index: "02", icon: QrCode, title: "Share a ticket", copy: "Send the receive link, QR, or raw ticket through whatever messenger you trust. The ticket is the capability." },
  { index: "03", icon: ClipboardCheck, title: "Stream to disk", copy: "Receiver pastes the ticket; iroh-blobs streams BLAKE3-verified bytes straight into the destination folder." },
];

const speedModes: ModeRow[] = [
  { key: "battery_safe", name: "Battery Safe", tagline: "Mobile-friendly. Smallest windows, fast-fail idle.", parallelism: 8,   emitMs: 250, windowMb: 64,   streamMb: 16,  streams: 256,  tone: "amber" },
  { key: "standard",     name: "Standard",     tagline: "Safe default. Moderate concurrency, conservative QUIC.", parallelism: 64,  emitMs: 100, windowMb: 256,  streamMb: 64,  streams: 1024, tone: "muted" },
  { key: "fast",         name: "Fast",         tagline: "Full parallelism, same windows as Standard.", parallelism: 128, emitMs: 100, windowMb: 256,  streamMb: 64,  streams: 1024, tone: "signal" },
  { key: "extreme",      name: "Extreme",      tagline: "Larger windows + more streams. Slower UI emit.", parallelism: 128, emitMs: 200, windowMb: 512,  streamMb: 128, streams: 2048, tone: "signal" },
  { key: "lan_beast",    name: "LAN Beast",    tagline: "Maximum windows. Permissive timeouts for sustained transfers.", parallelism: 128, emitMs: 200, windowMb: 1024, streamMb: 256, streams: 4096, tone: "signal" },
];

const capabilityRows: Array<{ index: string; label: string; headline: string; body: string; proof: { text: string; href: string } }> = [
  { index: "01", label: "Transport",      headline: "Direct-first iroh QUIC with relay fallback.",                        body: "Peers dial directly when possible. Behind NAT or firewall, iroh relay assistance keeps the path reachable without becoming hosted storage.", proof: { text: "Architecture docs", href: `${REPO_URL}/blob/main/docs/ARCHITECTURE.md` } },
  { index: "02", label: "Blob transfer",  headline: "iroh-blobs handles content addressing, not custom chunking.",         body: "The Rust engine imports content into iroh-blobs, creates a ticket, and streams content-addressed bytes to the receiver.",          proof: { text: "Sender source",    href: `${REPO_URL}/blob/main/src-tauri/src/transfer/sender.rs` } },
  { index: "03", label: "Verification",   headline: "BLAKE3 ties output to the expected content hash.",                    body: "Receiver verifies bytes as they land. Mismatches surface as structured transfer errors, never silent corruption.",                 proof: { text: "Receiver source",  href: `${REPO_URL}/blob/main/src-tauri/src/transfer/receiver.rs` } },
  { index: "04", label: "Handoff",        headline: "Receive links keep raw tickets in the URL fragment.",                 body: "The website can help a receiver open the native app, but file bytes stay in the Rust path. Browser transfer is intentionally not the engine.", proof: { text: "Share link source", href: `${REPO_URL}/blob/main/src/lib/shareLinks.ts` } },
  { index: "05", label: "Release trust",  headline: "Installers, checksums, signing status, release notes attached.",      body: "Windows and Android artifacts publish through GitHub Releases with checksum material and documented installer behavior.",        proof: { text: "Release evidence", href: `${REPO_URL}/blob/main/docs/release-evidence.md` } },
  { index: "06", label: "Diagnostics",    headline: "Support data is designed to redact tickets and local paths.",         body: "Diagnostics are gathered locally, redacted, and copied by the user. Transfer secrets are not posted by the frontend automatically.", proof: { text: "Diagnostics source", href: `${REPO_URL}/blob/main/src-tauri/src/commands/diagnostics.rs` } },
];

const comparisonRows: ComparisonRow[] = [
  { tool: "Lightning P2P",  detail: "Direct-first Windows + Android app",  cloudUpload: { label: "No",      tone: "positive" }, account: { label: "No",      tone: "positive" }, wan: { label: "Yes",     tone: "positive" }, openSource: { label: "Yes", tone: "positive" }, nativeWindows: { label: "Yes",     tone: "positive" }, verifiedContent: { label: "Yes",     tone: "positive" } },
  { tool: "WeTransfer",     detail: "Hosted upload link",                  cloudUpload: { label: "Yes",     tone: "negative" }, account: { label: "Partial", tone: "neutral"  }, wan: { label: "Yes",     tone: "positive" }, openSource: { label: "No",  tone: "negative" }, nativeWindows: { label: "No",      tone: "negative" }, verifiedContent: { label: "No",      tone: "negative" } },
  { tool: "LocalSend",      detail: "Cross-platform LAN sharing",          cloudUpload: { label: "No",      tone: "positive" }, account: { label: "No",      tone: "positive" }, wan: { label: "No",      tone: "neutral"  }, openSource: { label: "Yes", tone: "positive" }, nativeWindows: { label: "Yes",     tone: "positive" }, verifiedContent: { label: "Partial", tone: "neutral"  } },
  { tool: "PairDrop",       detail: "Browser WebRTC sharing",              cloudUpload: { label: "No",      tone: "positive" }, account: { label: "No",      tone: "positive" }, wan: { label: "Partial", tone: "neutral"  }, openSource: { label: "Yes", tone: "positive" }, nativeWindows: { label: "No",      tone: "neutral"  }, verifiedContent: { label: "No",      tone: "negative" } },
  { tool: "Magic Wormhole", detail: "Command-line transfer",               cloudUpload: { label: "No",      tone: "positive" }, account: { label: "No",      tone: "positive" }, wan: { label: "Yes",     tone: "positive" }, openSource: { label: "Yes", tone: "positive" }, nativeWindows: { label: "Partial", tone: "neutral" }, verifiedContent: { label: "Yes",     tone: "positive" } },
];

const downloadOptions: Array<{ icon: LucideIcon; title: string; subtitle: string; copy: string; href: string; action: string; tone: StatusTone }> = [
  { icon: MonitorDown,  title: "Windows setup",  subtitle: "Stable v0.4.6",          copy: "One-click Velopack installer. Installs under your user profile and opens the native send + receive app.",                href: VELOPACK_DOWNLOAD_URL,        action: "Download for Windows", tone: "signal" },
  { icon: Smartphone,   title: "Android APK",    subtitle: "Android 10+ sideload",   copy: "Stable signed APK from GitHub Releases. Verify the SHA256 file before allowing sideload install.",                       href: ANDROID_APK_DOWNLOAD_URL,    action: "Download APK",         tone: "signal" },
  { icon: PackageCheck, title: "MSI package",    subtitle: "Managed deployments",    copy: "Use MSI when deployment tooling, inventory, or policy-managed installation matters more than the one-click setup.",     href: MSI_DOWNLOAD_URL,            action: "Download MSI",         tone: "muted"  },
];

const platformStatus = [
  { label: "Windows",        value: "Stable release",       tone: "signal" as StatusTone },
  { label: "Android",        value: "Stable sideload",      tone: "signal" as StatusTone },
  { label: "macOS / Linux",  value: "Planned",              tone: "amber"  as StatusTone },
  { label: "iOS",            value: "Not shipped",          tone: "muted"  as StatusTone },
  { label: "Browser",        value: "Receive handoff only", tone: "muted"  as StatusTone },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function currentPage(): WebPage {
  const path = window.location.pathname.replace(/\/$/u, "") || "/";
  const home = webPages.find((p) => p.path === "/");
  if (!home) throw new Error("Missing home page metadata.");
  return webPages.find((p) => p.path === path) ?? home;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function setMetaContent(selector: string, content: string): void {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute("content", content);
}

// IntersectionObserver-backed reveal — respects reduced motion automatically.
function Reveal({ children, delay = 0, className, as: As = "div" }: { children: ReactNode; delay?: number; className?: string; as?: keyof JSX.IntrinsicElements }) {
  const reduce = useReducedMotion();
  if (reduce) return <As className={className}>{children}</As>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0)" }}
      viewport={{ once: true, margin: "-10% 0px -10% 0px" }}
      transition={{ duration: 0.78, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

// Number that counts up from 0 to value when scrolled into view.
function CountUp({ value, duration = 1400, suffix = "", decimals = 0, className }: { value: number; duration?: number; suffix?: string; decimals?: number; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) { setDisplay(value); return; }
    const node = ref.current;
    if (!node) return;
    let started = false;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !started) {
          started = true;
          const start = performance.now();
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
            setDisplay(eased * value);
            if (t < 1) requestAnimationFrame(tick);
            else setDisplay(value);
          };
          requestAnimationFrame(tick);
          obs.disconnect();
        }
      });
    }, { rootMargin: "-10% 0px -10% 0px" });
    obs.observe(node);
    return () => obs.disconnect();
  }, [value, duration, reduce]);
  return <span ref={ref} className={cx("tabular", className)}>{display.toFixed(decimals)}{suffix}</span>;
}

// Marketing button with shine sweep on hover.
function CTA({ href, children, variant = "primary", className, ariaLabel, target }: { href: string; children: ReactNode; variant?: ButtonVariant; className?: string; ariaLabel?: string; target?: string }) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      target={target}
      rel={target ? "noopener" : undefined}
      className={cx(
        "group relative inline-flex min-h-11 items-center justify-center gap-2 overflow-hidden rounded-full px-5 py-3 text-sm font-semibold transition-[transform,box-shadow,background-color,border-color,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-green)] active:scale-[0.985]",
        variant === "primary" && "bg-[var(--signal-green)] text-[var(--text-ink)] shadow-[0_18px_46px_rgba(125,223,156,0.18)] hover:shadow-[0_26px_72px_rgba(125,223,156,0.30)] hover:brightness-[1.06]",
        variant === "secondary" && "border border-[color:var(--marketing-border-strong)] bg-[var(--marketing-surface)] text-[var(--proof-paper)] hover:border-[color:var(--signal-green)] hover:bg-[var(--marketing-surface-strong)]",
        variant === "ghost" && "text-[color:var(--soft-copy)] hover:bg-[var(--marketing-surface)] hover:text-[var(--proof-paper)]",
        className,
      )}
    >
      <span aria-hidden className={cx(
        "pointer-events-none absolute inset-y-0 left-0 w-12 -translate-x-16 skew-x-[-18deg] bg-white/30 opacity-0 transition duration-700 group-hover:translate-x-[24rem] group-hover:opacity-100",
        variant === "ghost" && "hidden",
      )} />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </a>
  );
}

// ── Atmosphere: ambient grid + orbs + scanline (fixed background) ───────────

function SiteAtmosphere() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 cinematic-grid" />
      {!reduce && (
        <>
          <div
            className="cinematic-orb"
            style={{
              top: "-12%",
              left: "8%",
              width: 520,
              height: 520,
              background: "radial-gradient(circle at center, oklch(82% 0.16 150 / 0.42), transparent 62%)",
              animationDuration: "44s",
            }}
          />
          <div
            className="cinematic-orb"
            style={{
              bottom: "-18%",
              right: "-6%",
              width: 620,
              height: 620,
              background: "radial-gradient(circle at center, oklch(81% 0.13 83 / 0.32), transparent 64%)",
              animationDuration: "62s",
              animationDirection: "reverse",
            }}
          />
        </>
      )}
      <div className="lab-scan-line" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--signal-green)]/60 to-transparent" />
    </div>
  );
}

// ── Scroll progress (top of viewport) ───────────────────────────────────────

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  return (
    <motion.div
      style={{ scaleX, transformOrigin: "0% 50%" }}
      className="fixed inset-x-0 top-0 z-[60] h-[2px] bg-[var(--signal-green)] shadow-[0_0_12px_var(--signal-green)]"
    />
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header({ activePath }: { activePath: string }) {
  const [open, setOpen] = useState(false);
  const [shrunk, setShrunk] = useState(false);
  useEffect(() => {
    const onScroll = () => setShrunk(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const navLinks: Array<{ href: string; label: string }> = [
    { href: "/", label: "Overview" },
    { href: "/security", label: "Security" },
    { href: "/benchmarks", label: "Benchmarks" },
    { href: "/download", label: "Download" },
  ];
  return (
    <header
      className={cx(
        "sticky top-0 z-50 backdrop-blur-md transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        shrunk ? "bg-[var(--lab-black)]/86 border-b border-white/[0.06]" : "bg-[var(--lab-black)]/24 border-b border-transparent",
      )}
    >
      <div className="mx-auto flex max-w-[1280px] items-center gap-6 px-6 py-3 sm:px-10">
        <a href="/" className="group flex items-center gap-3" aria-label="Lightning P2P home">
          <img src={siteLogoUrl} alt="" className="h-9 w-9 rounded-lg ring-1 ring-white/10 transition group-hover:ring-[color:var(--signal-green)]/50" />
          <span className="font-display text-[15px] font-bold tracking-[-0.02em] text-white">Lightning P2P</span>
          <span aria-hidden className="signal-dot mt-[2px]" />
        </a>
        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Primary">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={cx(
                "relative rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200",
                activePath === link.href ? "text-white" : "text-[color:var(--soft-copy)] hover:text-white",
              )}
            >
              {link.label}
              {activePath === link.href && (
                <span aria-hidden className="absolute inset-x-3 -bottom-[6px] h-px bg-[var(--signal-green)] shadow-[0_0_10px_var(--signal-green)]" />
              )}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <CTA href={RELEASE_URL} variant="secondary" className="hidden sm:inline-flex">
            <Github className="h-3.5 w-3.5" /> GitHub
          </CTA>
          <CTA href="/download">
            <Download className="h-3.5 w-3.5" /> Download
          </CTA>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="md:hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="border-t border-white/[0.06] px-6 pb-4 pt-3">
              {navLinks.map((link) => (
                <a key={link.href} href={link.href} className="block rounded-lg px-3 py-2.5 text-sm text-[color:var(--soft-copy)] hover:bg-white/5 hover:text-white">
                  {link.label}
                </a>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

// ── Hero: drenched lab-black, big display, live route SVG ───────────────────

function Hero({ page }: { page: WebPage }) {
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 600], [0, -60]);
  const reduce = useReducedMotion();
  return (
    <section className="relative isolate overflow-hidden">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-6 pb-20 pt-12 sm:px-10 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-32 lg:pt-20">
        <motion.div style={reduce ? undefined : { y: heroY }} className="relative z-10 flex max-w-[640px] flex-col gap-7">
          <div className="hero-rise inline-flex items-center gap-2 self-start rounded-full border border-[color:var(--signal-green)]/22 bg-[color:var(--signal-green)]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--signal-green)]">
            <span className="signal-dot !h-1.5 !w-1.5" /> v0.5.1 ─ speed modes shipped
          </div>
          <h1 className="font-display hero-rise hero-rise--stagger-1 text-balance text-[clamp(2.6rem,6.4vw,5.4rem)] font-extrabold leading-[0.94] tracking-[-0.025em] text-white">
            Direct files. <span className="text-[var(--signal-green)]">Verified bytes.</span>{" "}
            <span className="block text-white/86">No cloud account.</span>
          </h1>
          <p className="hero-rise hero-rise--stagger-2 max-w-[58ch] text-pretty text-[17px] leading-[1.6] text-[color:var(--soft-copy)]">
            {page.intro} Built in Rust on iroh QUIC and iroh-blobs. BLAKE3 verifies every chunk. The sender stays online; the receiver streams to disk. No upload to a cloud bucket, no account, no artificial size cap.
          </p>
          <div className="hero-rise hero-rise--stagger-3 flex flex-wrap items-center gap-3">
            <CTA href="/download" variant="primary"><Download className="h-3.5 w-3.5" /> Download for Windows</CTA>
            <CTA href={ANDROID_APK_DOWNLOAD_URL} variant="secondary"><Smartphone className="h-3.5 w-3.5" /> Android APK</CTA>
            <CTA href={REPO_URL} variant="ghost"><Github className="h-3.5 w-3.5" /> Source on GitHub <ExternalLink className="h-3 w-3" /></CTA>
          </div>
          <div className="hero-rise hero-rise--stagger-4 mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-[color:var(--muted-copy)]">
            <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[var(--signal-green)]" /> No telemetry by default</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[var(--signal-green)]" /> Apache-2.0 open source</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[var(--signal-green)]" /> Released v{benchmarkSummary.appVersion}</span>
          </div>
        </motion.div>
        <div className="relative">
          <HeroInstrument />
        </div>
      </div>
      <HeroProofStrip />
    </section>
  );
}

// SVG diagram: sender → ticket → relay/direct → receiver, with always-moving
// packet trails and a signal-green pulse on the verification node.
function HeroInstrument() {
  return (
    <div className="relative aspect-[5/4] w-full max-w-[640px] overflow-hidden rounded-[24px] border border-white/8 bg-[var(--lab-black)]/72 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
      <div className="absolute inset-0 cinematic-grid opacity-90" />
      <div className="lab-scan-line" />
      {/* Topology */}
      <svg viewBox="0 0 500 400" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="route-direct" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="oklch(82% 0.16 150 / 0)" />
            <stop offset="50%" stopColor="oklch(82% 0.16 150 / 0.85)" />
            <stop offset="100%" stopColor="oklch(82% 0.16 150 / 0)" />
          </linearGradient>
        </defs>
        {/* Direct route */}
        <path d="M 90 200 Q 250 70 410 200" className="route-trace" />
        {/* Relay route (amber, slower) */}
        <path d="M 90 200 Q 250 330 410 200" className="route-trace route-trace--relay" style={{ animationDelay: "0.4s" }} />
      </svg>
      {/* Nodes */}
      <div className="absolute left-[8%] top-1/2 -translate-y-1/2">
        <div className="flex flex-col items-center gap-2">
          <div className="relative grid h-16 w-16 place-items-center rounded-2xl border border-white/12 bg-white/[0.04] backdrop-blur">
            <MonitorDown className="h-7 w-7 text-white" />
            <span className="signal-dot absolute -right-1 -top-1" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--signal-green)]">Sender</span>
          <span className="text-[11px] text-white/64">Files on disk</span>
        </div>
      </div>
      <div className="absolute right-[8%] top-1/2 -translate-y-1/2">
        <div className="flex flex-col items-center gap-2">
          <div className="relative grid h-16 w-16 place-items-center rounded-2xl border border-[color:var(--signal-green)]/40 bg-[color:var(--signal-green)]/14 backdrop-blur">
            <FileCheck2 className="h-7 w-7 text-[var(--signal-green)]" />
            <span className="signal-dot absolute -right-1 -top-1" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--signal-green)]">Receiver</span>
          <span className="text-[11px] text-white/64">BLAKE3 verified</span>
        </div>
      </div>
      {/* Hub */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="grid h-14 w-14 place-items-center rounded-xl border border-white/16 bg-[var(--lab-black)]/90">
          <RadioTower className="h-6 w-6 text-white/80" />
        </div>
      </div>
      {/* Packet trails on direct path */}
      <div className="absolute left-[12%] top-[36%] right-[12%] h-[2px] overflow-hidden">
        <div className="packet-trail" />
        <div className="packet-trail packet-trail--lag-1" />
        <div className="packet-trail packet-trail--lag-2" />
      </div>
      {/* Readout overlay */}
      <div className="absolute bottom-4 left-4 right-4 grid grid-cols-3 gap-2 rounded-xl border border-white/8 bg-[var(--lab-black)]/68 p-3 backdrop-blur">
        <Readout label="Route" value="Direct" tone="signal" />
        <Readout label="Verify" value="BLAKE3" tone="signal" />
        <Readout label="Cloud" value="None" tone="muted" />
      </div>
    </div>
  );
}

function Readout({ label, value, tone }: { label: string; value: string; tone: StatusTone }) {
  const color = tone === "signal" ? "text-[var(--signal-green)]" : tone === "amber" ? "text-[var(--proof-amber)]" : "text-white/72";
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-[0.26em] text-white/40">{label}</p>
      <p className={cx("mt-1 text-[12px] font-semibold tabular", color)}>{value}</p>
    </div>
  );
}

function HeroProofStrip() {
  const rows = [
    { label: "Effective Mbps", value: benchmarkHundredMb?.medianEffectiveMbps ?? 0, decimals: 0, suffix: " Mbps", note: "100 MB · loopback" },
    { label: "Median total", value: benchmarkHundredMb?.medianTotalMs ?? 0, decimals: 0, suffix: " ms", note: "median of 5 runs" },
    { label: "Export hop", value: benchmarkHundredMb?.medianExportMs ?? 0, decimals: 0, suffix: " ms", note: "TryReference hardlink" },
    { label: "Bench commit", value: 0, decimals: 0, suffix: "", note: benchmarkSummary.commitHash.slice(0, 8), bypass: true },
  ];
  return (
    <div className="mx-auto max-w-[1280px] px-6 sm:px-10">
      <Reveal>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/[0.04] sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((row) => (
            <div key={row.label} className="bg-[var(--lab-black)]/80 px-5 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-white/40">{row.label}</p>
              <p className="font-display mt-2 text-[28px] font-extrabold leading-none tracking-[-0.02em] text-white">
                {row.bypass ? <span className="font-mono text-[20px] text-[var(--signal-green)]">{row.note}</span> : <><CountUp value={row.value} decimals={row.decimals} suffix={row.suffix} /></>}
              </p>
              {!row.bypass && <p className="mt-1 text-[11px] text-white/56">{row.note}</p>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-white/40">
          <span className="text-[var(--proof-amber)]">Caveat:</span> {benchmarkSummary.caveat}
        </p>
      </Reveal>
    </div>
  );
}

// ── Trust ribbon ────────────────────────────────────────────────────────────

function TrustRibbon() {
  return (
    <section className="mx-auto max-w-[1280px] px-6 py-12 sm:px-10">
      <Reveal>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-3 sm:gap-x-5">
          {trustBadges.map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3.5 py-1.5 text-[12px] font-medium text-white/82 transition hover:border-[color:var(--signal-green)]/40 hover:text-white">
              <Icon className="h-3.5 w-3.5 text-[var(--signal-green)]" /> {label}
            </span>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

// ── How it works ────────────────────────────────────────────────────────────

function HowItWorks() {
  return (
    <section className="relative mx-auto max-w-[1280px] px-6 py-20 sm:px-10 lg:py-28">
      <Reveal>
        <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-[var(--signal-green)]">Mechanism</p>
        <h2 className="font-display mt-3 max-w-[20ch] text-balance text-[clamp(2.2rem,4.6vw,3.6rem)] font-extrabold leading-[1.02] tracking-[-0.022em] text-white">
          Three moves. <span className="text-white/64">No upload step.</span>
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-white/8 bg-white/[0.04] md:grid-cols-3">
        {workflowSteps.map((step, i) => (
          <Reveal key={step.title} delay={i * 0.08}>
            <div className="relative h-full bg-[var(--lab-black)]/80 p-7">
              <div className="flex items-start justify-between">
                <span className="font-mono text-[11px] font-bold tracking-[0.18em] text-[var(--signal-green)]">{step.index}</span>
                <step.icon className="h-5 w-5 text-white/64" />
              </div>
              <h3 className="font-display mt-8 text-[22px] font-bold leading-tight text-white">{step.title}</h3>
              <p className="mt-3 text-[14px] leading-6 text-[color:var(--soft-copy)]">{step.copy}</p>
              {i < 2 && (
                <span aria-hidden className="absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-1/2 md:block">
                  <ArrowRight className="h-4 w-4 text-[var(--signal-green)] telemetry-blip" />
                </span>
              )}
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Speed modes showcase (v0.5.1 feature) ───────────────────────────────────

function SpeedModesShowcase() {
  const [hoverKey, setHoverKey] = useState<string>("fast");
  const active = (speedModes.find((m) => m.key === hoverKey) ?? speedModes[0]) as ModeRow;
  return (
    <section className="relative mx-auto max-w-[1280px] px-6 py-20 sm:px-10 lg:py-28">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        <Reveal>
          <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-[var(--signal-green)]">New in v0.5.1</p>
          <h2 className="font-display mt-3 text-balance text-[clamp(2.2rem,4.6vw,3.6rem)] font-extrabold leading-[1.02] tracking-[-0.022em] text-white">
            Five speed modes.<br /><span className="text-white/64">All bench-honest.</span>
          </h2>
          <p className="mt-6 max-w-[44ch] text-[15px] leading-7 text-[color:var(--soft-copy)]">
            Each mode swaps a complete transport profile: QUIC send/recv windows, stream caps, keepalive, import concurrency, idle timeouts, and UI emit cadence. The active mode persists and the node restarts when you change it.
          </p>
          <p className="mt-4 max-w-[44ch] text-[12px] leading-6 text-[var(--proof-amber)]/82">
            Honest: on same-machine loopback all five modes cluster within ~13% (626 – 710 Mbps). The hierarchy encodes design intent; LAN/WAN throughput delta lands with v0.6 validation.{" "}
            <a href={AUDIT_URL} className="underline decoration-[var(--proof-amber)]/40 underline-offset-2 hover:text-[var(--proof-amber)]">Read the audit →</a>
          </p>
        </Reveal>
        <div className="grid gap-2">
          {speedModes.map((mode, i) => {
            const isActive = mode.key === hoverKey;
            const toneAccent = mode.tone === "signal" ? "var(--signal-green)" : mode.tone === "amber" ? "var(--proof-amber)" : "rgba(255,255,255,0.4)";
            return (
              <Reveal key={mode.key} delay={i * 0.05}>
                <button
                  type="button"
                  onMouseEnter={() => setHoverKey(mode.key)}
                  onFocus={() => setHoverKey(mode.key)}
                  className={cx(
                    "group relative w-full overflow-hidden rounded-2xl border bg-[var(--lab-black)]/72 p-5 text-left transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    isActive ? "border-white/22 bg-[var(--lab-black)]/90 scale-[1.005]" : "border-white/8 hover:border-white/16",
                  )}
                  style={{ "--mode-accent": toneAccent } as CSSProperties}
                >
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1 transition-all duration-500" style={{ background: `linear-gradient(180deg, transparent, var(--mode-accent), transparent)`, opacity: isActive ? 1 : 0.32 }} />
                  <div className="flex flex-wrap items-baseline justify-between gap-3 pl-3">
                    <div>
                      <h3 className="font-display text-[18px] font-bold tracking-[-0.012em] text-white">{mode.name}</h3>
                      <p className="mt-1 text-[12.5px] leading-5 text-[color:var(--soft-copy)]">{mode.tagline}</p>
                    </div>
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: toneAccent }}>{mode.key}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-1 pl-3 font-mono text-[10px] text-white/56">
                    <ModeStat label="parallel" value={`${mode.parallelism}`} />
                    <ModeStat label="emit" value={`${mode.emitMs}ms`} />
                    <ModeStat label="win" value={`${mode.windowMb}MB`} />
                    <ModeStat label="streams" value={`${mode.streams}`} />
                  </div>
                </button>
              </Reveal>
            );
          })}
          <div aria-live="polite" className="sr-only">Active mode: {active.name}</div>
        </div>
      </div>
    </section>
  );
}

function ModeStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.22em] text-white/36">{label}</p>
      <p className="mt-1 text-[12px] font-semibold tabular text-white">{value}</p>
    </div>
  );
}

// ── Bench evidence (live numbers from JSON) ─────────────────────────────────

type BenchScenario = (typeof benchmarkSummary.scenarios)[number];
interface BenchRow { label: string; data: BenchScenario }

function BenchEvidence() {
  const scenarios: BenchRow[] = (
    [
      { label: "10 MB",       data: benchmarkTenMb },
      { label: "100 MB",      data: benchmarkHundredMb },
      { label: "1 GB",        data: benchmarkOneGb },
      { label: "200 × 100KB", data: benchmarkManySmall },
    ] as Array<{ label: string; data: BenchScenario | undefined }>
  ).filter((s): s is BenchRow => Boolean(s.data));
  return (
    <section className="relative mx-auto max-w-[1280px] px-6 py-20 sm:px-10 lg:py-28">
      <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr]">
        <Reveal>
          <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-[var(--signal-green)]">Evidence</p>
          <h2 className="font-display mt-3 max-w-[18ch] text-balance text-[clamp(2.2rem,4.6vw,3.6rem)] font-extrabold leading-[1.02] tracking-[-0.022em] text-white">
            Numbers come from a JSON file in the repo.
          </h2>
          <p className="mt-6 max-w-[44ch] text-[15px] leading-7 text-[color:var(--soft-copy)]">
            The bench tool is committed under <a href={`${REPO_URL}/blob/main/src-tauri/src/bin/benchmark_local.rs`} className="underline decoration-white/24 underline-offset-2 hover:text-white">src-tauri/src/bin/benchmark_local.rs</a>. Same-machine loopback only. JSON + CSV land under <a href={`${REPO_URL}/tree/main/docs/reports/raw`} className="underline decoration-white/24 underline-offset-2 hover:text-white">docs/reports/raw/</a>.
          </p>
          <dl className="mt-6 grid max-w-md grid-cols-1 gap-3 text-[13px] text-white/72">
            <Fact label="Hardware" value="AMD Zen 5, Windows 11 Build 26200, NVMe" />
            <Fact label="Harness" value={benchmarkSummary.harness} />
            <Fact label="Transport" value={benchmarkSummary.transport} />
            <Fact label="App version / commit" value={`v${benchmarkSummary.appVersion} · ${benchmarkSummary.commitHash.slice(0, 8)}`} />
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <CTA href={`${REPO_URL}/tree/main/docs/reports/raw`} variant="secondary" target="_blank"><ExternalLink className="h-3.5 w-3.5" /> Raw reports</CTA>
            <CTA href={AUDIT_URL} variant="ghost" target="_blank"><Eye className="h-3.5 w-3.5" /> AUDIT.md</CTA>
          </div>
        </Reveal>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/[0.04]">
          {scenarios.map((s, i) => {
            const max = Math.max(...scenarios.map((x) => x.data.medianEffectiveMbps));
            const target = s.data.medianEffectiveMbps / max;
            return (
              <Reveal key={s.label} delay={i * 0.06}>
                <div className="relative bg-[var(--lab-black)]/80 px-6 py-5">
                  <div className="flex items-baseline justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-white/40">{s.label}</p>
                      <p className="font-display mt-1.5 text-[26px] font-extrabold leading-none tracking-[-0.018em] text-white">
                        <CountUp value={s.data.medianEffectiveMbps} decimals={1} suffix=" Mbps" />
                      </p>
                    </div>
                    <div className="text-right text-[11px] text-white/56">
                      <p>median <span className="tabular text-white/82">{s.data.medianTotalMs}ms</span></p>
                      <p>export <span className="tabular text-white/82">{s.data.medianExportMs}ms</span></p>
                    </div>
                  </div>
                  <div className="mt-3 h-[6px] overflow-hidden rounded-full bg-white/[0.05]">
                    <div className="meter-fill h-full rounded-full bg-gradient-to-r from-[var(--signal-green)]/56 to-[var(--signal-green)]" style={{ "--meter-target": target } as CSSProperties} />
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
      <dt className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/40">{label}</dt>
      <dd className="text-right text-white/82">{value}</dd>
    </div>
  );
}

// ── Security model (paper section, contrast) ────────────────────────────────

function SecurityModel() {
  const items = [
    { icon: ShieldCheck,   title: "Encrypted at the transport",        body: "iroh's QUIC stack encrypts every byte between peers. No plaintext on the wire. No upload step to a hosted bucket." },
    { icon: FileCheck2,    title: "BLAKE3 verifies output",             body: "iroh-blobs hashes content and verifies as the receiver streams to disk. Mismatches surface as structured errors, never silent corruption." },
    { icon: KeyRound,      title: "Tickets are capabilities",            body: "A ticket is the secret. Anyone with a valid one can request that share while the sender is online. Treat tickets like keys." },
    { icon: Eye,           title: "Diagnostics are redacted",            body: "Support bundles are gathered locally and redacted before you copy them. The frontend never auto-posts transfer secrets." },
  ];
  return (
    <section className="relative isolate overflow-hidden bg-[var(--security-paper)] text-[var(--text-ink)]">
      <div className="absolute inset-0 opacity-[0.25]" style={{
        backgroundImage: "repeating-linear-gradient(90deg, transparent 0, transparent 78px, rgba(0,0,0,0.04) 78px, rgba(0,0,0,0.04) 79px)",
      }} />
      <div className="relative mx-auto max-w-[1280px] px-6 py-20 sm:px-10 lg:py-28">
        <Reveal>
          <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-[var(--amber-ink)]">Security model</p>
          <h2 className="font-display mt-3 max-w-[22ch] text-balance text-[clamp(2.2rem,4.6vw,3.6rem)] font-extrabold leading-[1.02] tracking-[-0.022em] text-[var(--text-ink)]">
            Specific claims. <span className="text-[var(--paper-copy)]">No vague privacy promises.</span>
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-[color:var(--border-light)] bg-[color:var(--border-light)] sm:grid-cols-2">
          {items.map((item, i) => (
            <Reveal key={item.title} delay={i * 0.06}>
              <div className="h-full bg-[var(--security-paper)] p-7">
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-[color:var(--border-light)] bg-white/56">
                  <item.icon className="h-5 w-5 text-[var(--amber-ink)]" />
                </div>
                <h3 className="font-display mt-5 text-[20px] font-bold leading-tight text-[var(--text-ink)]">{item.title}</h3>
                <p className="mt-3 text-[14px] leading-6 text-[color:var(--paper-copy)]">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.18}>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 text-[13px] text-[color:var(--paper-copy)]">
            <p>Threat model and disclosure policy live in the repo.</p>
            <div className="flex gap-3">
              <a href={`${REPO_URL}/blob/main/docs/security-model.md`} className="font-semibold text-[var(--text-ink)] underline decoration-[var(--amber-ink)]/40 underline-offset-4 hover:decoration-[var(--amber-ink)]">Security model →</a>
              <a href={`${REPO_URL}/blob/main/SECURITY.md`} className="font-semibold text-[var(--text-ink)] underline decoration-[var(--amber-ink)]/40 underline-offset-4 hover:decoration-[var(--amber-ink)]">Report a vulnerability →</a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ── Capability rows (numbered 01-06) ────────────────────────────────────────

function CapabilityRows() {
  return (
    <section className="relative mx-auto max-w-[1280px] px-6 py-20 sm:px-10 lg:py-28">
      <Reveal>
        <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-[var(--signal-green)]">Engineering</p>
        <h2 className="font-display mt-3 max-w-[26ch] text-balance text-[clamp(2.2rem,4.6vw,3.6rem)] font-extrabold leading-[1.02] tracking-[-0.022em] text-white">
          Six pieces. <span className="text-white/64">Each one linked to source.</span>
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-white/8 bg-white/[0.04] md:grid-cols-2">
        {capabilityRows.map((row, i) => (
          <Reveal key={row.index} delay={i * 0.05}>
            <article className="group h-full bg-[var(--lab-black)]/80 p-7 transition hover:bg-[var(--lab-black)]/94">
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-[var(--signal-green)]">{row.index}</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.26em] text-white/40">{row.label}</span>
              </div>
              <h3 className="font-display mt-4 text-[20px] font-bold leading-snug tracking-[-0.012em] text-white">{row.headline}</h3>
              <p className="mt-3 text-[14px] leading-6 text-[color:var(--soft-copy)]">{row.body}</p>
              <a href={row.proof.href} target="_blank" rel="noopener" className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--signal-green)] transition group-hover:gap-2.5">
                {row.proof.text} <ArrowRight className="h-3 w-3" />
              </a>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Comparison (light paper) ────────────────────────────────────────────────

function Comparison() {
  const cols: Array<{ key: keyof Omit<ComparisonRow, "tool" | "detail">; label: string }> = [
    { key: "cloudUpload",     label: "No cloud upload" },
    { key: "account",         label: "No account" },
    { key: "wan",             label: "WAN" },
    { key: "openSource",      label: "Open source" },
    { key: "nativeWindows",   label: "Native Windows" },
    { key: "verifiedContent", label: "Verified content" },
  ];
  return (
    <section className="relative isolate overflow-hidden bg-[var(--proof-paper)] text-[var(--text-ink)]">
      <div className="mx-auto max-w-[1280px] px-6 py-20 sm:px-10 lg:py-28">
        <Reveal>
          <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-[var(--signal-ink)]">Comparison</p>
          <h2 className="font-display mt-3 max-w-[22ch] text-balance text-[clamp(2.2rem,4.6vw,3.6rem)] font-extrabold leading-[1.02] tracking-[-0.022em] text-[var(--text-ink)]">
            Honest table. <span className="text-[var(--paper-copy)]">No competitor-bashing.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <div className="mt-10 overflow-x-auto rounded-2xl border border-[color:var(--border-light)] bg-white/72">
            <table className="w-full min-w-[760px] border-collapse text-left text-[14px]">
              <thead>
                <tr className="border-b border-[color:var(--border-light)] text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--paper-copy)]">
                  <th className="px-4 py-3.5">Tool</th>
                  {cols.map((c) => <th key={c.key} className="px-3 py-3.5 text-center">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.tool} className={cx("border-b border-[color:var(--border-light)] last:border-0", row.tool === "Lightning P2P" && "bg-[color:var(--signal-green)]/12")}>
                    <td className="px-4 py-3.5">
                      <p className="font-display font-bold tracking-[-0.012em] text-[var(--text-ink)]">{row.tool}</p>
                      <p className="text-[12px] text-[color:var(--paper-copy)]">{row.detail}</p>
                    </td>
                    {cols.map((c) => {
                      const cell = row[c.key];
                      const Icon = cell.label === "Yes" ? Check : cell.label === "No" ? X : Minus;
                      const color = cell.tone === "positive" ? "text-[var(--signal-ink)]" : cell.tone === "negative" ? "text-[oklch(50%_0.16_24)]" : "text-[var(--amber-ink)]";
                      return (
                        <td key={String(c.key)} className="px-3 py-3.5 text-center">
                          <span className={cx("inline-flex flex-col items-center gap-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]", color)}>
                            <Icon className="h-4 w-4" />
                            {cell.label}
                          </span>
                        </td>
                      );
                    })}
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

// ── Download ────────────────────────────────────────────────────────────────

function DownloadSection() {
  return (
    <section id="download" className="relative mx-auto max-w-[1280px] px-6 py-20 sm:px-10 lg:py-28">
      <Reveal>
        <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-[var(--signal-green)]">Install</p>
        <h2 className="font-display mt-3 max-w-[20ch] text-balance text-[clamp(2.2rem,4.6vw,3.6rem)] font-extrabold leading-[1.02] tracking-[-0.022em] text-white">
          Three downloads. <span className="text-white/64">Signed where Microsoft + Google require it.</span>
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {downloadOptions.map((option, i) => (
          <Reveal key={option.title} delay={i * 0.08}>
            <article className="group relative h-full overflow-hidden rounded-3xl border border-white/8 bg-[var(--lab-black)]/82 p-7 transition hover:border-[color:var(--signal-green)]/30">
              <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--signal-green)]/40 to-transparent opacity-0 transition group-hover:opacity-100" />
              <div className="flex items-start justify-between">
                <div className="grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
                  <option.icon className="h-5 w-5 text-white" />
                </div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--signal-green)]">{option.subtitle}</span>
              </div>
              <h3 className="font-display mt-6 text-[22px] font-bold tracking-[-0.012em] text-white">{option.title}</h3>
              <p className="mt-3 text-[14px] leading-6 text-[color:var(--soft-copy)]">{option.copy}</p>
              <CTA href={option.href} variant="primary" className="mt-6"><Download className="h-3.5 w-3.5" /> {option.action}</CTA>
            </article>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.16}>
        <div className="mt-10 grid gap-6 rounded-3xl border border-white/8 bg-white/[0.03] p-6 sm:p-8 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--proof-amber)]">Verify before you trust</p>
            <p className="font-display mt-2 text-[18px] font-bold tracking-[-0.012em] text-white">Every release publishes SHA256 + signing details.</p>
            <p className="mt-2 max-w-[60ch] text-[13.5px] leading-6 text-[color:var(--soft-copy)]">
              Windows installers go through Velopack, NSIS, and MSI. Android APKs are signed and ship with checksums. Compare before you install.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <CTA href={DOWNLOAD_TRUST_URL} variant="secondary" target="_blank">Download trust guide</CTA>
            <CTA href={ANDROID_CHECKSUMS_URL} variant="ghost" target="_blank">SHA256 for APK</CTA>
          </div>
        </div>
      </Reveal>
      <Reveal delay={0.22}>
        <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/[0.04] sm:grid-cols-5">
          {platformStatus.map((p) => (
            <div key={p.label} className="bg-[var(--lab-black)]/80 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">{p.label}</p>
              <p className={cx("mt-1.5 text-[12.5px] font-semibold tabular", p.tone === "signal" && "text-[var(--signal-green)]", p.tone === "amber" && "text-[var(--proof-amber)]", p.tone === "muted" && "text-white/64")}>{p.value}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

// ── AnswerBlocks (FAQ + key facts + caveats) ────────────────────────────────

function AnswerBlocks({ page }: { page: WebPage }) {
  const content = useMemo(() => answerContentForPage(page), [page]);
  const faqs = page.faqs?.length ? page.faqs : defaultFaqs;
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <section className="relative isolate overflow-hidden bg-[var(--proof-paper)] text-[var(--text-ink)]">
      <div className="mx-auto max-w-[1280px] px-6 py-20 sm:px-10 lg:py-28">
        <Reveal>
          <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-[var(--signal-ink)]">Q + A</p>
          <h2 className="font-display mt-3 max-w-[22ch] text-balance text-[clamp(2.2rem,4.6vw,3.6rem)] font-extrabold leading-[1.02] tracking-[-0.022em] text-[var(--text-ink)]">
            Common questions. <span className="text-[var(--paper-copy)]">Direct answers.</span>
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="overflow-hidden rounded-2xl border border-[color:var(--border-light)] bg-white/72">
            {faqs.map((faq, i) => {
              const open = openIdx === i;
              return (
                <button
                  key={faq.q}
                  type="button"
                  onClick={() => setOpenIdx(open ? null : i)}
                  className={cx("w-full border-b border-[color:var(--border-light)] px-5 py-5 text-left transition last:border-0 hover:bg-white/56", open && "bg-white/56")}
                  aria-expanded={open}
                >
                  <div className="flex items-start gap-4">
                    <ChevronDown className={cx("mt-1 h-4 w-4 shrink-0 text-[color:var(--paper-copy)] transition-transform duration-300", open && "rotate-180 text-[var(--signal-ink)]")} />
                    <div className="flex-1">
                      <p className="font-display text-[15.5px] font-bold tracking-[-0.012em] text-[var(--text-ink)]">{faq.q}</p>
                      <div
                        className="grid overflow-hidden transition-[grid-template-rows,opacity] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]"
                        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
                      >
                        <div className="min-h-0">
                          <p className="mt-3 max-w-[68ch] text-[14px] leading-[1.7] text-[color:var(--paper-copy)]">{faq.a}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <Reveal>
            <div className="overflow-hidden rounded-2xl border border-[color:var(--border-light)] bg-white/72 p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--amber-ink)]">Key facts</p>
              <dl className="mt-4 grid grid-cols-1 gap-2 text-[13.5px]">
                {content.keyFacts.slice(0, 9).map((f) => (
                  <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-[color:var(--border-light)] pb-1.5 last:border-0">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--paper-copy)]">{f.label}</dt>
                    <dd className="text-right text-[var(--text-ink)]">{f.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--amber-ink)]">Caveats</p>
              <ul className="mt-3 space-y-2.5 text-[13.5px] leading-6 text-[color:var(--paper-copy)]">
                {content.caveats.map((c) => <li key={c} className="flex gap-2"><span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--amber-ink)]" /> {c}</li>)}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────

function SiteFooter() {
  const cols: Array<{ label: string; links: Array<{ label: string; href: string }> }> = [
    { label: "Product",   links: [{ label: "Download",   href: "/download" }, { label: "Security model", href: "/security" }, { label: "Benchmarks", href: "/benchmarks" }, { label: "Source on GitHub", href: REPO_URL }] },
    { label: "Docs",      links: [{ label: "AUDIT.md",   href: AUDIT_URL }, { label: "ROADMAP v0.5 → v0.7", href: ROADMAP_URL }, { label: "CHANGELOG", href: CHANGELOG_URL }, { label: "Architecture", href: `${REPO_URL}/blob/main/docs/ARCHITECTURE.md` }] },
    { label: "Trust",     links: [{ label: "Download trust", href: DOWNLOAD_TRUST_URL }, { label: "Android trust", href: `${REPO_URL}/blob/main/docs/android-trust.md` }, { label: "Report a vulnerability", href: `${REPO_URL}/blob/main/SECURITY.md` }, { label: "License (Apache-2.0)", href: `${REPO_URL}/blob/main/LICENSE` }] },
    { label: "Maker",     links: [{ label: "Horalix",    href: HORALIX_URL }, { label: "Stable release", href: `${REPO_URL}/releases/tag/${STABLE_RELEASE_TAG}` }, { label: "Experimental release", href: EXPERIMENTAL_RELEASE_URL }] },
  ];
  return (
    <footer className="relative isolate overflow-hidden border-t border-white/[0.06] bg-[var(--lab-black)] text-white">
      <div className="absolute inset-0 cinematic-grid opacity-50" />
      <div className="relative mx-auto max-w-[1280px] px-6 py-16 sm:px-10">
        <div className="grid gap-10 md:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
          <div>
            <a href="/" className="inline-flex items-center gap-3" aria-label="Lightning P2P home">
              <img src={siteLogoUrl} alt="" className="h-10 w-10 rounded-lg ring-1 ring-white/10" />
              <div>
                <p className="font-display text-[16px] font-extrabold tracking-[-0.018em] text-white">Lightning P2P</p>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--signal-green)]">Speed lab</p>
              </div>
            </a>
            <p className="mt-4 max-w-[40ch] text-[13.5px] leading-6 text-[color:var(--soft-copy)]">
              A free, open-source peer-to-peer file transfer app for Windows and Android. Built by Horalix on iroh QUIC + iroh-blobs. Apache-2.0.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold text-white/82"><span className="signal-dot !h-1.5 !w-1.5" /> v{benchmarkSummary.appVersion}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/64">{benchmarkSummary.commitHash.slice(0, 8)}</span>
            </div>
          </div>
          {cols.map((col) => (
            <div key={col.label}>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/40">{col.label}</p>
              <ul className="mt-4 space-y-2.5 text-[13.5px]">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="text-[color:var(--soft-copy)] transition hover:text-white" target={l.href.startsWith("http") ? "_blank" : undefined} rel={l.href.startsWith("http") ? "noopener" : undefined}>{l.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-6 text-[12px] text-white/56">
          <p>Apache-2.0 · © {new Date().getFullYear()} Horalix · Built on iroh + iroh-blobs</p>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em]">site: {SITE_URL.replace("https://", "")}</p>
        </div>
      </div>
    </footer>
  );
}

// ── Page composition + routing + meta tags ──────────────────────────────────

export function WebLandingPage() {
  const [page, setPage] = useState<WebPage>(() => currentPage());
  useEffect(() => {
    const onPop = () => setPage(currentPage());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    document.title = page.title;
    setMetaContent("meta[name=\"description\"]", page.description);
    const canonical = canonicalWebPath(page.path);
    setMetaContent("link[rel=\"canonical\"]", `${SITE_URL}${canonical === "/" ? "" : canonical}`);
    const og = (sel: string, content: string) => setMetaContent(sel, content);
    og("meta[property=\"og:title\"]", page.title);
    og("meta[property=\"og:description\"]", page.description);
    og("meta[property=\"og:url\"]", `${SITE_URL}${canonical === "/" ? "" : canonical}`);
    og("meta[name=\"twitter:title\"]", page.title);
    og("meta[name=\"twitter:description\"]", page.description);
  }, [page]);
  const pathname = typeof window !== "undefined" ? window.location.pathname.replace(/\/$/u, "") || "/" : "/";
  if (pathname === "/receive") return <ReceiveHandoffPage />;
  return (
    <div className="relative min-h-screen bg-[var(--lab-black)] text-white">
      <SiteAtmosphere />
      <ScrollProgress />
      <Header activePath={page.path} />
      <main>
        <Hero page={page} />
        <TrustRibbon />
        <HowItWorks />
        <SpeedModesShowcase />
        <BenchEvidence />
        <SecurityModel />
        <CapabilityRows />
        <Comparison />
        <DownloadSection />
        <AnswerBlocks page={page} />
      </main>
      <SiteFooter />
    </div>
  );
}
