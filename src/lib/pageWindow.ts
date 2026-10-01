export interface PageWindow {
  pageIndex: number;
  pageCount: number;
  start: number;
  end: number;
}

/** Computes a clamped zero-based page range for bounded list rendering. */
export function pageWindow(
  itemCount: number,
  requestedPage: number,
  pageSize: number,
): PageWindow {
  const total = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 1;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const requested = Number.isFinite(requestedPage)
    ? Math.max(0, Math.floor(requestedPage))
    : 0;
  const pageIndex = Math.min(requested, pageCount - 1);
  const start = pageIndex * size;

  return {
    pageIndex,
    pageCount,
    start,
    end: Math.min(total, start + size),
  };
}
