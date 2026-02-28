import type { Event } from '../../../types/index.js';
import { deduplicateEventsTool } from '../../tools/deduplicate-events.js';
import { traceContext } from '../../../tracing/index.js';
import { contextRegistry } from '../../../context/index.js';
import { emitTrace, discoveryStartTimes } from '../utils/trace-helpers.js';
import { intentStep } from './intent.step.js';

/**
 * Mapper: Prepares discovery search parameters from intent output.
 * Used as the `.map()` callback between intentStep and the parallel search steps.
 */
export async function prepareDiscoveryInput({ inputData }: { inputData: {
  agentEnrichment?: { preferredCategories?: string[] };
  constraints: Record<string, unknown>;
  formData: Record<string, unknown>;
} }) {
  const enrichedCategories = inputData.agentEnrichment?.preferredCategories;
  const deterministicCategories = (inputData.constraints as Record<string, unknown>)?.preferredCategories as string[] | undefined;
  const categories = enrichedCategories ?? deterministicCategories;

  const date = (inputData.formData as Record<string, unknown>).date as string;
  const areas = (inputData.formData as Record<string, unknown>).areas as string[];
  const budgetMax = ((inputData.constraints as Record<string, unknown>)?.budget as Record<string, unknown>)?.max as number | undefined;

  const discoveryStartTime = Date.now();
  const traceId = traceContext.getStore() ?? 'unknown';
  discoveryStartTimes.set(traceId, discoveryStartTime);

  emitTrace({
    id: `discovery-started-${Date.now()}`,
    type: 'workflow_step',
    name: 'Searching for events…',
    status: 'started',
    startedAt: new Date(discoveryStartTime).toISOString(),
    metadata: {
      pipelineStep: 'discovery',
      agentName: 'Discovery Agent',
      agentStatus: 'Searching Eventbrite & EventFinda…',
      inputSummary: `Date: ${date} | Budget: ${budgetMax ? `$${budgetMax}` : 'unlimited'} | Categories: ${categories?.join(', ') ?? 'all'} | Areas: ${areas?.join(', ') ?? 'anywhere'}`,
    },
  });

  console.log(`[pipeline:discovery] 🔍 Discovery starting`);
  // ── Context: discovery agent starting ──
  const _discStartCtx = contextRegistry.get(traceContext.getStore() ?? '');
  void _discStartCtx?.updateAgentState({ agentId: 'discovery-agent', status: 'running', timestamp: new Date().toISOString() }).catch(() => {});
  console.log(`[pipeline:discovery] Date: ${date}, Budget max: ${budgetMax ?? 'unlimited'}`);
  console.log(`[pipeline:discovery] Categories: ${categories?.join(', ') ?? 'all'}`);
  console.log(`[pipeline:discovery] Areas: ${areas?.join(', ') ?? 'anywhere'}`);
  console.log(`[pipeline:discovery] Searching 2 sources in parallel: Eventbrite, EventFinda`);

  return {
    date,
    categories,
    budgetMax,
    areas,
    maxResults: 20,
  };
}

/**
 * Mapper: Merges parallel discovery results, injects HallyuCon, and deduplicates.
 * Used as the `.map()` callback after `.parallel([searchEventbriteStep, searchEventfindaStep])`.
 */
