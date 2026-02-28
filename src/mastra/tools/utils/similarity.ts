import type { Event } from '../../../types/index.js';

/** Normalize a string for fuzzy comparison: lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Simple similarity ratio between two strings (0..1).
 * Uses longest-common-subsequence length / max length.
 * Fast enough for <100 events — no need for Levenshtein.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const lenA = a.length;
  const lenB = b.length;

  // LCS via two-row DP (O(n*m) time, O(min(n,m)) space)
  const prev = new Array(lenB + 1).fill(0);
  const curr = new Array(lenB + 1).fill(0);

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    // Copy curr to prev
    for (let j = 0; j <= lenB; j++) {
      prev[j] = curr[j];
      curr[j] = 0;
    }
  }

  const lcsLen = prev[lenB];
  return lcsLen / Math.max(lenA, lenB);
}

/** Check if two events overlap in time (same day + overlapping time windows). */
export function hasTimeOverlap(a: Event, b: Event): boolean {
  const aStart = new Date(a.timeSlot.start).getTime();
  const aEnd = new Date(a.timeSlot.end).getTime();
  const bStart = new Date(b.timeSlot.start).getTime();
  const bEnd = new Date(b.timeSlot.end).getTime();

  return aStart < bEnd && bStart < aEnd;
}

/** Name similarity threshold to consider two events as potential duplicates. */
export const NAME_SIMILARITY_THRESHOLD = 0.75;

/**
 * Score an event's data completeness for dedup "best version" selection.
 * Higher score = more data (price, rating, image, description).
 */
export function scoreEventCompleteness(e: Event): number {
  let s = 0;
  if (e.price) s += 2;
  if (e.rating != null) s += 2;
  if (e.imageUrl) s += 1;
  if (e.reviewCount && e.reviewCount > 0) s += 1;
  if (e.description.length > 50) s += 1;
  return s;
}
