import {
  ArrowRight,
  BadgeCheck,
  Bluetooth,
  Check,
  CloudOff,
  Download,
  FileCheck2,
  FileUp,
  GitBranch,
  Globe2,
  KeyRound,
  Laptop,
  LockKeyhole,
  MessageCircle,
  MonitorDown,
  Radio,
  ShieldCheck,
  Smartphone,
  Users,
  WifiOff,
  Zap,
  type LucideIcon,
} from "lucide-react";
import siteLogoUrl from "../../assets/lightning-p2p-site-logo.png";
import releaseManifest from "../../content/release-manifest.json";
import {
  ANDROID_APK_DOWNLOAD_URL,
  LINUX_APPIMAGE_DOWNLOAD_URL,
  MACOS_DMG_DOWNLOAD_URL,
  REPO_URL,
  VELOPACK_DOWNLOAD_URL,
} from "../../lib/shareLinks";

interface PlatformDownload {
  label: string;
  detail: string;
  href: string;
  icon: LucideIcon;
}

const secondaryDownloads = [
  {
    label: "macOS",
    detail: "Universal DMG · beta",
    href: MACOS_DMG_DOWNLOAD_URL,
    icon: Laptop,
  },
  {
    label: "Linux",
    detail: "AppImage · x86_64",
    href: LINUX_APPIMAGE_DOWNLOAD_URL,
    icon: MonitorDown,
  },
  {
    label: "Android",
    detail: "APK · Android 10+",
    href: ANDROID_APK_DOWNLOAD_URL,
    icon: Smartphone,
  },
] satisfies PlatformDownload[];

const transferProof = [
  "No account or cloud upload",
  "Direct-first QUIC with relay fallback",
  "BLAKE3 verification as bytes arrive",
] as const;

const chatProof = [
  "Nearby and internet conversations",
  "Encrypted direct messages and read state",
  "Separate identity and emergency wipe",
] as const;

export function ProductHome() {
  return (
    <>
      <ProductHero />
      <ProductPillars />
      <DownloadDeck />
      <TrustBand />
      <FinalCallToAction />
    </>
  );
}

function ProductHero() {
  return (
    <section className="product-hero relative isolate overflow-hidden">
      <div
        aria-hidden
        className="absolute left-1/2 top-0 h-[640px] w-[1100px] -translate-x-1/2 rounded-full bg-[color:var(--signal-green)]/[0.06] blur-[120px]"
      />
      <div className="relative mx-auto grid max-w-[1320px] items-center gap-14 px-6 pb-20 pt-16 sm:px-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16 lg:pb-28 lg:pt-24">
        <div className="max-w-[720px]">
          <div className="hero-rise inline-flex items-center gap-2 rounded-full border border-[color:var(--signal-green)]/25 bg-[color:var(--signal-green)]/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--signal-green)]">
            <span className="signal-dot !h-1.5 !w-1.5" />
            Desktop beta {releaseManifest.currentAppVersion}
          </div>
          <h1 className="font-display hero-rise hero-rise--stagger-1 mt-7 text-balance text-[clamp(3.15rem,7.8vw,6.9rem)] font-extrabold leading-[0.9] tracking-[-0.045em] text-white">
            Move anything.
            <span className="mt-1 block text-[var(--signal-green)]">
              Message anyone.
            </span>
          </h1>
          <p className="hero-rise hero-rise--stagger-2 mt-7 max-w-[58ch] text-pretty text-[clamp(1rem,1.3vw,1.18rem)] leading-[1.65] text-[var(--soft-copy)]">
            One private desktop app for fast peer-to-peer file transfer and
            secure Lightning Chat. Your files stay out of cloud storage, your
            conversations keep a separate identity, and both work from the same
            calm, native workspace.
          </p>
          <div className="hero-rise hero-rise--stagger-3 mt-8 flex flex-wrap gap-3">
            <a
              href={VELOPACK_DOWNLOAD_URL}
              className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--signal-green)] px-6 text-[14px] font-extrabold text-[var(--text-ink)] shadow-[0_16px_42px_oklch(82%_0.15_150/0.2)] transition duration-200 hover:-translate-y-0.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal-green)] active:translate-y-0"
            >
              <Download className="h-4 w-4" />
              Download for Windows
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="/chat"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/14 bg-white/[0.05] px-6 text-[14px] font-bold text-white transition duration-200 hover:-translate-y-0.5 hover:border-white/24 hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              <MessageCircle className="h-4 w-4 text-[var(--signal-green)]" />
              Open web chat
            </a>
          </div>
          <div className="hero-rise hero-rise--stagger-4 mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-white/58">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-[var(--signal-green)]" />
              Free and open source
            </span>
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-[var(--signal-green)]" />
              No sign-up
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CloudOff className="h-3.5 w-3.5 text-[var(--signal-green)]" />
              No file hosting
            </span>
          </div>
        </div>
        <DesktopProductPreview />
      </div>
      <ProductModeRail />
    </section>
  );
}

