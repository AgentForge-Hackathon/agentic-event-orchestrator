import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  EventSchema,
  LocationSchema,
  ItinerarySchema,
  EventCategorySchema,
  type Itinerary,
  type ItineraryItem,
  type Event,
} from '../../types/index.js';

// ============================================
// LLM Output Schema (what the planning agent returns)
// ============================================

const LLMPlanItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  category: EventCategorySchema.catch('other'),
  isMainEvent: z.boolean().default(false),
  startTime: z.string().describe('HH:MM 24h format'),
  endTime: z.string().describe('HH:MM 24h format'),
  durationMinutes: z.number().min(0),
  location: z.object({
    name: z.string(),
    address: z.string(),
    area: z.string().optional(),
  }),
  estimatedCostPerPerson: z.number().min(0).default(0),
  priceCategory: z.enum(['free', 'budget', 'moderate', 'premium', 'luxury']).default('moderate'),
  travelFromPrevious: z.object({
    durationMinutes: z.number().min(0).default(0),
    mode: z.enum(['walk', 'mrt', 'taxi', 'bus', 'none']).default('walk'),
    description: z.string().default(''),
  }).optional(),
  vibeNotes: z.string().optional(),
  bookingRequired: z.boolean().default(false),
  sourceUrl: z.string().nullable().optional(),
});

const LLMPlanSchema = z.object({
  itineraryName: z.string(),
  items: z.array(LLMPlanItemSchema).min(1),
  totalEstimatedCostPerPerson: z.number().min(0),
  budgetStatus: z.enum(['within_budget', 'slightly_over', 'over_budget']).default('within_budget'),
  budgetNotes: z.string().optional(),
  overallVibe: z.string().optional(),
  practicalTips: z.array(z.string()).optional(),
  weatherConsideration: z.string().optional(),
});

export type LLMPlan = z.infer<typeof LLMPlanSchema>;
export type LLMPlanItem = z.infer<typeof LLMPlanItemSchema>;

// ============================================
// Time / Domain Helpers
// ============================================

/** Parse HH:MM string into minutes since midnight */
function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Format minutes since midnight back to HH:MM */
function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/** SGT offset in minutes (UTC+8) */
const SGT_OFFSET_MINUTES = 8 * 60;

/** Extract HH:MM (SGT, UTC+8) from an ISO datetime string */
function extractTimeFromISO(isoString: string): string {
  const d = new Date(isoString);
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const sgtMinutes = (utcMinutes + SGT_OFFSET_MINUTES) % (24 * 60);
  return formatTime(sgtMinutes);
}

/** Map LLM travel mode to domain travel mode */
function mapTravelMode(mode: string): 'walk' | 'public_transport' | 'taxi' | 'drive' | undefined {
  switch (mode) {
    case 'walk': return 'walk';
    case 'mrt':
    case 'bus': return 'public_transport';
    case 'taxi': return 'taxi';
    case 'none': return undefined;
    default: return 'walk';
  }
}

/** Build an ISO datetime string from a date and HH:MM time in SGT (UTC+8).
  * Converts SGT → UTC before creating the ISO string. */
function buildDatetime(dateStr: string, timeStr: string): string {
  // dateStr is either YYYY-MM-DD or a full ISO string
  const datePart = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  // Parse SGT time and convert to UTC by subtracting 8 hours
  const [h, m] = timeStr.split(':').map(Number);
  const sgtMinutes = (h ?? 0) * 60 + (m ?? 0);
  const utcMinutes = sgtMinutes - SGT_OFFSET_MINUTES;
  // Handle day rollback (e.g., 01:00 SGT = 17:00 UTC previous day)
  if (utcMinutes < 0) {
    const prevDate = new Date(`${datePart}T00:00:00Z`);
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const prevDatePart = prevDate.toISOString().split('T')[0];
    const wrapped = utcMinutes + 24 * 60;
    const utcH = Math.floor(wrapped / 60).toString().padStart(2, '0');
    const utcM = (wrapped % 60).toString().padStart(2, '0');
    return `${prevDatePart}T${utcH}:${utcM}:00.000Z`;
  }
  const utcH = Math.floor(utcMinutes / 60).toString().padStart(2, '0');
  const utcM = (utcMinutes % 60).toString().padStart(2, '0');
  return `${datePart}T${utcH}:${utcM}:00.000Z`;
}

