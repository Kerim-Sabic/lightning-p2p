export const SITE_URL = "https://lightning-p2p.netlify.app";
export const REPO_URL = "https://github.com/Kerim-Sabic/lightning-p2p";
export const RELEASE_URL = `${REPO_URL}/releases/latest`;
export const STABLE_RELEASE_TAG = "v0.4.6";
export const EXPERIMENTAL_RELEASE_TAG = "v0.7.0";
export const EXPERIMENTAL_RELEASE_URL = `${REPO_URL}/releases/tag/${EXPERIMENTAL_RELEASE_TAG}`;
export const DEEP_LINK_SCHEME = "lightning-p2p";
export const RECEIVE_PATH = "/receive";
export const VELOPACK_DOWNLOAD_URL = `${RELEASE_URL}/download/LightningP2P-win-Setup.exe`;
export const NSIS_DOWNLOAD_URL = `${RELEASE_URL}/download/LightningP2PSetup.exe`;
export const MSI_DOWNLOAD_URL = `${RELEASE_URL}/download/LightningP2P.msi`;
/**
 * Last release tag that actually shipped Android artifacts. Community
 * (unsigned) Windows releases skip the Android job, so `/releases/latest`
 * would 404 for the APK; pin to the newest APK-bearing tag instead and bump
 * this constant whenever a new signed Android release lands.
 */
export const LAST_ANDROID_RELEASE_TAG = "v0.5.1";
export const ANDROID_APK_DOWNLOAD_URL = `${REPO_URL}/releases/download/${LAST_ANDROID_RELEASE_TAG}/LightningP2P-android-latest.apk`;
export const ANDROID_CHECKSUMS_URL = `${REPO_URL}/releases/download/${LAST_ANDROID_RELEASE_TAG}/SHA256SUMS-android.txt`;

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