function DesktopProductPreview() {
  return (
    <div className="hero-rise hero-rise--stagger-2 relative mx-auto w-full max-w-[700px]">
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[44px] bg-gradient-to-br from-[color:var(--signal-green)]/12 via-transparent to-[color:var(--proof-amber)]/8 blur-2xl"
      />
      <div className="product-window relative overflow-hidden rounded-[28px] border border-white/12 bg-[oklch(15.5%_0.014_162/0.96)] shadow-[0_48px_140px_rgba(0,0,0,0.62)]">
        <div className="flex h-12 items-center gap-2 border-b border-white/[0.07] px-5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/18" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/12" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/8" />
          <span className="mx-auto -translate-x-5 font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-white/34">
            Lightning P2P
          </span>
        </div>
        <div className="grid min-h-[480px] sm:grid-cols-[150px_1fr]">
          <aside className="hidden border-r border-white/[0.07] bg-black/10 p-3 sm:block">
            <div className="mb-5 flex items-center gap-2 px-2 pt-1">
              <img
                src={siteLogoUrl}
                alt=""
                className="h-7 w-7 rounded-lg ring-1 ring-white/10"
              />
              <span className="text-[11px] font-extrabold text-white">
                Lightning
              </span>
            </div>
            <PreviewNav icon={FileUp} label="Transfer" />
            <PreviewNav icon={MessageCircle} label="Lightning Chat" active />
            <PreviewNav icon={Radio} label="Nearby" />
            <div className="mt-6 border-t border-white/[0.06] pt-4">
              <p className="px-2 text-[8px] font-bold uppercase tracking-[0.2em] text-white/28">
                Network
              </p>
              <div className="mt-3 flex items-center gap-2 px-2 text-[9px] text-white/54">
                <span className="signal-dot !h-1.5 !w-1.5" />
                Direct ready
              </div>
            </div>
          </aside>
          <div className="grid min-w-0 grid-rows-[auto_1fr_auto]">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div>
                <p className="text-[13px] font-extrabold text-white">
                  Design crew
                </p>
                <p className="mt-0.5 text-[9px] text-white/38">
                  4 members · encrypted room
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-[color:var(--signal-green)]/20 bg-[color:var(--signal-green)]/8 px-2.5 py-1 text-[8px] font-bold uppercase tracking-[0.16em] text-[var(--signal-green)]">
                <ShieldCheck className="h-3 w-3" />
                Secure
              </div>
            </div>
            <div className="space-y-5 px-5 py-6">
              <PreviewMessage
                initials="MS"
                name="Maya"
                time="10:42"
                body="The launch files are ready. Sending the final package here."
              />
              <PreviewFile />
              <PreviewMessage
                initials="AK"
                name="Alex"
                time="10:43"
                body="Received and verified. The new build feels incredibly fast."
                accent
              />
              <div className="flex justify-center">
                <span className="rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-1 font-mono text-[8px] uppercase tracking-[0.18em] text-white/30">
                  messages continue when routes change
                </span>
              </div>
            </div>
            <div className="border-t border-white/[0.07] p-4">
              <div className="flex items-center gap-3 rounded-2xl border border-white/[0.09] bg-white/[0.04] px-4 py-3">
                <span className="flex-1 text-[11px] text-white/30">
                  Write an encrypted message…
                </span>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--signal-green)] text-[var(--text-ink)]">
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 left-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-[oklch(19%_0.018_162/0.96)] px-4 py-3 shadow-2xl backdrop-blur-xl sm:left-12">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[color:var(--signal-green)]/12 text-[var(--signal-green)]">
          <FileCheck2 className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[10px] font-bold text-white">Package verified</p>
          <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-white/34">
            BLAKE3 · 1.8 GB
          </p>
        </div>
      </div>
    </div>
  );
}