// ============================================
// Plan Constants
// ============================================

/** Maximum number of itinerary items (including main event) */
const MAX_ITINERARY_ITEMS = 4;

/** Hard cutoff hour (minutes since midnight) — no activities should end after this unless night occasion */
const HARD_END_CUTOFF_MINUTES = 23 * 60; // 23:00

/** Maximum idle gap (minutes) between consecutive activities — warns if exceeded */
const MAX_GAP_MINUTES = 45;

/** Maximum total plan span in hours — warns if exceeded */
const MAX_PLAN_SPAN_HOURS = 8;

// ============================================
// Event Matching Helpers
// ============================================

/** Normalize a string for fuzzy matching: lowercase, strip punctuation, collapse whitespace */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Fuzzy-match an LLM event name against real discovered events.
 *  Tries exact → normalized exact → substring containment → word overlap. */
function fuzzyMatchEvent(
  llmName: string,
  eventsByName: Map<string, { event: Event; score: number; reasoning?: string }>,
): { event: Event; score: number; reasoning?: string } | undefined {
  const llmNorm = normalize(llmName);

  // 1. Exact match (already lowercase-trimmed keys)
  const exact = eventsByName.get(llmName.toLowerCase().trim());
  if (exact) return exact;

  // 2. Normalized exact match
  for (const [key, val] of eventsByName) {
    if (normalize(key) === llmNorm) return val;
  }

  // 3. Substring containment (either direction)
  for (const [key, val] of eventsByName) {
    const keyNorm = normalize(key);
    if (llmNorm.includes(keyNorm) || keyNorm.includes(llmNorm)) return val;
  }

  // 4. Word overlap — at least 60% of words in common
  const llmWords = new Set(llmNorm.split(' ').filter(w => w.length > 2));
  let bestMatch: { event: Event; score: number; reasoning?: string } | undefined;
  let bestOverlap = 0;
  for (const [key, val] of eventsByName) {
    const keyWords = new Set(normalize(key).split(' ').filter(w => w.length > 2));
    const overlap = [...llmWords].filter(w => keyWords.has(w)).length;
    const overlapRatio = overlap / Math.max(llmWords.size, keyWords.size, 1);
    if (overlapRatio >= 0.6 && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = val;
    }
  }
  return bestMatch;
}

// ============================================
// Plan Parsing
// ============================================

type RankedEvent = { event: Event; score: number; reasoning?: string };

/**
 * Parse and validate the raw LLM plan JSON.
 * Returns the validated plan, or throws with `{ fallback: true }` if validation fails.
 */
function parseLLMPlan(rawPlan: unknown): LLMPlan {
  return LLMPlanSchema.parse(rawPlan);
}

/**
 * Build the fallback return value when LLM plan validation fails.
 * Falls back to the top-ranked discovered event.
 */
function buildFallbackItinerary(
  rankedEvents: RankedEvent[],
  date: string,
  now: string,
) {
  const fallbackItems: ItineraryItem[] = rankedEvents.slice(0, 1).map((r, i) => ({
    id: `item-fallback-${i}-${Date.now()}`,
    event: r.event,
    scheduledTime: r.event.timeSlot,
    travelTimeFromPrevious: undefined,
    travelMode: undefined,
    status: 'planned' as const,
    notes: `Ranked #${i + 1} — ${r.reasoning ?? ''}`,
  }));

  return {
    itinerary: {
      id: `itinerary-${Date.now()}`,
      name: 'Your Plan (simplified)',
      date: date.includes('T') ? date : `${date}T00:00:00.000Z`,
      items: fallbackItems,
      totalCost: rankedEvents.slice(0, 1).reduce((sum, r) => sum + (r.event.price?.max ?? 0), 0),
      totalDuration: 0,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
    },
    planMetadata: {
      itineraryName: 'Simplified Plan',
      overallVibe: undefined,
      practicalTips: undefined,
      weatherConsideration: undefined,
      budgetStatus: 'within_budget',
      budgetNotes: 'LLM plan validation failed — showing ranked events only',
      totalEstimatedCostPerPerson: 0,
      itemCount: fallbackItems.length,
      mainEventCount: fallbackItems.length,
      generatedActivityCount: 0,
    },
    warnings: ['LLM plan validation failed — showing top ranked events as fallback'],
  };
}

