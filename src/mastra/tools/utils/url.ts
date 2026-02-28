/**
 * Normalize a URL for comparison: strip query params, trailing slashes, lowercase.
 */
export function normalizeUrl(url: string): string {
  return url.split('?')[0].replace(/\/+$/, '').toLowerCase();
}

/**
 * Deduplicate an array of objects by their `url` field (normalized).
 * Items without a url are kept.
 */
export function deduplicateByUrl<T extends { url?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.url) return true;
    const normalized = normalizeUrl(item.url);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
