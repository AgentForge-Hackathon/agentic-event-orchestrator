import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { EventSchema, type Event } from '../../types/index.js';
import { normalizeUrl } from './utils/url.js';
import {
  normalizeText,
  similarity,
  hasTimeOverlap,
  scoreEventCompleteness,
  NAME_SIMILARITY_THRESHOLD,
} from './utils/similarity.js';

/** URL-based exact match (same source URL = definitely duplicate). */
function hasSameUrl(a: Event, b: Event): boolean {
  if (!a.sourceUrl || !b.sourceUrl) return false;
  return normalizeUrl(a.sourceUrl) === normalizeUrl(b.sourceUrl);
}

/**
 * Deduplicate Events Tool
 *
 * Merges events from multiple sources, removing duplicates.
 * Strategy:
 *   1. Exact URL match → definite duplicate
 *   2. Similar normalized name (>75%) + overlapping time → likely duplicate
 *   3. When duplicates found, keep the event with more data (price, rating, etc.)
 */
export const deduplicateEventsTool = createTool({
  id: 'deduplicate-events',
  description:
    'Deduplicates events from multiple sources by matching on name, URL, and time overlap. Returns a merged list with duplicates removed.',
  inputSchema: z.object({
    events: z.array(EventSchema).describe('Array of events from multiple sources to deduplicate'),
  }),
  outputSchema: z.object({
    events: z.array(EventSchema),
    originalCount: z.number(),
    deduplicatedCount: z.number(),
    removedCount: z.number(),
  }),
  execute: async ({ events }) => {
    const originalCount = events.length;

    if (originalCount <= 1) {
      return {
        events,
        originalCount,
        deduplicatedCount: originalCount,
        removedCount: 0,
      };
    }

    console.log(`[dedup] Deduplicating ${originalCount} events`);

    const merged = new Set<number>();
    const result: Event[] = [];

    for (let i = 0; i < events.length; i++) {
      if (merged.has(i)) continue;

      let best = events[i];

      for (let j = i + 1; j < events.length; j++) {
        if (merged.has(j)) continue;

        const candidate = events[j];
        const isDuplicate =
          hasSameUrl(best, candidate) ||
          (similarity(normalizeText(best.name), normalizeText(candidate.name)) >= NAME_SIMILARITY_THRESHOLD
            && hasTimeOverlap(best, candidate));

        if (isDuplicate) {
          console.log(`[dedup]   Duplicate found: "${candidate.name}" (${candidate.source}) ≈ "${best.name}" (${best.source})`);
          merged.add(j);

          if (scoreEventCompleteness(candidate) > scoreEventCompleteness(best)) {
            best = candidate;
          }
        }
      }

      result.push(best);
    }

    const removedCount = originalCount - result.length;
    console.log(`[dedup] Deduplication complete: ${originalCount} → ${result.length} (${removedCount} duplicates removed)`);

    return {
      events: result,
      originalCount,
      deduplicatedCount: result.length,
      removedCount,
    };
  },
});