/**
 * Enforce the item cap: keep all main events, fill remaining slots with complementary activities.
 * Mutates the plan's items array in-place via object spread.
 */
function applyItemCap(plan: LLMPlan, warnings: string[]): LLMPlan {
  if (plan.items.length <= MAX_ITINERARY_ITEMS) return plan;

  warnings.push(`Item cap: LLM generated ${plan.items.length} items but max is ${MAX_ITINERARY_ITEMS}. Keeping main events and trimming complementary activities.`);
  console.log(`[plan-itinerary] ⚠️ Trimming ${plan.items.length} items to max ${MAX_ITINERARY_ITEMS}`);

  const mainItems = plan.items.filter(i => i.isMainEvent);
  const complementaryItems = plan.items.filter(i => !i.isMainEvent);
  const remainingSlots = MAX_ITINERARY_ITEMS - mainItems.length;
  const trimmedItems = [...mainItems, ...complementaryItems.slice(0, Math.max(0, remainingSlots))];
  trimmedItems.sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

  return { ...plan, items: trimmedItems };
}

// ============================================
// Item Conversion
// ============================================

/**
 * Convert a single LLM plan item to a domain ItineraryItem.
 * Applies real event time corrections for matched main events.
 * Returns null if the item should be dropped (e.g. past hard cutoff).
 */
