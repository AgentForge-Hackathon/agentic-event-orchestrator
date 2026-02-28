import type { EventbriteJsonLdEvent } from './eventbrite-types.js';

const JSONLD_SCRIPT_REGEX = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

/** Schema.org Event subtypes used by Eventbrite */
const SCHEMA_ORG_EVENT_TYPES = new Set([
  'Event', 'SocialEvent', 'EducationEvent', 'BusinessEvent',
  'MusicEvent', 'DanceEvent', 'TheaterEvent', 'VisualArtsEvent',
  'LiteraryEvent', 'Festival', 'FoodEvent', 'SportsEvent',
  'ScreeningEvent', 'ComedyEvent', 'SaleEvent', 'ExhibitionEvent',
  'SocialInteraction', 'Hackathon', 'CourseInstance',
]);

/**
 * Extracts event data from Eventbrite list page HTML.
 * Primary: parses `window.__SERVER_DATA__` JSON blob -> jsonld[].ItemList.itemListElement
 * Fallback: extracts `<script type="application/ld+json">` blocks for Schema.org Event objects
 *
 * NOTE: List page JSON-LD only contains date (no time) and no pricing.
 * Use `extractEventPageDetails` on individual event pages to get full data.
 */
export function extractServerData(html: string): EventbriteJsonLdEvent[] {
  const marker = 'window.__SERVER_DATA__ =';
  const startIdx = html.indexOf(marker);
  if (startIdx !== -1) {
    const jsonStart = html.indexOf('{', startIdx + marker.length);
    if (jsonStart !== -1) {
      const semicolonSearch = '};';
      let searchFrom = jsonStart;
      let jsonStr: string | null = null;
      while (searchFrom < html.length) {
        const semiIdx = html.indexOf(semicolonSearch, searchFrom);
        if (semiIdx === -1) break;
        const candidate = html.slice(jsonStart, semiIdx + 1);
        try {
          JSON.parse(candidate);
          jsonStr = candidate;
          break;
        } catch {
          searchFrom = semiIdx + 1;
        }
      }
      if (jsonStr) {
        try {
          const serverData = JSON.parse(jsonStr);
          const jsonLd = serverData?.jsonld;
          if (Array.isArray(jsonLd)) {
            for (const entry of jsonLd) {
              if (entry?.['@type'] === 'ItemList' && Array.isArray(entry?.itemListElement)) {
                return entry.itemListElement
                  .map((item: { item?: EventbriteJsonLdEvent }) => item?.item)
                  .filter(Boolean) as EventbriteJsonLdEvent[];
              }
            }
          }
        } catch {
          // Failed to parse __SERVER_DATA__ JSON
        }
      }
    }
  }

  // Fallback: extract JSON-LD script blocks directly
  const jsonLdScripts = html.matchAll(JSONLD_SCRIPT_REGEX);

  const events: EventbriteJsonLdEvent[] = [];
  for (const match of jsonLdScripts) {
    try {
      const data = JSON.parse(match[1]);
      if (data?.['@type'] === 'Event' || data?.['@type'] === 'SocialEvent') {
        events.push(data);
      } else if (data?.['@type'] === 'ItemList' && Array.isArray(data?.itemListElement)) {
        for (const item of data.itemListElement) {
          if (item?.item?.['@type'] === 'Event') {
            events.push(item.item);
          }
        }
      }
    } catch {
      // malformed JSON-LD block
    }
  }

  return events;
}

/**
 * Extracts detailed event data (time, price, availability) from an individual event page.
 * Individual event pages have full JSON-LD with:
 * - startDate with time+timezone: "2026-02-27T19:00:00+08:00"
 * - offers with pricing: { lowPrice, highPrice, priceCurrency, availability }
 */
export function extractEventPageDetails(html: string, _url?: string): EventbriteJsonLdEvent | null {
  const jsonLdScripts = html.matchAll(JSONLD_SCRIPT_REGEX);

  for (const match of jsonLdScripts) {
    try {
      const data = JSON.parse(match[1]);
      const type = data?.['@type'] ?? 'unknown';
      if (SCHEMA_ORG_EVENT_TYPES.has(type) && data?.startDate) {
        return data as EventbriteJsonLdEvent;
      }
    } catch {
      // parse error
    }
  }

  return null;
}
