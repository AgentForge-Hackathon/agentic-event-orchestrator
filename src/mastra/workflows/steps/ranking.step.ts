import type { Event, EventCategory } from '../../../types/index.js';
import { rankEventsTool } from '../../tools/rank-events.js';
import { recommendationAgent } from '../../agents/recommendation.js';
import { traceContext } from '../../../tracing/index.js';
import { contextRegistry } from '../../../context/index.js';
import { emitTrace, rankingStartTimes } from '../utils/trace-helpers.js';

/**
 * Mapper: Ranks events using deterministic scoring + LLM narrative reasoning.
 * Used as the `.map()` callback after the discovery merge step.
 */
export async function rankAndRecommend({ inputData }: { inputData: {
  events: Event[];
  intentSummary: string | undefined;
  agentReasoning: string | undefined;
  constraints: Record<string, unknown> | undefined;
  agentEnrichment: { preferredCategories?: string[]; excludedCategories?: string[] } | undefined;
  dedupStats: { originalCount: number; deduplicatedCount: number; removedCount: number } | undefined;
  formData: Record<string, unknown> | undefined;
} }) {
  const { events, intentSummary, agentReasoning, constraints, agentEnrichment, dedupStats, formData } = inputData;

  if (events.length === 0) {
    console.log(`[pipeline:ranking] ⏭️ No events to rank — skipping`);
    return {
      events,
      rankedEvents: undefined,
      filterStats: undefined,
      dedupStats,
      intentSummary,
      agentReasoning,
    };
  }

  const rankingStartTime = Date.now();
  const traceId = traceContext.getStore() ?? 'unknown';
  rankingStartTimes.set(traceId, rankingStartTime);
  // ── Context: recommendation agent starting ──
  const _rankStartCtx = contextRegistry.get(traceId);
  void _rankStartCtx?.updateAgentState({ agentId: 'recommendation-agent', status: 'running', timestamp: new Date().toISOString() }).catch(() => {});

  // Extract ranking inputs from intent constraints + agent enrichment
  const budgetMax = (constraints?.budget as Record<string, unknown>)?.max as number | undefined;
  const budgetMin = (constraints?.budget as Record<string, unknown>)?.min as number | undefined;
  const preferredCategories = agentEnrichment?.preferredCategories as string[] | undefined;
  const excludedCategories = agentEnrichment?.excludedCategories as string[] | undefined;
  const preferFreeEvents = (inputData.formData as Record<string, unknown>)?.preferFreeEvents === true;

  console.log(`[pipeline:ranking] 🏆 Ranking ${events.length} events`);
  console.log(`[pipeline:ranking]   Budget: $${budgetMin ?? 0}-${budgetMax ?? '∞'}`);
  console.log(`[pipeline:ranking]   Preferred: ${preferredCategories?.join(', ') ?? 'all'}`);
  console.log(`[pipeline:ranking]   Excluded: ${excludedCategories?.join(', ') ?? 'none'}`);

  emitTrace({
    id: `ranking-started-${Date.now()}`,
    type: 'workflow_step',
    name: 'Ranking events…',
    status: 'started',
    startedAt: new Date(rankingStartTime).toISOString(),
    metadata: {
      pipelineStep: 'recommendation',
      agentName: 'Recommendation Agent',
      agentStatus: 'Scoring events by budget, category, and rating…',
      inputSummary: `${events.length} events | Budget: $${budgetMin ?? 0}-${budgetMax ?? '∞'} | Categories: ${preferredCategories?.join(', ') ?? 'all'}`,
    },
  });

  // Call the ranking tool directly (same pattern as intent agent invocation)
  const rankResult = await rankEventsTool.execute!(
    {
      events: events as Record<string, unknown>[],
      budgetMin,
      budgetMax,
      preferredCategories: preferredCategories as EventCategory[] | undefined,
      excludedCategories: excludedCategories as EventCategory[] | undefined,
      isOutdoorFriendly: undefined,
      preferFreeEvents,
    },
    {} as Record<string, never>,
  );

  if (!rankResult || 'error' in rankResult) {
    console.warn(`[pipeline:ranking] ⚠️ Ranking failed — returning unranked events. Error:`, JSON.stringify(rankResult, null, 2));
    const _rankFailCtx = contextRegistry.get(traceContext.getStore() ?? '');
    void _rankFailCtx?.addError('Ranking failed — returning unranked events').catch(() => {});
    return {
      events,
      rankedEvents: undefined,
      filterStats: undefined,
      dedupStats,
      intentSummary,
      agentReasoning,
    };
  }

  const { rankedEvents, filterStats } = rankResult as {
    rankedEvents: { event: Event; score: number; reasoning: string }[];
    filterStats: { totalInput: number; passedFilters: number; finalCount: number };
  };
  const rankingDuration = Date.now() - rankingStartTime;
  rankingStartTimes.delete(traceId);

  // Build top picks summary for trace
  const topPicks = rankedEvents.slice(0, 3);
  const topPicksStr = topPicks.map((r: { event: { name: string }; score: number }, i: number) =>
    `${i + 1}. ${r.event.name} (score: ${r.score})`,
  ).join('\n');

  console.log(`[pipeline:ranking] ✅ Ranking complete`);
  console.log(`[pipeline:ranking]   Input: ${filterStats.totalInput} → Filtered: ${filterStats.passedFilters} → Final: ${filterStats.finalCount}`);
  topPicks.forEach((r: { event: { name: string }; score: number }, i: number) => {
    console.log(`[pipeline:ranking]   ${i + 1}. ${r.event.name} — score ${r.score}`);
  });

  // ── Recommendation Agent: generate narrative reasoning for traces ──
  let agentNarrative: {
    narrative?: string;
    topPickReasoning?: { eventName: string; why: string }[];
    tradeoffs?: string[];
    confidence?: number;
  } = {};

  try {
    const reasoningPrompt = `User request: ${intentSummary ?? 'Plan an outing'}
Budget: $${budgetMin ?? 0}-${budgetMax ?? '∞'}
Preferred categories: ${preferredCategories?.join(', ') ?? 'all'}
Excluded categories: ${excludedCategories?.join(', ') ?? 'none'}

Filter stats: ${filterStats.totalInput} total → ${filterStats.passedFilters} passed hard filters → ${filterStats.finalCount} scored and ranked.

Top ranked events:
${topPicks.map((r: { event: { name: string; category?: string; price?: { min: number; max: number; currency: string } }; score: number; reasoning: string }, i: number) => `${i + 1}. ${r.event.name} (${r.event.category ?? 'other'}, ${r.event.price ? `$${r.event.price.min}-${r.event.price.max}` : 'free'}) — score ${r.score} — ${r.reasoning}`).join('\n')}`;

    console.log(`[pipeline:ranking] 🤖 Recommendation Agent generating reasoning…`);
    const response = await recommendationAgent.generate(reasoningPrompt);
    const text = response.text.trim();

    try {
      agentNarrative = JSON.parse(text);
      console.log(`[pipeline:ranking] Agent narrative: ${agentNarrative.narrative ?? '(none)'}`);
      console.log(`[pipeline:ranking] Agent confidence: ${agentNarrative.confidence ?? 'unknown'}`);
    } catch {
      // If JSON parsing fails, use raw text as narrative
      agentNarrative = { narrative: text };
      console.warn(`[pipeline:ranking] Agent returned non-JSON — using raw text as narrative`);
    }
  } catch (err) {
    console.warn(`[pipeline:ranking] Agent reasoning failed: ${err instanceof Error ? err.message : String(err)}`);
    console.warn(`[pipeline:ranking] Falling back to deterministic reasoning only`);
  }

  emitTrace({
    id: `ranking-completed-${Date.now()}`,
    type: 'workflow_step',
    name: `Top ${topPicks.length} picks`,
    status: 'completed',
    startedAt: new Date(rankingStartTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: rankingDuration,
    metadata: {
      pipelineStep: 'recommendation',
      agentName: 'Recommendation Agent',
      agentStatus: 'Done — events ranked and ready',
      resultCount: topPicks.length,
      reasoning: agentNarrative.narrative ?? `Scored ${filterStats.totalInput} events: ${filterStats.passedFilters} passed hard filters. Top ${topPicks.length} picks selected by budget fit (30%), category match (25%), rating (20%), availability (15%), weather (10%).`,
      confidence: agentNarrative.confidence,
      outputSummary: topPicksStr || 'No events passed filters',
      reasoningSteps: [
        {
          label: 'Hard-constraint filtering',
          detail: `${filterStats.totalInput} → ${filterStats.passedFilters} events (removed ${filterStats.totalInput - filterStats.passedFilters} sold-out, excluded, or over-budget)`,
          status: filterStats.passedFilters > 0 ? 'pass' : 'fail',
        },
        {
          label: 'Multi-factor scoring',
          detail: `Scored ${filterStats.finalCount} events on budget fit, category match, rating, availability, weather`,
          status: filterStats.finalCount > 0 ? 'pass' : 'fail',
        },
        {
          label: 'Top pick',
          detail: topPicks.length > 0
            ? `${topPicks[0].event.name} — score ${topPicks[0].score}/1.00`
            : 'No events to rank',
          status: topPicks.length > 0 ? 'pass' : 'info',
        },
        {
          label: 'Agent reasoning',
          detail: agentNarrative.narrative ?? 'Agent reasoning unavailable — using deterministic scoring only',
          status: agentNarrative.narrative ? 'pass' : 'info',
        },
        ...(agentNarrative.tradeoffs?.map(t => ({
          label: 'Trade-off',
          detail: t,
          status: 'info' as const,
        })) ?? []),
      ],
      decisions: topPicks.map((r: { event: { name: string; category?: string; price?: { min: number; max: number; currency: string }; timeSlot?: { start: string; end: string } }; score: number; reasoning: string }, i: number) => {
        const agentWhy = agentNarrative.topPickReasoning?.find(a => a.eventName === r.event.name)?.why;
        return {
          title: r.event.name,
          reason: agentWhy ?? r.reasoning,
          score: r.score,
          data: { category: r.event.category, price: r.event.price, timeSlot: r.event.timeSlot },
        };
      }),
    },
  });

  const top3 = rankedEvents.slice(0, 1);

  // ── Context: ranking completed ──
  const _rankDoneCtx = contextRegistry.get(traceContext.getStore() ?? '');
  void _rankDoneCtx?.storeRankedEvents(top3.map((r) => r.event)).catch(() => {});
  void _rankDoneCtx?.updateAgentState({ agentId: 'recommendation-agent', status: 'completed', timestamp: new Date().toISOString() }).catch(() => {});
  void _rankDoneCtx?.updateWorkflowPhase('itinerary_planning').catch(() => {});

  return {
    events,
    rankedEvents: top3,
    filterStats,
    dedupStats: inputData.dedupStats,
    intentSummary,
    agentReasoning: agentNarrative.narrative ?? agentReasoning,
    recommendationNarrative: agentNarrative.narrative,
    // Thread through data needed for planning step
    constraints,
    formData: inputData.formData,
  };
}