function convertLLMItemToItineraryItem(
  item: LLMPlanItem,
  index: number,
  matchedReal: RankedEvent | undefined,
  date: string,
  rankedEvents: RankedEvent[],
  prevEndMinutes: number | null,
  prevItemName: string | undefined,
  warnings: string[],
): { itineraryItem: ItineraryItem; endMinutes: number } | null {
  const itemId = `item-${index}-${Date.now()}`;

  // Build default ISO datetimes from LLM-provided times
  let startDatetime = buildDatetime(date, item.startTime);
  let endDatetime = buildDatetime(date, item.endTime);

  // CRITICAL: For main events matched to real discovered events,
  // force the scheduled time to the real event's time slot.
  // The LLM sometimes hallucinates incorrect times.
  if (matchedReal && item.isMainEvent) {
    const realStart = matchedReal.event.timeSlot.start;
    const realEnd = matchedReal.event.timeSlot.end;
    const realStartHHMM = extractTimeFromISO(realStart);
    const realEndHHMM = extractTimeFromISO(realEnd);

    if (item.startTime !== realStartHHMM || item.endTime !== realEndHHMM) {
      warnings.push(`Time correction: LLM scheduled "${item.name}" at ${item.startTime}–${item.endTime} but the real event runs ${realStartHHMM}–${realEndHHMM}. Using real event times.`);
      console.log(`[plan-itinerary] ⚠️ Correcting main event time: LLM said ${item.startTime}–${item.endTime}, real event is ${realStartHHMM}–${realEndHHMM}`);
    }

    startDatetime = realStart;
    endDatetime = realEnd;
  }

  // Build the Event object — use real event if matched, otherwise synthesize from LLM data
  const event: Event = matchedReal?.event ?? {
    id: `generated-${index}-${Date.now()}`,
    name: item.name,
    description: item.description,
    category: item.category,
    location: {
      name: item.location.name,
      address: item.location.address,
      lat: 1.3521, // Default Singapore coordinates
      lng: 103.8198,
    },
    timeSlot: {
      start: startDatetime,
      end: endDatetime,
    },
    price: {
      min: item.estimatedCostPerPerson,
      max: item.estimatedCostPerPerson,
      currency: 'SGD',
    },
    rating: undefined,
    sourceUrl: item.sourceUrl ?? `https://www.google.com/search?q=${encodeURIComponent(item.name + ' Singapore')}`,
    source: item.isMainEvent ? 'discovered' : 'planned',
    availability: 'unknown',
    bookingRequired: item.bookingRequired,
  };

  const travelMinutes = item.travelFromPrevious?.durationMinutes ?? 0;
  const travelMode = item.travelFromPrevious?.mode
    ? mapTravelMode(item.travelFromPrevious.mode)
    : undefined;

  // Use the actual (possibly corrected) times for sequencing checks
  const actualStartTime = matchedReal && item.isMainEvent
    ? extractTimeFromISO(startDatetime)
    : item.startTime;
  const actualEndTime = matchedReal && item.isMainEvent
    ? extractTimeFromISO(endDatetime)
    : item.endTime;

  // Check for tight transitions and gaps
  const startMinutes = parseTime(actualStartTime);
  if (prevEndMinutes !== null) {
    const gap = startMinutes - prevEndMinutes;
    if (gap < 0) {
      warnings.push(`Time overlap: "${prevItemName}" ends at ${formatTime(prevEndMinutes)} but "${item.name}" starts at ${actualStartTime}`);
    } else if (gap < 5 && travelMinutes > 0) {
      warnings.push(`Tight transition: only ${gap}min between "${prevItemName}" and "${item.name}" (${travelMinutes}min travel needed)`);
    } else if (gap > MAX_GAP_MINUTES) {
      warnings.push(`Excessive gap: ${gap}min idle time between "${prevItemName}" (ends ${formatTime(prevEndMinutes)}) and "${item.name}" (starts ${actualStartTime}). Max recommended: ${MAX_GAP_MINUTES}min`);
      console.log(`[plan-itinerary] ⚠️ Excessive gap: ${gap}min between "${prevItemName}" and "${item.name}"`);
    }
  }

  const endMinutes = parseTime(actualEndTime);

  // ── Hard time boundary check ──
  if (endMinutes > HARD_END_CUTOFF_MINUTES && !item.isMainEvent) {
    warnings.push(`Dropped "${item.name}" — ends at ${actualEndTime} which is past the ${formatTime(HARD_END_CUTOFF_MINUTES)} cutoff`);
    console.log(`[plan-itinerary] ⚠️ Dropping "${item.name}" (ends ${actualEndTime}, past ${formatTime(HARD_END_CUTOFF_MINUTES)} cutoff)`);
    return null;
  }
  if (endMinutes > HARD_END_CUTOFF_MINUTES && item.isMainEvent) {
    warnings.push(`Main event "${item.name}" ends at ${actualEndTime} which is past ${formatTime(HARD_END_CUTOFF_MINUTES)} — included because it's the main event`);
  }

  // Build notes with vibe context
  const noteParts: string[] = [];
  if (item.vibeNotes) noteParts.push(item.vibeNotes);
  if (item.travelFromPrevious?.description) noteParts.push(`Getting there: ${item.travelFromPrevious.description}`);
  if (item.priceCategory) noteParts.push(`Price tier: ${item.priceCategory}`);
  if (matchedReal) noteParts.push(`Ranked #${rankedEvents.indexOf(matchedReal) + 1} (score: ${matchedReal.score})`);

  const itineraryItem: ItineraryItem = {
    id: itemId,
    event,
    scheduledTime: {
      start: startDatetime,
      end: endDatetime,
    },
    travelTimeFromPrevious: travelMinutes > 0 ? travelMinutes : undefined,
    travelMode,
    status: 'planned',
    notes: noteParts.length > 0 ? noteParts.join(' | ') : undefined,
  };

  return { itineraryItem, endMinutes };
}

// ============================================
// Validation Helpers
// ============================================

/**
 * Sort itinerary items chronologically and warn if the total plan span is too long.
 */
