export const SITE_URL = "https://lightning-p2p.netlify.app";
export const REPO_URL = "https://github.com/Kerim-Sabic/lightning-p2p";
export const RELEASE_URL = `${REPO_URL}/releases/latest`;
export const DEEP_LINK_SCHEME = "lightning-p2p";
export const RECEIVE_PATH = "/receive";
export const VELOPACK_DOWNLOAD_URL = `${RELEASE_URL}/download/LightningP2P-win-Setup.exe`;

export function versionedNsisDownloadUrl(version: string): string {
  return `${RELEASE_URL}/download/Lightning.P2P_${version}_x64-setup.exe`;
}

export function versionedMsiDownloadUrl(version: string): string {
  return `${RELEASE_URL}/download/Lightning.P2P_${version}_x64_en-US.msi`;
}

export function canonicalWebPath(path: string): string {
  if (path === "/") {
    return "/";
  }

  return path.endsWith("/") ? path.slice(0, -1) : path;
}

export function canonicalWebUrl(path: string): string {
  const canonicalPath = canonicalWebPath(path);
  return canonicalPath === "/" ? `${SITE_URL}/` : `${SITE_URL}${canonicalPath}`;
}

export function createReceiveHandoffLink(ticket: string): string {
  return `${SITE_URL}${RECEIVE_PATH}#t=${encodeURIComponent(ticket)}`;
}

export function createDeepReceiveLink(ticket: string): string {
  return `${DEEP_LINK_SCHEME}://receive?t=${encodeURIComponent(ticket)}`;
}

export function ticketFromReceiveFragment(fragment: string): string | null {
  const value = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!value) {
    return null;
  }

  const params = new URLSearchParams(value);
  const ticket = params.get("t") ?? params.get("ticket");
  return ticket?.trim() || null;
}
