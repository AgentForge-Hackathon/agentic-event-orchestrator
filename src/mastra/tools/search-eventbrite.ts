import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { EventCategorySchema } from '../../types/index.js';
import type { Event, EventCategory } from '../../types/index.js';

import { resolveEndDate } from './utils/date-range.js';
import { buildSearchResult } from './utils/event-filters.js';
import { getEventbriteDemoEvents } from './utils/demo-data.js';
import { CATEGORY_TO_EVENTBRITE_KEYWORD } from './utils/category.js';
import { type BrightDataConfig, fetchViaBrightData } from './utils/http.js';
import { extractServerData, extractEventPageDetails } from './utils/html-parser.js';
import { mapToEvent } from './utils/eventbrite-mapper.js';
import { deduplicateByUrl } from './utils/url.js';
import type { EventbriteJsonLdEvent } from './utils/eventbrite-types.js';

// ============================================
// Eventbrite URL Builder
// ============================================

function buildEventbriteUrl(_date: string, categories?: EventCategory[]): string {
  const baseUrl = 'https://www.eventbrite.sg/d/singapore--singapore';

  // Eventbrite only supports one category keyword in the URL path
  let keyword = 'events';
  if (categories?.length) {
    for (const cat of categories) {
      const ebKeyword = CATEGORY_TO_EVENTBRITE_KEYWORD[cat];
      if (ebKeyword) {
        keyword = `${ebKeyword}--events`;
        break;
      }
    }
  }

  return `${baseUrl}/${keyword}/`;
}

// ============================================
// Event Detail Enrichment
// ============================================

async function enrichEventsWithDetails(
  events: EventbriteJsonLdEvent[],
  config: BrightDataConfig,
  concurrency = 5,
): Promise<EventbriteJsonLdEvent[]> {
  const uniqueEvents = deduplicateByUrl(events);

  const enriched = [...uniqueEvents];
  const urlsToFetch = uniqueEvents
    .map((e, i) => ({ url: e.url, index: i }))
    .filter((item): item is { url: string; index: number } => !!item.url);

  if (urlsToFetch.length === 0) return enriched;

  console.log(`[eventbrite] Enriching ${urlsToFetch.length} events (concurrency=${concurrency})`);

  for (let i = 0; i < urlsToFetch.length; i += concurrency) {
    const batch = urlsToFetch.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async ({ url, index }) => {
        try {
          const html = await fetchViaBrightData(url, config);
          const details = extractEventPageDetails(html, url);
          if (details) {
            return { index, details };
          }
          return null;
        } catch {
          return null;
        }
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { index, details } = result.value;
        const original = enriched[index];
        enriched[index] = {
          ...original,
          startDate: details.startDate ?? original.startDate,
          endDate: details.endDate ?? original.endDate,
          offers: details.offers ?? original.offers,
          location: details.location ?? original.location,
          description: details.description ?? original.description,
        };
      }
    }
  }

  const enrichedCount = enriched.filter((e, idx) => {
    const original = uniqueEvents[idx];
    return e.startDate !== original.startDate || e.offers !== original.offers;
  }).length;
  console.log(`[eventbrite] Enriched ${enrichedCount}/${urlsToFetch.length} events`);

  return enriched;
}

// ============================================
// Tool Definition
// ============================================

export const searchEventbriteTool = createTool({
  id: 'search-eventbrite',
  description:
    'Searches Eventbrite Singapore for events within a date range. Accepts a start date and optional end date (defaults to +3 days). Fetches individual event pages to extract accurate start/end times and ticket prices. Returns structured event data with pricing, ratings, and availability. Falls back to demo data when Bright Data API key is not configured.',
  inputSchema: z.object({
    date: z.string().describe('Start date in YYYY-MM-DD format'),
    dateEnd: z.string().optional().describe('End date in YYYY-MM-DD format (defaults to date + 3 days)'),
    categories: z.array(EventCategorySchema).optional().describe('Event categories to search for'),
    budgetMax: z.number().optional().describe('Maximum budget per person in SGD'),
    areas: z.array(z.string()).optional().describe('Singapore areas to search in'),
    maxResults: z.number().optional().default(20).describe('Maximum number of results to return'),
  }),
  outputSchema: z.object({
    events: z.array(z.any()),
    source: z.string(),
    searchDuration: z.number(),
    mode: z.enum(['live', 'demo']),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const startTime = Date.now();
    const input = inputData;

    const apiKey = process.env.BRIGHT_DATA_API_KEY;
    const zone = process.env.BRIGHT_DATA_ZONE;

    if (!apiKey) {
      console.log('[eventbrite] No API key — using demo data');
      return buildSearchResult(
        getEventbriteDemoEvents(input.date),
        'eventbrite', startTime, 'demo',
        { budgetMax: input.budgetMax, maxResults: input.maxResults, removeSoldOut: true },
      );
    }

    try {
      const config: BrightDataConfig = { apiKey, zone };
      const targetUrl = buildEventbriteUrl(input.date, input.categories);

      console.log(`[eventbrite] Fetching ${targetUrl}`);
      const html = await fetchViaBrightData(targetUrl, config);

      const rawEvents = extractServerData(html);

      const rangeStart = input.date;
      const rangeEnd = resolveEndDate(input.date, input.dateEnd);

      const inRangeRaw = rawEvents.filter((e) => {
        if (!e.startDate) return true;
        const eventDate = e.startDate.split('T')[0];
        return eventDate >= rangeStart && eventDate <= rangeEnd;
      });

      console.log(`[eventbrite] Parsed ${rawEvents.length} raw → ${inRangeRaw.length} in date range ${rangeStart}→${rangeEnd}`);
      const toEnrich = inRangeRaw.slice(0, input.maxResults ?? 20);
      const enrichedRaw = await enrichEventsWithDetails(toEnrich, config, 5);

      const events: Event[] = enrichedRaw
        .map(mapToEvent)
        .filter((e): e is Event => e !== null);

      return buildSearchResult(
        events, 'eventbrite', startTime, 'live',
        { budgetMax: input.budgetMax, maxResults: input.maxResults, removeSoldOut: true },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[eventbrite] Error: ${errorMessage}`);
      return buildSearchResult(
        getEventbriteDemoEvents(input.date),
        'eventbrite', startTime, 'demo',
        { maxResults: input.maxResults, error: errorMessage },
      );
    }
  },
});
