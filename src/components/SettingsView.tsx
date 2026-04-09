import { Fingerprint, HardDriveDownload, ShieldCheck, Sparkles } from "lucide-react";
import { useTransferStore } from "../stores/transferStore";

function statusPill(online: boolean): string {
  return online
    ? "border-emerald-400/20 bg-emerald-500/12 text-emerald-200"
    : "border-white/10 bg-white/5 text-slate-300";
}

export function SettingsView() {
  const downloadDir = useTransferStore((state) => state.downloadDir);
  const nodeStatus = useTransferStore((state) => state.nodeStatus);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] uppercase tracking-[0.32em] text-slate-400">
          <Sparkles className="h-3.5 w-3.5 text-sky-300" />
          Settings
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Node and device details
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-400">
            FastDrop stays dark-mode-first and local-first. This view surfaces the
            active iroh node identity and the current save location without adding
            extra workflow friction.
          </p>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="glass-panel p-6">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <Fingerprint className="h-5 w-5 text-sky-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Node identity</p>
              <p className="text-xs text-slate-400">
                The node id shown here is what peers connect to.
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <span
              className={`rounded-full border px-3 py-1 text-xs ${statusPill(nodeStatus.online)}`}
            >
              {nodeStatus.online ? "Online" : "Starting"}
            </span>
            <span className="text-xs text-slate-500">
              {nodeStatus.online ? "Ready to send and receive" : "Waiting for iroh"}
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="mb-2 text-[11px] uppercase tracking-[0.28em] text-slate-500">
              NodeId
            </p>
            <p className="break-all font-mono text-sm text-slate-200">
              {nodeStatus.node_id ?? "Initializing node..."}
            </p>
          </div>
        </article>

        <article className="glass-panel p-6">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <HardDriveDownload className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Download directory</p>
              <p className="text-xs text-slate-400">
                Incoming transfers land here after verification and export.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="mb-2 text-[11px] uppercase tracking-[0.28em] text-slate-500">
              Save location
            </p>
            <p className="break-all font-mono text-sm text-slate-200">
              {downloadDir ?? "Resolving download directory..."}
            </p>
          </div>
        </article>
      </section>

      <article className="glass-panel p-6">
        <div className="flex items-center gap-3">
          <div className="glass-icon">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Transfer guarantees</p>
            <p className="text-xs text-slate-400">
              Verified iroh-blobs transfers, persistent history, and direct peer
              connectivity with relay fallback.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="glass-subtle p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Network</p>
            <p className="mt-2 text-sm text-slate-200">iroh QUIC transport only</p>
          </div>
          <div className="glass-subtle p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Integrity</p>
            <p className="mt-2 text-sm text-slate-200">BLAKE3-verified blob streaming</p>
          </div>
          <div className="glass-subtle p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Storage</p>
            <p className="mt-2 text-sm text-slate-200">Local history and peer cache</p>
          </div>
        </div>
      </article>
    </div>
  );
}