function validateTimeSequencing(items: ItineraryItem[], warnings: string[]): void {
  items.sort((a, b) =>
    new Date(a.scheduledTime.start).getTime() - new Date(b.scheduledTime.start).getTime()
  );

  if (items.length < 2) return;

  const firstStart = new Date(items[0].scheduledTime.start).getTime();
  const lastEnd = new Date(items[items.length - 1].scheduledTime.end).getTime();
  const totalSpanHours = (lastEnd - firstStart) / (1000 * 60 * 60);

  if (totalSpanHours > MAX_PLAN_SPAN_HOURS) {
    warnings.push(`Plan span too long: ${totalSpanHours.toFixed(1)} hours from first activity to last (max recommended: ${MAX_PLAN_SPAN_HOURS}h)`);
    console.log(`[plan-itinerary] ⚠️ Plan spans ${totalSpanHours.toFixed(1)}h — exceeds ${MAX_PLAN_SPAN_HOURS}h recommendation`);
  }

  console.log(
    `[plan-itinerary] Total plan span: ${totalSpanHours.toFixed(1)} hours (${formatTime(parseTime(extractTimeFromISO(items[0].scheduledTime.start)))} – ${formatTime(parseTime(extractTimeFromISO(items[items.length - 1].scheduledTime.end)))})`,
  );
}

/**
 * Warn if total cost per person exceeds the budget cap.
 */
function validateBudget(totalCostPerPerson: number, budgetMax: number | undefined, warnings: string[]): void {
  if (budgetMax == null) return;
  if (totalCostPerPerson > budgetMax * 1.2) {
    warnings.push(`Budget overrun: estimated $${totalCostPerPerson}/person exceeds $${budgetMax} budget by $${totalCostPerPerson - budgetMax}`);
  } else if (totalCostPerPerson > budgetMax) {
    warnings.push(`Slightly over budget: estimated $${totalCostPerPerson}/person vs $${budgetMax} budget`);
  }
}

// ============================================
// Main Tool
// ============================================

/**
 * Plan Itinerary Tool
 *
 * Receives the LLM-generated plan JSON and transforms it into a validated
 * Itinerary domain object. Computes totals, generates IDs, validates time
 * sequencing, and emits warnings for budget overruns or tight transitions.
 */
