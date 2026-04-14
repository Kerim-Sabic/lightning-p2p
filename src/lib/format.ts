export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatSpeed(speedBps: number): string {
  if (speedBps <= 0) {
    return "-- MB/s";
  }
  if (speedBps >= 1024 ** 3) {
    return `${(speedBps / 1024 ** 3).toFixed(2)} GB/s`;
  }
  if (speedBps >= 1024 ** 2) {
    return `${(speedBps / 1024 ** 2).toFixed(1)} MB/s`;
  }
  return `${(speedBps / 1024).toFixed(0)} KB/s`;
}

export function formatEta(
  bytes: number,
  total: number,
  speedBps: number,
): string {
  if (total <= bytes || speedBps <= 0) {
    return "--";
  }

  const remainingSeconds = Math.ceil((total - bytes) / speedBps);
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatTimestamp(timestamp: number | null): string | null {
  if (!timestamp) {
    return null;
  }
  return new Date(timestamp * 1000).toLocaleString();
}

export function formatDurationMs(durationMs: number): string {
  if (durationMs <= 0) {
    return "--";
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainderSeconds}s`;
}

export function isProbablyBlobTicket(ticket: string): boolean {
  const value = ticket.trim();
  return /^blob[a-z0-9]+$/i.test(value) && value.length > 24;
}
