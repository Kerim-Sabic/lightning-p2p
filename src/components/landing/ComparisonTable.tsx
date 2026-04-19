import { Check, Minus, X } from "lucide-react";

type Cell = "yes" | "no" | "partial";

interface Row {
  tool: string;
  note: string;
  directP2p: Cell;
  verifiedBytes: Cell;
  noAccount: Cell;
  wan: Cell;
  noSizeCap: Cell;
  openSource: Cell;
}

const rows: Row[] = [
  {
    tool: "Lightning P2P",
    note: "Windows desktop",
    directP2p: "yes",
    verifiedBytes: "yes",
    noAccount: "yes",
    wan: "yes",
    noSizeCap: "yes",
    openSource: "yes",
  },
  {
    tool: "LocalSend",
    note: "Cross-platform LAN",
    directP2p: "yes",
    verifiedBytes: "partial",
    noAccount: "yes",
    wan: "no",
    noSizeCap: "yes",
    openSource: "yes",
  },
  {
    tool: "PairDrop",
    note: "Browser WebRTC",
    directP2p: "yes",
    verifiedBytes: "partial",
    noAccount: "yes",
    wan: "partial",
    noSizeCap: "yes",
    openSource: "yes",
  },
  {
    tool: "Snapdrop",
    note: "Browser LAN",
    directP2p: "yes",
    verifiedBytes: "no",
    noAccount: "yes",
    wan: "no",
    noSizeCap: "yes",
    openSource: "yes",
  },
  {
    tool: "Magic Wormhole",
    note: "CLI direct transfer",
    directP2p: "yes",
    verifiedBytes: "yes",
    noAccount: "yes",
    wan: "yes",
    noSizeCap: "yes",
    openSource: "yes",
  },
  {
    tool: "WeTransfer",
    note: "Cloud upload link",
    directP2p: "no",
    verifiedBytes: "no",
    noAccount: "partial",
    wan: "yes",
    noSizeCap: "no",
    openSource: "no",
  },
];

const columns: Array<{ key: keyof Row; label: string }> = [
  { key: "directP2p", label: "Direct P2P" },
  { key: "verifiedBytes", label: "Verified bytes" },
  { key: "noAccount", label: "No account" },
  { key: "wan", label: "WAN support" },
  { key: "noSizeCap", label: "No size cap" },
  { key: "openSource", label: "Open source" },
];

function Indicator({ value }: { value: Cell }) {
  if (value === "yes") {
    return (
      <span className="inline-flex items-center justify-center text-emerald-300">
        <Check className="h-4 w-4" aria-label="Yes" />
      </span>
    );
  }
  if (value === "partial") {
    return (
      <span className="inline-flex items-center justify-center text-amber-300">
        <Minus className="h-4 w-4" aria-label="Partial" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center text-slate-500">
      <X className="h-4 w-4" aria-label="No" />
    </span>
  );
}

export function ComparisonTable() {
  return (
    <section
      id="comparison"
      className="bg-[#0a1511] px-4 py-20 sm:px-6"
      aria-labelledby="comparison-heading"
    >
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
            Comparison
          </p>
          <h2
            id="comparison-heading"
            className="mt-4 text-4xl font-semibold leading-tight text-white"
          >
            How Lightning P2P compares.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            Honest side-by-side with tools people ask about most. See the{" "}
            <a
              href="/benchmarks"
              className="text-emerald-200 underline-offset-4 hover:underline"
            >
              benchmark methodology
            </a>{" "}
            for how we plan to publish repeatable speed numbers against these
            tools.
          </p>
        </div>

        <div className="mt-10 overflow-x-auto rounded-[12px] border border-white/10 bg-white/[0.02]">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="px-5 py-4 font-semibold text-white">Tool</th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="px-5 py-4 text-center font-semibold text-white"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.tool}
                  className={`border-t border-white/5 ${
                    index === 0
                      ? "bg-emerald-300/[0.04]"
                      : "odd:bg-white/[0.015]"
                  }`}
                >
                  <th
                    scope="row"
                    className="px-5 py-4 align-top text-left font-normal"
                  >
                    <span
                      className={`block font-semibold ${
                        index === 0 ? "text-emerald-200" : "text-white"
                      }`}
                    >
                      {row.tool}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {row.note}
                    </span>
                  </th>
                  {columns.map((col) => (
                    <td key={col.key} className="px-5 py-4 text-center">
                      <Indicator value={row[col.key] as Cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          <Check className="mr-1 inline h-3 w-3 text-emerald-300" /> yes
          <span className="mx-2 text-slate-700">/</span>
          <Minus className="mr-1 inline h-3 w-3 text-amber-300" /> partial
          <span className="mx-2 text-slate-700">/</span>
          <X className="mr-1 inline h-3 w-3 text-slate-500" /> no
        </p>
      </div>
    </section>
  );
}
