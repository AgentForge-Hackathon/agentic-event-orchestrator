import { Router } from 'express';
import type { Request, Response } from 'express';
import { searchEventbriteTool } from '../../mastra/tools/search-eventbrite.js';
import { searchEventfindaTool } from '../../mastra/tools/search-eventfinda.js';
import type { Event, EventCategory } from '../../types/index.js';

const router = Router();

// Tools are invoked directly here, outside of a Mastra workflow runtime.
// These implementations don't use the runtime context parameter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DIRECT_TOOL_CTX = {} as any;

// ---------------------------------------------------------------------------
// In-memory cache (5-minute TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  events: Event[];
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry>();

function getCacheKey(params: {
  date: string;
  dateEnd?: string;
  categories?: string;
  budgetMax?: string;
}): string {
  return JSON.stringify(params);
}

function getCached(key: string): Event[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.events;
}

function setCache(key: string, events: Event[]): void {
  cache.set(key, { events, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// GET /api/events
// ---------------------------------------------------------------------------

/**
 * Returns events from Eventbrite and EventFinda discovery tools in parallel.
 * Results are cached for 5 minutes per unique query to avoid re-scraping.
 *
 * Query params:
 *   date        — YYYY-MM-DD start date (defaults to today)
 *   dateEnd     — YYYY-MM-DD end date (defaults to date + 3 days)
 *   categories  — comma-separated list of categories (e.g. "concert,dining")
 *   budgetMax   — maximum price per person in SGD
 *   limit       — max events to return (default 20, max 100)
 *   offset      — pagination offset (default 0)
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { date, dateEnd, categories, budgetMax, limit = '20', offset = '0' } =
    req.query;

  const dateStr = (date as string) || new Date().toISOString().slice(0, 10);
  const dateEndStr = dateEnd as string | undefined;
  const categoriesStr = categories as string | undefined;
  const budgetMaxNum = budgetMax ? parseInt(budgetMax as string, 10) : undefined;
  const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 20, 1), 100);
  const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);

  const cacheKey = getCacheKey({
    date: dateStr,
    dateEnd: dateEndStr,
    categories: categoriesStr,
    budgetMax: budgetMax as string | undefined,
  });

  const cached = getCached(cacheKey);
  if (cached) {
    const paginated = cached.slice(offsetNum, offsetNum + limitNum);
    res.json({
      events: paginated,
      total: cached.length,
      limit: limitNum,
      offset: offsetNum,
      cached: true,
    });
    return;
  }

  const parsedCategories: EventCategory[] | undefined = categoriesStr
    ? (categoriesStr.split(',').map((c) => c.trim()).filter(Boolean) as EventCategory[])
    : undefined;

  // Run both discovery tools in parallel
  const toolInput = { date: dateStr, dateEnd: dateEndStr, categories: parsedCategories, budgetMax: budgetMaxNum, maxResults: 20 };
  const [eventbriteResult, eventfindaResult] = await Promise.allSettled([
    searchEventbriteTool.execute!(toolInput, DIRECT_TOOL_CTX),
    searchEventfindaTool.execute!(toolInput, DIRECT_TOOL_CTX),
  ]);

  // Merge and deduplicate by sourceUrl
  const allEvents: Event[] = [];
  const seenUrls = new Set<string | null>();

  for (const result of [eventbriteResult, eventfindaResult]) {
    if (result.status === 'fulfilled' && result.value && 'events' in result.value) {
      for (const event of result.value.events as Event[]) {
        if (!seenUrls.has(event.sourceUrl)) {
          seenUrls.add(event.sourceUrl);
          allEvents.push(event);
        }
      }
    } else if (result.status === 'rejected') {
      console.error('[events] Discovery tool failed:', result.reason);
    }
  }

  setCache(cacheKey, allEvents);

  const paginated = allEvents.slice(offsetNum, offsetNum + limitNum);
  res.json({
    events: paginated,
    total: allEvents.length,
    limit: limitNum,
    offset: offsetNum,
    cached: false,
  });
});

// ---------------------------------------------------------------------------
// GET /api/events/:id
// ---------------------------------------------------------------------------

/**
 * Returns a single event by ID. Searches across all in-memory cached results.
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  for (const entry of cache.values()) {
    const event = entry.events.find((e) => e.id === id);
    if (event) {
      res.json({ event });
      return;
    }
  }

  res.status(404).json({ error: 'Event not found' });
});

export { router as eventsRouter };