function PreviewNav({
  icon: Icon,
  label,
  active = false,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`mb-1 flex items-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-semibold ${
        active
          ? "bg-[color:var(--signal-green)]/10 text-[var(--signal-green)]"
          : "text-white/42"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}

function PreviewMessage({
  initials,
  name,
  time,
  body,
  accent = false,
}: {
  initials: string;
  name: string;
  time: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <div className={`flex gap-3 ${accent ? "flex-row-reverse" : ""}`}>
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[9px] font-extrabold ${
          accent
            ? "bg-[color:var(--signal-green)]/14 text-[var(--signal-green)]"
            : "bg-white/[0.07] text-white/64"
        }`}
      >
        {initials}
      </span>
      <div className={`max-w-[78%] ${accent ? "text-right" : ""}`}>
        <p className="text-[9px] font-bold text-white/54">
          {name} <span className="ml-1 font-normal text-white/24">{time}</span>
        </p>
        <p
          className={`mt-1.5 rounded-2xl px-3.5 py-2.5 text-left text-[11px] leading-[1.55] ${
            accent
              ? "rounded-tr-sm bg-[var(--signal-green)] text-[var(--text-ink)]"
              : "rounded-tl-sm border border-white/[0.07] bg-white/[0.04] text-white/76"
          }`}
        >
          {body}
        </p>
      </div>
    </div>
  );
}

function PreviewFile() {
  return (
    <div className="ml-11 flex max-w-[320px] items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color:var(--proof-amber)]/10 text-[var(--proof-amber)]">
        <FileUp className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-bold text-white">
          lightning-launch.zip
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <span className="block h-full w-full rounded-full bg-[var(--signal-green)]" />
        </div>
        <p className="mt-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-white/30">
          1.8 GB · complete
        </p>
      </div>
    </div>
  );
}

function ProductModeRail() {
  return (
    <div className="border-y border-white/[0.06] bg-black/10">
      <div className="mx-auto grid max-w-[1280px] divide-y divide-white/[0.06] px-6 sm:px-10 md:grid-cols-4 md:divide-x md:divide-y-0">
        <ModeFact icon={Zap} label="Transfer" value="Direct-first" />
        <ModeFact icon={MessageCircle} label="Chat" value="Nearby + relay" />
        <ModeFact icon={ShieldCheck} label="Integrity" value="Verified" />
        <ModeFact icon={CloudOff} label="Accounts" value="Not required" />
      </div>
    </div>
  );
}

function ModeFact({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 py-5 md:px-5">
      <Icon className="h-4 w-4 text-[var(--signal-green)]" />
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/28">
          {label}
        </p>
        <p className="mt-1 text-[12px] font-bold text-white/78">{value}</p>
      </div>
    </div>
  );
}

function ProductPillars() {
  return (
    <section
      id="lightning-chat"
      className="section-beam relative mx-auto max-w-[1280px] scroll-mt-24 px-6 py-24 sm:px-10 lg:py-32"
    >
      <div className="max-w-[760px]">
        <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-[var(--signal-green)]">
          Two tools. One private workspace.
        </p>
        <h2 className="font-display mt-4 text-balance text-[clamp(2.4rem,5vw,4.5rem)] font-extrabold leading-[0.98] tracking-[-0.035em] text-white">
          Your transfer app is now your communication layer.
        </h2>
        <p className="mt-5 max-w-[64ch] text-[16px] leading-[1.65] text-[var(--soft-copy)]">
          File transfer stays fast and purpose-built. Chat stays isolated from
          transfer state, with its own identity and transport choices. They
          share one polished desktop shell without tangling their security
          boundaries.
        </p>
      </div>
      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        <ProductPillar
          index="01"
          icon={FileUp}
          eyebrow="Lightning Transfer"
          title="Send huge files without the upload detour."
          description="Share a ticket or QR code and stream verified bytes directly to the receiver. Relay fallback helps peers connect; it does not become file storage."
          proof={transferProof}
          action={{ label: "Try browser transfer", href: "/send" }}
          tone="green"
        />
        <ProductPillar
          index="02"
          icon={MessageCircle}
          eyebrow="Lightning Chat"
          title="Stay connected when the network changes."
          description="Move between nearby direct conversations and internet relay rooms from the same inbox. Private messages are authenticated, encrypted, and separated from your file-transfer identity."
          proof={chatProof}
          action={{ label: "Open web chat", href: "/chat" }}
          tone="amber"
        />
      </div>
    </section>
  );
}

