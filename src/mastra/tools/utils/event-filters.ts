import type { Event, EventCategory } from '../../../types/index.js';

export interface FilterOptions {
  budgetMax?: number;
  categories?: EventCategory[];
  removeSoldOut?: boolean;
}

/**
 * Common post-fetch filtering applied to events from any source.
 * Filters by: sold_out removal, budget cap, category match.
 */
export function applyEventFilters(events: Event[], options: FilterOptions): Event[] {
  let filtered = events;

  if (options.removeSoldOut) {
    filtered = filtered.filter((e) => e.availability !== 'sold_out');
  }

  if (options.budgetMax !== undefined) {
    filtered = filtered.filter(
      (e) => !e.price || e.price.min <= options.budgetMax!,
    );
  }

  if (options.categories?.length) {
    filtered = filtered.filter((e) =>
      options.categories!.includes(e.category),
    );
  }

  return filtered;
}

export interface SearchToolResult {
  events: Event[];
  source: string;
  searchDuration: number;
  mode: 'live' | 'demo';
  error?: string;
}

/**
 * Build the standard search tool return value, applying filters and maxResults slicing.
 */
export function buildSearchResult(
  events: Event[],
  source: string,
  startTime: number,
  mode: 'live' | 'demo',
  options: FilterOptions & { maxResults?: number; error?: string },
): SearchToolResult {
  const filtered = applyEventFilters(events, options);
  return {
    events: filtered.slice(0, options.maxResults ?? 20),
    source,
    searchDuration: Date.now() - startTime,
    mode,
    ...(options.error ? { error: options.error } : {}),
  };
}
