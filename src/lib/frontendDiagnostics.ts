import { recordFrontendDiagnostic } from "./tauri";
import { redactSensitiveText } from "./appErrors";

let installed = false;

export function installFrontendDiagnostics(): void {
  if (installed) {
    return;
  }
  installed = true;

  window.addEventListener("error", (event) => {
    recordFrontendDiagnostic(describeErrorEvent(event));
  });

  window.addEventListener("unhandledrejection", (event) => {
    recordFrontendDiagnostic(
      `Unhandled promise rejection\n${describeUnknown(event.reason)}`,
    );
  });
}

function describeErrorEvent(event: ErrorEvent): string {
  const location = [event.filename, event.lineno, event.colno]
    .filter((part) => part !== undefined && part !== null && part !== "")
    .join(":");
  return redactSensitiveText([
    "Frontend error",
    event.message,
    location ? `Location: ${location}` : null,
    event.error ? describeUnknown(event.error) : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n"));
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) {
    return redactSensitiveText([value.name, value.message, value.stack]
      .filter((line): line is string => Boolean(line))
      .join("\n"));
  }

  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  try {
    const json = JSON.stringify(value);
    return redactSensitiveText(json ?? String(value));
  } catch {
    return redactSensitiveText(String(value));
  }
}