function ProductPillar({
  index,
  icon: Icon,
  eyebrow,
  title,
  description,
  proof,
  action,
  tone,
}: {
  index: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  proof: readonly string[];
  action: { label: string; href: string };
  tone: "green" | "amber";
}) {
  const accent =
    tone === "green" ? "var(--signal-green)" : "var(--proof-amber)";
  return (
    <article className="group relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-white/[0.035] p-7 transition duration-300 hover:-translate-y-1 hover:border-white/[0.14] sm:p-9">
      <div
        aria-hidden
        className="absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-10 blur-3xl transition-opacity duration-300 group-hover:opacity-20"
        style={{ background: accent }}
      />
      <div className="relative">
        <div className="flex items-start justify-between">
          <span
            className="grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.08]"
            style={{
              background: `color-mix(in oklch, ${accent} 12%, transparent)`,
              color: accent,
            }}
          >
            <Icon className="h-5 w-5" />
          </span>
          <span className="font-mono text-[10px] font-bold tracking-[0.2em] text-white/24">
            {index}
          </span>
        </div>
        <p
          className="mt-8 text-[11px] font-bold uppercase tracking-[0.24em]"
          style={{ color: accent }}
        >
          {eyebrow}
        </p>
        <h3 className="font-display mt-3 max-w-[18ch] text-[clamp(1.7rem,3vw,2.5rem)] font-extrabold leading-[1.04] tracking-[-0.025em] text-white">
          {title}
        </h3>
        <p className="mt-5 max-w-[58ch] text-[14.5px] leading-[1.7] text-[var(--soft-copy)]">
          {description}
        </p>
        <ul className="mt-7 space-y-3">
          {proof.map((item) => (
            <li
              key={item}
              className="flex items-start gap-3 text-[13px] text-white/72"
            >
              <BadgeCheck
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ color: accent }}
              />
              {item}
            </li>
          ))}
        </ul>
        <a
          href={action.href}
          className="mt-8 inline-flex items-center gap-2 text-[13px] font-extrabold text-white transition hover:gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          {action.label}
          <ArrowRight className="h-4 w-4" style={{ color: accent }} />
        </a>
      </div>
    </article>
  );
}

