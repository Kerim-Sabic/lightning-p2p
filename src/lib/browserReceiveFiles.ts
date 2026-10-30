/** Returns an identity for one collection entry, even when content is shared. */
export function browserReceiveFileKey(hash: string, index: number): string {
  return `${index}:${hash}`;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[<>:"|?*\u0000-\u001f]/g;
const MAX_SEGMENT_LENGTH = 200;

/**
 * Splits a sender-supplied collection path into folder and file names that
 * are safe to create inside the folder the user picked. Names come from the
 * BLAKE3-verified manifest but are still chosen by the sender, so traversal
 * (`..`), absolute paths, reserved device names, and characters Windows or
 * macOS reject are neutralised instead of trusted.
 */
export function safeRelativeSegments(name: string): string[] {
  const segments = name
    .split(/[\\/]+/)
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("The shared file list contains an unsafe path.");
  }
  const safe = segments.map(safeSegment);
  return safe.length > 0 ? safe : ["download"];
}

function safeSegment(segment: string): string {
  let safe = segment
    .normalize("NFC")
    .replace(UNSAFE_CHARACTERS, "_")
    .replace(/[. ]+$/u, "")
    .slice(0, MAX_SEGMENT_LENGTH);
  if (safe === "" || /^\.+$/u.test(safe)) safe = "_";
  if (WINDOWS_RESERVED.test(safe)) safe = `_${safe}`;
  return safe;
}

/**
 * Returns the name to try for a file on the given attempt without ever
 * overwriting: `report.pdf`, then `report (1).pdf`, `report (2).pdf`, …
 */
export function numberedFileName(name: string, attempt: number): string {
  if (attempt <= 0) return name;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name} (${attempt})`;
  return `${name.slice(0, dot)} (${attempt})${name.slice(dot)}`;
}