export const planItineraryTool = createTool({
  id: 'plan-itinerary',
  description:
    'Validates and structures an LLM-generated itinerary plan into the domain Itinerary schema. Computes totals, checks time sequencing, and flags budget or scheduling issues.',
  inputSchema: z.object({
    llmPlan: z.record(z.any()).describe('Raw JSON plan from the planning agent LLM'),
    rankedEvents: z
      .array(
        z.object({
          event: EventSchema,
          score: z.number(),
          reasoning: z.string().optional(),
        }),
      )
      .describe('Original ranked events from previous step, used to match main events'),
    date: z.string().describe('Itinerary date (YYYY-MM-DD or ISO datetime)'),
    budgetMax: z.number().optional().describe('Maximum total budget per person in SGD'),
    partySize: z.number().default(1).describe('Number of people'),
    occasion: z.string().optional().describe('Occasion type for naming'),
  }),
  outputSchema: z.object({
    itinerary: ItinerarySchema,
    planMetadata: z.object({
      itineraryName: z.string(),
      overallVibe: z.string().optional(),
      practicalTips: z.array(z.string()).optional(),
      weatherConsideration: z.string().optional(),
      budgetStatus: z.string(),
      budgetNotes: z.string().optional(),
      totalEstimatedCostPerPerson: z.number(),
      itemCount: z.number(),
      mainEventCount: z.number(),
      generatedActivityCount: z.number(),
    }),
    warnings: z.array(z.string()),
  }),
  execute: async ({ llmPlan: rawPlan, rankedEvents, date, budgetMax, partySize }) => {
    const warnings: string[] = [];
    const now = new Date().toISOString();

    console.log(`[plan-itinerary] Validating LLM plan…`);

    // ── Step 1: Parse and validate the LLM output ──
    let plan: LLMPlan;
    try {
      plan = parseLLMPlan(rawPlan);
      console.log(`[plan-itinerary] Parsed plan: "${plan.itineraryName}" with ${plan.items.length} items`);
    } catch (err) {
      console.error(`[plan-itinerary] LLM plan validation failed:`, err);
      return buildFallbackItinerary(rankedEvents, date, now);
    }

    // ── Step 2: Build event lookup + enforce item cap ──
    const eventsByName = new Map<string, RankedEvent>();
    for (const r of rankedEvents) {
      eventsByName.set(r.event.name.toLowerCase().trim(), r);
    }

    plan = applyItemCap(plan, warnings);

    // ── Step 3: Convert each LLM plan item to an ItineraryItem ──
    const itineraryItems: ItineraryItem[] = [];
    let totalCostPerPerson = 0;
    let totalDurationMinutes = 0;
    let prevEndMinutes: number | null = null;

    for (let i = 0; i < plan.items.length; i++) {
      const item = plan.items[i];

      const matchedReal = item.isMainEvent
        ? fuzzyMatchEvent(item.name, eventsByName)
        : undefined;

      if (item.isMainEvent && matchedReal) {
        console.log(`[plan-itinerary] ✅ Fuzzy-matched main event "${item.name}" → "${matchedReal.event.name}"`);
      } else if (item.isMainEvent && !matchedReal) {
        console.log(`[plan-itinerary] ⚠️ Could not match main event "${item.name}" to any discovered event — using LLM times (may be inaccurate)`);
        warnings.push(`Unmatched main event: "${item.name}" could not be matched to discovered events. Times may be inaccurate.`);
      }

      const result = convertLLMItemToItineraryItem(
        item,
        i,
        matchedReal,
        date,
        rankedEvents,
        prevEndMinutes,
        plan.items[i - 1]?.name,
        warnings,
      );

      if (!result) continue; // Item dropped (past hard cutoff)

      prevEndMinutes = result.endMinutes;
      itineraryItems.push(result.itineraryItem);
      totalCostPerPerson += item.estimatedCostPerPerson;
      totalDurationMinutes += item.durationMinutes + (item.travelFromPrevious?.durationMinutes ?? 0);
    }

    // ── Step 3b: Sort + validate total span ──
    validateTimeSequencing(itineraryItems, warnings);

    // ── Step 4: Budget validation ──
    validateBudget(totalCostPerPerson, budgetMax, warnings);

    // ── Step 5: Build the final Itinerary ──
    const mainEventCount = itineraryItems.filter(item => item.event.source !== 'planned').length;
    const generatedCount = itineraryItems.length - mainEventCount;
    const totalCost = totalCostPerPerson * partySize;

    const itinerary: Itinerary = {
      id: `itinerary-${Date.now()}`,
      name: plan.itineraryName,
      date: date.includes('T') ? date : `${date}T00:00:00.000Z`,
      items: itineraryItems,
      totalCost,
      totalDuration: totalDurationMinutes,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };

    console.log(`[plan-itinerary] ✅ Itinerary built: "${itinerary.name}"`);
    console.log(`[plan-itinerary]   ${itineraryItems.length} items (${mainEventCount} main events, ${generatedCount} complementary)`);
    console.log(`[plan-itinerary]   Total cost: $${totalCost} ($${totalCostPerPerson}/person × ${partySize})`);
    console.log(`[plan-itinerary]   Duration: ${totalDurationMinutes}min`);
    if (warnings.length > 0) {
      console.log(`[plan-itinerary]   ⚠️ ${warnings.length} warning(s): ${warnings.join('; ')}`);
    }

    return {
      itinerary,
      planMetadata: {
        itineraryName: plan.itineraryName,
        overallVibe: plan.overallVibe,
        practicalTips: plan.practicalTips,
        weatherConsideration: plan.weatherConsideration,
        budgetStatus: plan.budgetStatus,
        budgetNotes: plan.budgetNotes,
        totalEstimatedCostPerPerson: totalCostPerPerson,
        itemCount: itineraryItems.length,
        mainEventCount,
        generatedActivityCount: generatedCount,
      },
      warnings,
    };
  },
});
