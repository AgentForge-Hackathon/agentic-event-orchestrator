import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { EventCategorySchema } from '../../types/index.js';
import type { Event, EventCategory } from '../../types/index.js';

import { resolveEndDate } from './utils/date-range.js';
import { buildSearchResult } from './utils/event-filters.js';
import { getEventfindaDemoEvents } from './utils/demo-data.js';
import { CATEGORY_TO_EVENTFINDA_SLUG } from './utils/category.js';
import { fetchWithRetry } from './utils/http.js';
import { mapEventFindaToEvent } from './utils/eventfinda-mapper.js';
import type { EventFindaApiResponse } from './utils/eventfinda-types.js';

// ============================================
// EventFinda API Configuration
// ============================================

/**
 * EventFinda v2 REST API — https://www.eventfinda.sg/api/v2/overview
 *
 * Auth: HTTP Basic (username:password)
 * Base URL: https://api.eventfinda.sg/v2
 * Endpoint: GET /events.json
 * Rate limit: 1 request/second
 * Max rows per request: 20
 */
const EVENTFINDA_API_BASE = 'https://api.eventfinda.sg/v2';

// ============================================
// API Client
// ============================================

async function fetchEventFindaEvents(params: {
  startDate: string;
  endDate?: string;
  categorySlugs?: string[];
  query?: string;
  budgetMax?: number;
  free?: boolean;
  rows?: number;
  offset?: number;
  order?: 'date' | 'popularity';
}): Promise<EventFindaApiResponse> {
  const username = process.env.EVENTFINDA_USERNAME;
  const password = process.env.EVENTFINDA_PASSWORD;

  if (!username || !password) {
    throw new Error('EVENTFINDA_USERNAME and EVENTFINDA_PASSWORD must be set');
  }

  const url = new URL(`${EVENTFINDA_API_BASE}/events.json`);

  // Date range
  url.searchParams.set('start_date', params.startDate);
  if (params.endDate) {
    url.searchParams.set('end_date', params.endDate);
  }

  // Category filter
  if (params.categorySlugs?.length) {
    url.searchParams.set('category_slug', params.categorySlugs.join(','));
  }

  // Free text search
  if (params.query) {
    url.searchParams.set('q', params.query);
  }

  // Price filters
  if (params.free) {
    url.searchParams.set('free', '1');
  }
  if (params.budgetMax !== undefined && params.budgetMax > 0) {
    url.searchParams.set('price_max', String(params.budgetMax));
  }

  // Pagination
  url.searchParams.set('rows', String(params.rows ?? 20));
  if (params.offset) {
    url.searchParams.set('offset', String(params.offset));
  }

  // Ordering — popularity gives more relevant results for discovery
  url.searchParams.set('order', params.order ?? 'popularity');

  // Request useful fields to minimize payload
  url.searchParams.set(
    'fields',
    'event:(id,name,url,url_slug,description,address,location_summary,datetime_start,datetime_end,datetime_summary,is_free,is_cancelled,is_featured,restrictions,point,category,location,images,sessions,ticket_types),category:(id,name,url_slug),location:(id,name),session:(datetime_start,datetime_end,is_cancelled),image:(id,transforms),ticket_type:(name,price,is_free)',
  );

  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

  console.log(`[eventfinda] Fetching ${url.toString()}`);
  const response = await fetchWithRetry(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });
  return response.json() as Promise<EventFindaApiResponse>;
}

// ============================================
// Tool Definition
// ============================================

export const searchEventfindaTool = createTool({
  id: 'search-eventfinda',
  description:
    'Searches EventFinda Singapore for events using their REST API. Accepts a date range, categories, and budget. Uses HTTP Basic auth with EventFinda API credentials. Returns structured event data with pricing, categories, and location. Falls back to demo data when API credentials are not configured.',
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

    const username = process.env.EVENTFINDA_USERNAME;
    const password = process.env.EVENTFINDA_PASSWORD;

    if (!username || !password) {
      console.log('[eventfinda] No credentials — using demo data');
      return buildSearchResult(
        getEventfindaDemoEvents(input.date),
        'eventfinda', startTime, 'demo',
        { budgetMax: input.budgetMax, categories: input.categories, maxResults: input.maxResults },
      );
    }

    try {
      // Build category slugs from our categories
      const categorySlugs = (input.categories ?? [])
        .map((cat) => CATEGORY_TO_EVENTFINDA_SLUG[cat as EventCategory])
        .filter((slug): slug is string => !!slug)
        .filter((slug, i, arr) => arr.indexOf(slug) === i);

      // Build date range
      const startDate = input.date;
      const endDate = resolveEndDate(input.date, input.dateEnd);

      console.log(`[eventfinda] Search: ${startDate}→${endDate}, categories: ${categorySlugs.join(', ') || 'all'}, budget: ${input.budgetMax ?? 'unlimited'}`);

      const response = await fetchEventFindaEvents({
        startDate,
        endDate,
        categorySlugs: categorySlugs.length > 0 ? categorySlugs : undefined,
        budgetMax: input.budgetMax,
        free: input.budgetMax === 0 ? true : undefined,
        rows: input.maxResults ?? 20,
        order: 'popularity',
      });

      const totalCount = response['@attributes']?.count ?? 0;
      const rawEvents = response.events ?? [];

      console.log(`[eventfinda] API returned ${rawEvents.length} events (${totalCount} total)`);

      const events: Event[] = rawEvents
        .map(mapEventFindaToEvent)
        .filter((e): e is Event => e !== null);

      return buildSearchResult(
        events, 'eventfinda', startTime, 'live',
        { budgetMax: input.budgetMax, categories: input.categories, maxResults: input.maxResults },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[eventfinda] Error: ${errorMessage}`);
      return buildSearchResult(
        getEventfindaDemoEvents(input.date),
        'eventfinda', startTime, 'demo',
        { maxResults: input.maxResults, error: errorMessage },
      );
    }
  },
});
