import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

interface MobileBottomSheetProps {
  open: boolean;
  title: string;
  onDismiss: () => void;
  children: ReactNode;
  /** Optional subtitle rendered under the title. */
  subtitle?: string;
}

/**
 * Native-feeling bottom sheet for mobile: backdrop + slide-up panel with a
 * grabber and a close affordance. Closes on Escape, backdrop tap, or the
 * close button. Body scroll is locked while open.
 */
export function MobileBottomSheet({
  open,
  title,
  onDismiss,
  children,
  subtitle,
}: MobileBottomSheetProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onDismiss, open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="bottom-sheet-backdrop"
        onClick={onDismiss}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bottom-sheet-panel"
      >
        <div className="bottom-sheet-grabber" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3 pb-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-white">{title}</p>
            {subtitle ? (
              <p className="mt-0.5 text-[13px] text-slate-300/72">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="min-h-touch min-w-touch -mr-1 flex items-center justify-center rounded-full text-slate-300 hover:bg-white/5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </>
  );
}
