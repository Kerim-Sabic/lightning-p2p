import { recordFrontendDiagnostic } from "./tauri";

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
  return [
    "Frontend error",
    event.message,
    location ? `Location: ${location}` : null,
    event.error ? describeUnknown(event.error) : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) {
    return [value.name, value.message, value.stack]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    const json = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}
