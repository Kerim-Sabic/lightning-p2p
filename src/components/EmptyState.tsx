import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  copy: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  copy,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center gap-4 rounded-[24px] border border-white/8 bg-white/[0.02] px-6 py-10 text-center ${className}`}
    >
      <div className="relative">
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-sky-500/10 blur-2xl"
        />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
          <Icon className="h-6 w-6 text-sky-200" />
        </div>
      </div>
      <div className="max-w-sm space-y-2">
        <p className="text-base font-medium text-white">{title}</p>
        <p className="text-[13px] leading-6 text-slate-300/72">{copy}</p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
