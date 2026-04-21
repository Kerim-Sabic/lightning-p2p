import { ClipboardCheck, LinkIcon, Upload } from "lucide-react";

const steps = [
  {
    icon: Upload,
    title: "Drop files",
    body: "Drag one or more files (or a folder) into the Lightning P2P sender. Files stay on your disk.",
  },
  {
    icon: LinkIcon,
    title: "Share the receive link",
    body: "Copy the web handoff link, show the QR code, or copy the raw ticket fallback. No account, no upload.",
  },
  {
    icon: ClipboardCheck,
    title: "Receive directly",
    body: "The receiver opens the link or pastes the ticket. Files stream peer-to-peer over QUIC, verified with BLAKE3.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative overflow-hidden bg-[#08120f] px-4 py-20 sm:px-6"
    >
      <div className="pointer-events-none absolute inset-0 opacity-40 [background:radial-gradient(1100px_circle_at_50%_0%,rgba(16,185,129,0.12),transparent_60%)]" />
      <div className="relative mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
            How it works
          </p>
          <h2 className="mt-4 text-4xl font-semibold leading-tight text-white">
            Three steps. No cloud round trip.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Lightning P2P is peer-to-peer the whole way. The sender keeps the
            file, the receiver pulls it directly, and the relay only helps if
            the direct path is blocked.
          </p>
        </div>
        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="group relative overflow-hidden rounded-[12px] border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm transition-colors hover:border-emerald-300/30 hover:bg-white/[0.05]"
            >
              <span
                aria-hidden="true"
                className="absolute right-5 top-5 text-6xl font-semibold leading-none text-white/[0.06]"
              >
                {index + 1}
              </span>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-emerald-300/10 text-emerald-200 ring-1 ring-inset ring-emerald-300/20">
                <step.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-white">
                {step.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
