import { extractBlobTicket } from "./format";
import { DEEP_LINK_SCHEME, RECEIVE_PATH, SITE_URL } from "./shareLinks";

const DUPLICATE_DELIVERY_WINDOW_MS = 1500;

export function extractTicketFromDeepLink(url: string): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) {
    const siteUrl = new URL(SITE_URL);
    const normalizedPath = parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    const webReceiveLink =
      parsed.protocol === siteUrl.protocol &&
      parsed.hostname === siteUrl.hostname &&
      normalizedPath === RECEIVE_PATH;
    if (!webReceiveLink) return null;
  }

  return extractBlobTicket(url);
}

/** Handles both the startup URL snapshot and URLs delivered while the app runs. */
export function createDeepLinkHandler(
  callback: (ticket: string) => void,
): (urls: readonly string[] | null) => void {
  const recentTickets = new Map<string, number>();

  return (urls) => {
    const now = Date.now();
    for (const [ticket, expiresAt] of recentTickets) {
      if (expiresAt <= now) recentTickets.delete(ticket);
    }

    for (const url of urls ?? []) {
      const ticket = extractTicketFromDeepLink(url);
      if (!ticket) continue;
      const expiresAt = recentTickets.get(ticket);
      if (expiresAt !== undefined && expiresAt > now) return;

      recentTickets.set(ticket, now + DUPLICATE_DELIVERY_WINDOW_MS);
      callback(ticket);
      return;
    }
  };
}