function DownloadDeck() {
  return (
    <section
      id="download"
      className="relative overflow-hidden bg-[var(--proof-paper)] text-[var(--text-ink)]"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-24 sm:px-10 lg:py-32">
        <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-[var(--signal-ink)]">
              Download the desktop app
            </p>
            <h2 className="font-display mt-4 text-balance text-[clamp(2.5rem,5.4vw,4.8rem)] font-extrabold leading-[0.96] tracking-[-0.04em]">
              The complete experience starts on Windows.
            </h2>
            <p className="mt-5 max-w-[52ch] text-[15.5px] leading-[1.7] text-[var(--paper-copy)]">
              Install Lightning P2P once and get high-speed transfer plus
              Lightning Chat in one native app. The community beta is unsigned,
              so Windows may show a publisher warning during installation.
            </p>
          </div>
          <div className="rounded-[30px] border border-[color:var(--border-light)] bg-white p-6 shadow-[0_28px_80px_oklch(19%_0.018_154/0.1)] sm:p-8">
            <div className="flex flex-col gap-7 sm:flex-row sm:items-center">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[20px] bg-[var(--text-ink)] text-[var(--signal-green)]">
                <MonitorDown className="h-7 w-7" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-[24px] font-extrabold">
                    Windows desktop
                  </h3>
                  <span className="rounded-full bg-[color:var(--signal-green)]/18 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.16em] text-[var(--signal-ink)]">
                    Recommended
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-[var(--paper-copy)]">
                  Windows 10/11 · x64 · beta {releaseManifest.currentAppVersion}
                </p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-[var(--paper-copy)]">
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-[var(--signal-ink)]" />
                    File transfer
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-[var(--signal-ink)]" />
                    Lightning Chat
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-[var(--signal-ink)]" />
                    Nearby discovery
                  </span>
                </div>
              </div>
              <a
                href={VELOPACK_DOWNLOAD_URL}
                className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--text-ink)] px-5 text-[13px] font-extrabold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-[var(--signal-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal-ink)]"
              >
                <Download className="h-4 w-4" />
                Download
              </a>
            </div>
          </div>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {secondaryDownloads.map(({ label, detail, href, icon: Icon }) => (
            <a
              key={label}
              href={href}
              className="group flex items-center gap-4 rounded-2xl border border-[color:var(--border-light)] bg-white/62 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-[color:var(--signal-ink)]/30 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal-ink)]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--text-ink)]/[0.06] text-[var(--text-ink)]">
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1">
                <span className="block text-[13px] font-extrabold">
                  {label}
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--paper-copy)]">
                  {detail}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 text-[var(--paper-copy)] transition-transform group-hover:translate-x-0.5" />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustBand() {
  const facts = [
    {
      icon: LockKeyhole,
      title: "Encrypted routes",
      body: "Transport security is built into direct file and chat connections.",
    },
    {
      icon: FileCheck2,
      title: "Verified content",
      body: "BLAKE3 checks received file content before it is trusted.",
    },
    {
      icon: Bluetooth,
      title: "Nearby aware",
      body: "Local discovery helps devices find one another without account lookup.",
    },
    {
      icon: WifiOff,
      title: "Resilient by design",
      body: "Direct and relay paths keep the experience useful across changing networks.",
    },
  ] satisfies Array<{ icon: LucideIcon; title: string; body: string }>;

  return (
    <section className="section-beam mx-auto max-w-[1280px] px-6 py-24 sm:px-10 lg:py-28">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(({ icon: Icon, title, body }) => (
          <article key={title} className="border-l border-white/[0.09] pl-5">
            <Icon className="h-5 w-5 text-[var(--signal-green)]" />
            <h3 className="font-display mt-5 text-[17px] font-extrabold text-white">
              {title}
            </h3>
            <p className="mt-2 text-[13px] leading-[1.65] text-[var(--soft-copy)]">
              {body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FinalCallToAction() {
  return (
    <section className="mx-auto max-w-[1280px] px-6 pb-24 sm:px-10 lg:pb-32">
      <div className="relative overflow-hidden rounded-[32px] border border-[color:var(--signal-green)]/18 bg-[color:var(--signal-green)]/[0.075] px-7 py-14 text-center sm:px-12 lg:py-20">
        <div
          aria-hidden
          className="absolute inset-0 cinematic-grid opacity-35"
        />
        <div className="relative mx-auto max-w-[820px]">
          <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-white/[0.09] bg-black/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/54">
            <Users className="h-3.5 w-3.5 text-[var(--signal-green)]" />
            Transfer together. Talk privately.
          </div>
          <h2 className="font-display mt-6 text-balance text-[clamp(2.4rem,5.5vw,4.6rem)] font-extrabold leading-[0.96] tracking-[-0.04em] text-white">
            Put files and conversation back in your hands.
          </h2>
          <p className="mx-auto mt-5 max-w-[58ch] text-[15px] leading-[1.7] text-[var(--soft-copy)]">
            Download the native app for the full Lightning P2P and Lightning
            Chat experience, or inspect every part of the implementation on
            GitHub.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href={VELOPACK_DOWNLOAD_URL}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--signal-green)] px-6 text-[13px] font-extrabold text-[var(--text-ink)] transition duration-200 hover:-translate-y-0.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              <Download className="h-4 w-4" />
              Download for Windows
            </a>
            <a
              href={REPO_URL}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-6 text-[13px] font-extrabold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              <GitBranch className="h-4 w-4" />
              View source
            </a>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] text-white/38">
            <span className="inline-flex items-center gap-1.5">
              <Globe2 className="h-3.5 w-3.5" />
              Internet capable
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5" />
              Nearby capable
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Open source
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
