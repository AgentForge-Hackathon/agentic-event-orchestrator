import type { EventCategory } from '../../../types/index.js';

// ============================================
// Shared Category Keywords
// ============================================

/**
 * Keyword lists for inferring EventCategory from event text.
 * Used by both Eventbrite and EventFinda tools.
 */
export const CATEGORY_KEYWORDS: Record<EventCategory, string[]> = {
  concert: [
    'concert', 'live music', 'band', 'gig', 'orchestra', 'symphony', 'jazz',
    'acoustic', 'edm', 'anthem', 'rave', 'techno', 'house music', 'hip hop',
    'r&b', 'singer', 'vocalist', 'melody',
  ],
  theatre: [
    'theatre', 'theater', 'drama', 'play', 'musical', 'opera', 'ballet',
    'performance', 'stage', 'improv', 'comedy show', 'stand-up',
  ],
  sports: [
    'sports', 'marathon', 'run', 'race', 'fitness', 'yoga', 'gym', 'match',
    'tournament', 'swim', 'cycling', 'triathlon', 'boxing', 'martial arts',
  ],
  dining: [
    'food', 'dining', 'dinner', 'brunch', 'lunch', 'culinary', 'tasting',
    'restaurant', 'chef', 'wine', 'cheese', 'supper', 'buffet', 'hawker',
    'gastronomy', 'cooking', 'sake', 'whisky', 'whiskey', 'beer',
  ],
  nightlife: [
    'nightlife', 'club', 'party', 'dj', 'bar', 'lounge', 'drinks',
    'cocktail', 'happy hour', 'rooftop', 'afterparty', 'after party',
    'rave', 'dance floor',
  ],
  outdoor: [
    'outdoor', 'hike', 'hiking', 'nature', 'garden', 'park', 'beach',
    'kayak', 'cycling', 'camping', 'trek', 'trail', 'adventure',
  ],
  cultural: [
    'cultural', 'heritage', 'museum', 'gallery', 'art', 'history',
    'tradition', 'temple', 'craft', 'pottery', 'calligraphy',
  ],
  workshop: [
    'workshop', 'class', 'course', 'learn', 'masterclass', 'tutorial',
    'hands-on', 'seminar', 'bootcamp', 'training', 'certification',
  ],
  exhibition: [
    'exhibition', 'exhibit', 'gallery', 'showcase', 'display',
    'installation', 'expo', 'pop-up',
  ],
  festival: [
    'festival', 'fest', 'carnival', 'fair', 'celebration', 'parade',
    'fiesta', 'gala',
  ],
  other: [],
};

// ============================================
// Word Boundary Matching
// ============================================

/**
 * Pre-compiled regex patterns for each keyword.
 * Uses word boundaries (\b) to prevent substring false positives:
 *   - "party" won't match "paptest"
 *   - "run" won't match "brunch"
 *   - "bar" won't match "embarrass"
 *   - "walk" won't match "walkthrough" ... actually it will, but that's fine
 *
 * Multi-word phrases (e.g. "live music") are matched as-is with boundaries
 * around the full phrase.
 */
const KEYWORD_PATTERNS: Map<EventCategory, RegExp[]> = new Map();

for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  const patterns = keywords.map((kw) => new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i'));
  KEYWORD_PATTERNS.set(category as EventCategory, patterns);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Infer an EventCategory from event name + description using word-boundary
 * keyword matching. Returns the category with the most keyword hits,
 * or 'other' if no keywords match.
 */
export function inferCategory(name: string, description?: string): EventCategory {
  const text = `${name} ${description ?? ''}`.toLowerCase();

  let bestCategory: EventCategory = 'other';
  let bestScore = 0;

  for (const [category, patterns] of KEYWORD_PATTERNS.entries()) {
    if (category === 'other') continue;
    const score = patterns.filter((re) => re.test(text)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

// ============================================
// Source-Specific Category Mappings
// ============================================

/**
 * Maps our EventCategory → Eventbrite URL path keyword.
 * Used to construct Eventbrite search URLs.
 */
export const CATEGORY_TO_EVENTBRITE_KEYWORD: Partial<Record<EventCategory, string>> = {
  concert: 'music',
  theatre: 'performing-visual-arts',
  sports: 'sports-fitness',
  dining: 'food-drink',
  nightlife: 'nightlife',
  outdoor: 'travel-outdoor',
  cultural: 'performing-visual-arts',
  workshop: 'business',
  exhibition: 'performing-visual-arts',
  festival: 'music',
};

/**
 * Maps our internal EventCategory → EventFinda API category_slug.
 * Used when querying the EventFinda API.
 */
export const CATEGORY_TO_EVENTFINDA_SLUG: Partial<Record<EventCategory, string>> = {
  concert: 'concerts-gig-guide',
  theatre: 'arts',
  sports: 'sports',
  dining: 'festivals-lifestyle',
  nightlife: 'festivals-lifestyle',
  outdoor: 'sports',
  cultural: 'exhibitions',
  workshop: 'workshops-conferences-classes',
  exhibition: 'exhibitions',
  festival: 'festivals-lifestyle',
};

/**
 * Reverse map: EventFinda API category_slug → our EventCategory.
 * Used to map EventFinda's own category classification back to our types,
 * avoiding keyword inference when the API already tells us the category.
 */
export const EVENTFINDA_SLUG_TO_CATEGORY: Record<string, EventCategory> = {
  'concerts-gig-guide': 'concert',
  'arts': 'theatre',
  'sports': 'sports',
  'festivals-lifestyle': 'festival',
  'exhibitions': 'exhibition',
  'workshops-conferences-classes': 'workshop',
  'business-education': 'workshop',
};

/**
 * Infer category for an EventFinda event. Prefers the API's own category
 * classification (via url_slug reverse mapping), falling back to keyword
 * inference only when the API category doesn't map to our types.
 */
export function inferCategoryFromEventFinda(
  name: string,
  description?: string,
  efCategorySlug?: string,
): EventCategory {
  // First: try the API's own category
  if (efCategorySlug) {
    const mapped = EVENTFINDA_SLUG_TO_CATEGORY[efCategorySlug];
    if (mapped) return mapped;
  }

  // Fallback: keyword inference
  return inferCategory(name, description);
}