export async function mergeAndDeduplicateEvents({ inputData, getStepResult }: {
  inputData: Record<string, { events: Event[]; mode?: string; searchDuration?: number }>;
  getStepResult: (step: typeof intentStep) => ReturnType<typeof intentStep['execute']> extends Promise<infer R> ? R : never;
}) {
  const eventbriteResult = inputData['search-eventbrite'] ?? { events: [] };
  const eventfindaResult = inputData['search-eventfinda'] ?? { events: [] };
  const rawEvents = [
    ...eventbriteResult.events,
    ...eventfindaResult.events,
  ];

  // Deduplicate merged events
  let allEvents: Event[] = rawEvents;
  let dedupStats: { originalCount: number; deduplicatedCount: number; removedCount: number } | undefined;
  const dedupResult = await deduplicateEventsTool.execute!(
    { events: rawEvents },
    {} as Record<string, never>,
  );
  if (dedupResult && 'events' in dedupResult) {
    const dr = dedupResult as { events: Event[]; originalCount: number; deduplicatedCount: number; removedCount: number };
    allEvents = dr.events;
    dedupStats = {
      originalCount: dr.originalCount,
      deduplicatedCount: dr.deduplicatedCount,
      removedCount: dr.removedCount,
    };
  }

  // HallyuCon is injected as a guaranteed free RSVP event for the demo.
  // The execution agent needs at least one bookable free event to show the
  // end-to-end booking flow (open browser → fill form → confirm) without
  // hitting a paywall. HallyuCon is a real Eventbrite event with a free
  // "Reserve a spot" flow, making it ideal for a live demo.
  // ── Inject priority event: HallyuCon Mar '26 ──
  const hallyuConEvent: Event = {
    id: 'inject_hallyucon_mar26',
    name: "HallyuCon Mar '26",
    description: 'The ultimate Korean pop culture convention — K-pop, K-drama, Korean beauty, fashion, and food all in one place. Over 70 vendors, live stage performances, Random Play Dance, and more. Free RSVP gives entry on both days.',
    category: 'cultural',
    location: {
      name: 'Suntec Singapore Convention & Exhibition Centre, Hall 404',
      address: '1 Raffles Blvd, Suntec City, Singapore 039593',
      lat: 1.2932,
      lng: 103.8573,
    },
    timeSlot: {
      start: '2026-03-07T12:00:00+08:00',
      end: '2026-03-07T20:00:00+08:00',
    },
    price: { min: 0, max: 0, currency: 'SGD' },
    rating: 4.5,
    sourceUrl: 'https://www.eventbrite.sg/e/hallyucon-mar-26-rsvp-registration-tickets-1978865860057',
    source: 'eventbrite',
    availability: 'available',
    bookingRequired: true,
  };
  // Only inject if not already present (avoid duplicates on re-runs)
  if (!allEvents.some((e) => e.id === hallyuConEvent.id || e.sourceUrl === hallyuConEvent.sourceUrl)) {
    allEvents.push(hallyuConEvent);
    console.log(`[pipeline:discovery] 📌 Injected priority event: ${hallyuConEvent.name}`);
  }

  console.log(`[pipeline:discovery] ✅ Discovery complete`);
  console.log(`[pipeline:discovery]   Eventbrite: ${eventbriteResult.events.length} events (${eventbriteResult.mode ?? 'unknown'} mode, ${eventbriteResult.searchDuration ?? 0}ms)`);
  console.log(`[pipeline:discovery]   EventFinda: ${eventfindaResult.events.length} events (${eventfindaResult.mode ?? 'unknown'} mode, ${eventfindaResult.searchDuration ?? 0}ms)`);
  console.log(`[pipeline:discovery]   Raw merged: ${rawEvents.length} events`);
  console.log(`[pipeline:discovery]   After dedup: ${allEvents.length} events${dedupStats ? ` (${dedupStats.removedCount} duplicates removed)` : ''}`);

  const topEventsStr = allEvents.slice(0, 5).map((e, i) => {
    const priceStr = e.price ? `$${e.price.min}-${e.price.max} ${e.price.currency}` : 'free/unknown';
    return `${i + 1}. ${e.name} (${e.category ?? 'other'}, ${priceStr})`;
  }).join('\n');

  if (allEvents.length > 0) {
    console.log(`[pipeline:discovery] Top events:`);
    allEvents.slice(0, 5).forEach((e, i) => {
      const priceStr = e.price ? `$${e.price.min}-${e.price.max} ${e.price.currency}` : 'free/unknown';
      console.log(`[pipeline:discovery]   ${i + 1}. ${e.name} (${e.category ?? 'other'}, ${priceStr})`);
    });
  }

  const intentResult = getStepResult(intentStep);
  const agentReasoning = intentResult?.agentEnrichment?.reasoning;
  const intentSummary = intentResult?.naturalLanguageSummary;

  const ebCount = eventbriteResult.events.length;
  const efCount = eventfindaResult.events.length;
  const ebMode = eventbriteResult.mode ?? 'unknown';
  const efMode = eventfindaResult.mode ?? 'unknown';

  const traceId = traceContext.getStore() ?? 'unknown';
  const discoveryStartTime = discoveryStartTimes.get(traceId) ?? Date.now();
  discoveryStartTimes.delete(traceId); // Clean up
  const discoveryDuration = Date.now() - discoveryStartTime;

  emitTrace({
    id: `discovery-completed-${Date.now()}`,
    type: 'workflow_step',
    name: `Found ${allEvents.length} events`,
    status: 'completed',
    startedAt: new Date(discoveryStartTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: discoveryDuration,
    metadata: {
      pipelineStep: 'discovery',
      agentName: 'Discovery Agent',
      agentStatus: allEvents.length > 0 ? 'Done — handing off to Recommendation Agent' : 'Complete — no events found',
      eventCount: allEvents.length,
      resultCount: allEvents.length,
      reasoning: `Searched Eventbrite (${ebMode}: ${ebCount} results) and EventFinda (${efMode}: ${efCount} results) in parallel. Merged ${allEvents.length} total events.`,
      outputSummary: topEventsStr || 'No events found',
      reasoningSteps: [
        {
          label: 'Eventbrite search',
          detail: `${ebCount} events via ${ebMode} mode`,
          status: ebCount > 0 ? 'pass' : 'fail',
        },
        {
          label: 'EventFinda search',
          detail: `${efCount} events via ${efMode} mode`,
          status: efCount > 0 ? 'pass' : 'fail',
        },
        {
          label: 'Merge',
          detail: `Combined ${rawEvents.length} raw events from 2 sources`,
          status: rawEvents.length > 0 ? 'pass' : 'fail',
        },
        {
          label: 'Deduplicate',
          detail: dedupStats
            ? `${dedupStats.originalCount} → ${dedupStats.deduplicatedCount} (${dedupStats.removedCount} duplicates removed)`
            : `${allEvents.length} events (dedup skipped)`,
          status: dedupStats && dedupStats.removedCount > 0 ? 'pass' : 'info',
        },
      ],
      decisions: allEvents.slice(0, 5).map((e) => ({
        title: e.name,
        reason: `${e.category ?? 'other'} event from ${e.source ?? 'unknown'} — ${e.price ? `$${e.price.min}-${e.price.max} ${e.price.currency}` : 'free/unknown'}`,
        score: e.rating != null ? e.rating / 5 : undefined,
        data: { category: e.category, source: e.source, timeSlot: e.timeSlot },
      })),
    },
  });

  console.log(`[pipeline:discovery] ✅ Discovery complete — ${allEvents.length} events ready for ranking`);

  // ── Context: discovery completed ──
  const _discDoneCtx = contextRegistry.get(traceContext.getStore() ?? '');
  void _discDoneCtx?.storeDiscoveredEvents(allEvents as Event[]).catch(() => {});
  void _discDoneCtx?.updateAgentState({ agentId: 'discovery-agent', status: 'completed', timestamp: new Date().toISOString() }).catch(() => {});
  void _discDoneCtx?.updateWorkflowPhase('recommendation').catch(() => {});

  return {
    events: allEvents,
    intentSummary,
    agentReasoning,
    dedupStats,
    // Thread through constraint data for the ranking step
    constraints: intentResult?.constraints as Record<string, unknown> | undefined,
    agentEnrichment: intentResult?.agentEnrichment,
    formData: intentResult?.formData,
  };
}
