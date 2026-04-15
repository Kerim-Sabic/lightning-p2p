import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Info, X, XCircle } from "lucide-react";

interface InlineAlertProps {
  message: string | null;
  onDismiss: () => void;
}

type AlertTone = "info" | "warning" | "error";

function toneForMessage(message: string): AlertTone {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("browser preview") ||
    normalized.includes("desktop app runtime") ||
    normalized.includes("native desktop app runtime")
  ) {
    return "info";
  }

  if (
    normalized.includes("failed") ||
    normalized.includes("invalid") ||
    normalized.includes("unreachable") ||
    normalized.includes("cancelled") ||
    normalized.includes("cannot") ||
    normalized.includes("timed out")
  ) {
    return "error";
  }

  if (
    normalized.includes("waiting") ||
    normalized.includes("starting") ||
    normalized.includes("not ready") ||
    normalized.includes("pending") ||
    normalized.includes("initializ")
  ) {
    return "info";
  }

  return "warning";
}

function alertPresentation(tone: AlertTone) {
  switch (tone) {
    case "error":
      return {
        title: "Action needed",
        panelClass: "border-rose-400/20 bg-rose-500/10 text-rose-100/90",
        iconWrapClass: "border-rose-400/15 bg-rose-500/10 text-rose-100",
        buttonClass: "text-rose-100",
        Icon: XCircle,
      };
    case "warning":
      return {
        title: "Heads up",
        panelClass: "border-amber-400/20 bg-amber-500/10 text-amber-100/90",
        iconWrapClass: "border-amber-400/15 bg-amber-500/10 text-amber-100",
        buttonClass: "text-amber-100",
        Icon: AlertTriangle,
      };
    case "info":
    default:
      return {
        title: "Status update",
        panelClass: "border-sky-400/20 bg-sky-500/10 text-sky-100/90",
        iconWrapClass: "border-sky-400/15 bg-sky-500/10 text-sky-100",
        buttonClass: "text-sky-100",
        Icon: Info,
      };
  }
}

export function InlineAlert({ message, onDismiss }: InlineAlertProps) {
  return (
    <AnimatePresence initial={false}>
      {message ? (
        <InlineAlertBody message={message} onDismiss={onDismiss} />
      ) : null}
    </AnimatePresence>
  );
}

function InlineAlertBody({ message, onDismiss }: InlineAlertProps) {
  if (!message) {
    return null;
  }

  const tone = toneForMessage(message);
  const presentation = alertPresentation(tone);
  const { Icon } = presentation;

  return (
    <motion.section
      key={message}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`glass-panel flex items-start justify-between gap-4 px-4 py-3 ${presentation.panelClass}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div
          className={`glass-icon h-10 w-10 rounded-2xl ${presentation.iconWrapClass}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            {presentation.title}
          </p>
          <p className="mt-1 text-sm leading-6">{message}</p>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className={`glass-button inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${presentation.buttonClass}`}
        aria-label="Dismiss alert"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.section>
  );
}
