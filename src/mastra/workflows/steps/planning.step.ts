import type { Event, Itinerary } from '../../../types/index.js';
import { planItineraryTool } from '../../tools/plan-itinerary.js';
import { traceContext } from '../../../tracing/index.js';
import { contextRegistry } from '../../../context/index.js';
import { emitTrace, formatSGT, planningStartTimes } from '../utils/trace-helpers.js';
import { TIME_OF_DAY_WINDOWS, OCCASION_DEFAULT_WINDOWS, FLEXIBLE_FALLBACK, DURATION_HOURS, MAX_GAP_MINUTES } from '../utils/constants.js';

/**
 * Mapper: Generates an itinerary plan from ranked events using the Planning Agent.
 * Used as the `.map()` callback after the ranking step.
 */
export async function planItinerary({ inputData, mastra }: { inputData: {
  events: unknown[];
  rankedEvents: { event: Event; score: number; reasoning?: string }[] | undefined;
  filterStats: { totalInput: number; passedFilters: number; finalCount: number } | undefined;
  dedupStats: { originalCount: number; deduplicatedCount: number; removedCount: number } | undefined;
  intentSummary: string | undefined;
  agentReasoning: string | undefined;
  recommendationNarrative: string | undefined;
  constraints: Record<string, unknown> | undefined;
  formData: Record<string, unknown> | undefined;
}; mastra: { getAgent: (id: string) => { generate: (prompt: string) => Promise<{ text: string }> } } }) {
  const {
    events,
    rankedEvents,
    filterStats,
    dedupStats,
    intentSummary,
    agentReasoning,
    recommendationNarrative,
    constraints,
    formData,
  } = inputData;

  // If no ranked events, skip planning
  if (!rankedEvents || rankedEvents.length === 0) {
    console.log(`[pipeline:planning] ⏭️ No ranked events — skipping itinerary planning`);
    return {
      events,
      rankedEvents,
      filterStats,
      dedupStats,
      intentSummary,
      agentReasoning,
      recommendationNarrative,
      itinerary: undefined,
      planMetadata: undefined,
      planWarnings: undefined,
    };
  }

  const planningStartTime = Date.now();
  const traceId = traceContext.getStore() ?? 'unknown';
  planningStartTimes.set(traceId, planningStartTime);

  // ── Context: planning agent starting ──
  const _planStartCtx = contextRegistry.get(traceId);
  void _planStartCtx?.updateAgentState({ agentId: 'planning-agent', status: 'running', timestamp: new Date().toISOString() }).catch(() => {});

  // Extract planning inputs
  const budgetMax = (constraints?.budget as Record<string, unknown>)?.max as number | undefined;
  const partySize = (constraints?.partySize as number) ?? 1;
  const date = (formData?.date as string) ?? new Date().toISOString().split('T')[0];
  const occasion = (formData?.occasion as string) ?? 'outing';
  const timeOfDay = (formData?.timeOfDay as string) ?? 'flexible';
  const duration = (formData?.duration as string) ?? 'half_day';
  const areas = (formData?.areas as string[]) ?? [];
  const additionalNotes = (formData?.additionalNotes as string) ?? '';

  console.log(`[pipeline:planning] 📋 Planning itinerary around top event: ${rankedEvents[0].event.name}`);
  console.log(`[pipeline:planning]   Budget: $${budgetMax ?? '∞'}/person | Party: ${partySize} | Date: ${date}`);
  console.log(`[pipeline:planning]   Time: ${timeOfDay} | Duration: ${duration} | Areas: ${areas.join(', ') || 'anywhere'}`);

  emitTrace({
    id: `planning-started-${Date.now()}`,
    type: 'workflow_step',
    name: 'Planning your itinerary…',
    status: 'started',
    startedAt: new Date(planningStartTime).toISOString(),
    metadata: {
      pipelineStep: 'planning',
      agentName: 'Planning Agent',
      agentStatus: 'Designing your perfect day plan…',
      inputSummary: `Top event: ${rankedEvents[0].event.name} | Budget: $${budgetMax ?? '∞'}/person | ${timeOfDay} ${duration.replace(/_/g, ' ')}`,
    },
  });

  // Build the prompt for the planning agent
  const topEventsDescription = rankedEvents.map((r: { event: Event; score: number; reasoning?: string }, i: number) => {
    const e = r.event;
    const priceStr = e.price ? `$${e.price.min}-${e.price.max} SGD` : 'free/unknown';
    const startSGT = e.timeSlot ? formatSGT(e.timeSlot.start) : null;
    const endSGT = e.timeSlot ? formatSGT(e.timeSlot.end) : null;
    const timeStr = startSGT && endSGT ? `${startSGT} - ${endSGT} SGT` : 'time flexible';
    return `${i + 1}. EXACT EVENT NAME: "${e.name}"
   Category: ${e.category}
   Location: ${e.location.name}, ${e.location.address}
   ⏰ EXACT TIME SLOT (copy these EXACTLY for startTime/endTime): startTime="${startSGT ?? 'flexible'}" endTime="${endSGT ?? 'flexible'}"
   Time (readable): ${timeStr}
   Price: ${priceStr}/person
   Rating: ${e.rating ?? 'unrated'}/5
   Score: ${r.score}/1.00
   Why: ${r.reasoning ?? 'Top pick'}`;
  }).join('\n\n');

  const timeWindow = timeOfDay === 'flexible' ? (OCCASION_DEFAULT_WINDOWS[occasion] ?? FLEXIBLE_FALLBACK) : (TIME_OF_DAY_WINDOWS[timeOfDay] ?? FLEXIBLE_FALLBACK);
  const totalGroupBudget = budgetMax != null ? budgetMax * partySize : undefined;

  const maxHours = DURATION_HOURS[duration] ?? 4;

  const planningPrompt = `Plan a complete ${occasion.replace(/_/g, ' ')} itinerary for ${date}.

TIME WINDOW: ${timeWindow.label} (${timeWindow.range}) — all activities MUST start and end within this window.
TOTAL PLAN DURATION: The entire plan (first activity start to last activity end) MUST NOT exceed ${maxHours} hours. This is a hard limit — do NOT spread activities across the full time window.
SCHEDULING RULE: Keep activities tightly clustered. Maximum ${MAX_GAP_MINUTES} minutes of idle/free time between any two consecutive activities (including travel). Aim for 15-30 minute gaps.

PARTY: ${partySize} ${partySize === 1 ? 'person' : 'people'}
BUDGET: $${budgetMax ?? 'unlimited'} per person (total group budget: $${totalGroupBudget ?? 'unlimited'} for ${partySize} ${partySize === 1 ? 'person' : 'people'})

PREFERRED AREAS: ${areas.join(', ') || 'anywhere in Singapore'}
${additionalNotes ? `NOTES: ${additionalNotes}` : ''}
${recommendationNarrative ? `RECOMMENDATION CONTEXT: ${recommendationNarrative}` : ''}

TOP RANKED EVENT (anchor your entire plan around this one event):
${topEventsDescription}

REMINDER: For the main event item, you MUST set:
- "name" to the EXACT EVENT NAME shown above (in quotes)
- "startTime" and "endTime" to the EXACT values shown in the ⏰ EXACT TIME SLOT above
- "isMainEvent" to true

Generate 3-4 total items (including the main event). All activities must end by 23:00. Create complementary activities matching the ${occasion.replace(/_/g, ' ')} vibe. All times in SGT (UTC+8). Keep the total span under ${maxHours} hours — schedule activities close together, not spread across the day.`;

  console.log(`[pipeline:planning] 🤖 Planning Agent generating itinerary…`);

  let llmPlan: Record<string, unknown> | undefined;

  try {
    const planAgent = mastra.getAgent('planningAgent');
    const response = await planAgent.generate(planningPrompt);
    const text = response.text.trim();

    console.log(`[pipeline:planning] Agent response length: ${text.length} chars`);

    try {
      llmPlan = JSON.parse(text);
      const planName = (llmPlan as Record<string, unknown>)?.itineraryName ?? 'unnamed';
      const planItems = (llmPlan as Record<string, unknown>)?.items;
      console.log(`[pipeline:planning] Parsed plan: "${planName}" with ${Array.isArray(planItems) ? planItems.length : 0} items`);
    } catch {
      console.warn(`[pipeline:planning] Failed to parse agent JSON — trying to extract JSON from response`);
      // Try to extract JSON from markdown fencing or surrounding text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          llmPlan = JSON.parse(jsonMatch[0]);
          const planName = (llmPlan as Record<string, unknown>)?.itineraryName ?? 'unnamed';
          console.log(`[pipeline:planning] Extracted JSON plan: "${planName}"`);
        } catch {
          console.error(`[pipeline:planning] Could not extract valid JSON from agent response`);
        }
      }
    }
  } catch (err) {
    console.error(`[pipeline:planning] Planning agent failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Validate and structure with the tool ──
  let itinerary: Itinerary | undefined;
  let planMetadata: {
    itineraryName: string;
    overallVibe?: string;
    practicalTips?: string[];
    weatherConsideration?: string;
    budgetStatus: string;
    budgetNotes?: string;
    totalEstimatedCostPerPerson: number;
    itemCount: number;
    mainEventCount: number;
    generatedActivityCount: number;
  } | undefined;
  let planWarnings: string[] = [];

  if (llmPlan) {
    try {
      const toolResult = await planItineraryTool.execute!(
        {
          llmPlan,
          rankedEvents,
          date,
          budgetMax,
          partySize,
          occasion,
        },
        {} as Record<string, never>,
      );

      if (toolResult && 'itinerary' in toolResult) {
        const result = toolResult as unknown as {
          itinerary: Itinerary;
          planMetadata: {
            itineraryName: string;
            overallVibe?: string;
            practicalTips?: string[];
            weatherConsideration?: string;
            budgetStatus: string;
            budgetNotes?: string;
            totalEstimatedCostPerPerson: number;
            itemCount: number;
            mainEventCount: number;
            generatedActivityCount: number;
          };
          warnings: string[];
        };
        itinerary = result.itinerary;
        planMetadata = result.planMetadata;
        planWarnings = result.warnings;

        console.log(`[pipeline:planning] ✅ Itinerary built: ${result.planMetadata?.itemCount} items`);
      } else {
        console.warn(`[pipeline:planning] Tool returned unexpected result:`, JSON.stringify(toolResult, null, 2));
        planWarnings.push('Itinerary tool returned unexpected result');
      }
    } catch (err) {
      console.error(`[pipeline:planning] Tool execution failed: ${err instanceof Error ? err.message : String(err)}`);
      planWarnings.push(`Tool failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    planWarnings.push('Planning agent did not return a valid plan — itinerary unavailable');
  }

  const planningDuration = Date.now() - planningStartTime;
  planningStartTimes.delete(traceId);

  // Build trace with planning results
  const itemCount = planMetadata?.itemCount ?? 0;
  const mainCount = planMetadata?.mainEventCount ?? 0;
  const genCount = planMetadata?.generatedActivityCount ?? 0;

  emitTrace({
    id: `planning-completed-${Date.now()}`,
    type: 'workflow_step',
    name: itinerary ? `${itemCount}-stop itinerary ready` : 'Planning incomplete',
    status: itinerary ? 'completed' : 'error',
    startedAt: new Date(planningStartTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: planningDuration,
    metadata: {
      pipelineStep: 'planning',
      agentName: 'Planning Agent',
      agentStatus: itinerary ? 'Done — itinerary ready for review' : 'Failed — could not generate itinerary',
      resultCount: itemCount,
      reasoning: planMetadata?.overallVibe ?? `Built ${itemCount}-activity itinerary (${mainCount} main events, ${genCount} complementary activities)`,
      confidence: itinerary ? 0.85 : 0.2,
      outputSummary: itinerary
        ? itinerary.items.map((item: { event: { name: string }; scheduledTime: { start: string } }, i: number) => {
            const time = formatSGT(item.scheduledTime.start);
            return `${i + 1}. ${time} — ${item.event.name}`;
          }).join('\n')
        : 'No itinerary generated',
      reasoningSteps: [
        {
          label: 'LLM plan generation',
          detail: llmPlan ? `Generated plan: "${planMetadata?.itineraryName ?? 'unnamed'}"` : 'Agent failed to produce valid plan',
          status: llmPlan ? 'pass' : 'fail',
        },
        {
          label: 'Schema validation',
          detail: itinerary ? `Validated ${itemCount} items against ItinerarySchema` : 'Validation failed or skipped',
          status: itinerary ? 'pass' : 'fail',
        },
        {
          label: 'Budget check',
          detail: planMetadata
            ? `$${planMetadata.totalEstimatedCostPerPerson}/person — ${planMetadata.budgetStatus.replace(/_/g, ' ')}`
            : 'Budget check skipped',
          status: planMetadata?.budgetStatus === 'within_budget' ? 'pass' : planMetadata?.budgetStatus === 'slightly_over' ? 'info' : planMetadata ? 'fail' : 'info',
        },
        {
          label: 'Activity mix',
          detail: planMetadata
            ? `${mainCount} main event(s) + ${genCount} complementary activities`
            : 'No activities planned',
          status: genCount > 0 ? 'pass' : 'info',
        },
        ...(planWarnings.map(w => ({
          label: 'Warning',
          detail: w,
          status: 'info' as const,
        }))),
      ],
      decisions: itinerary?.items.map((item: { event: { name: string; category?: string; price?: { min: number; max: number; currency: string } }; scheduledTime: { start: string; end: string }; notes?: string }) => ({
        title: item.event.name,
        reason: item.notes ?? `${item.event.category ?? 'activity'} at ${formatSGT(item.scheduledTime.start)} SGT`,
        score: undefined,
        data: {
          category: item.event.category,
          price: item.event.price,
          scheduledStart: item.scheduledTime.start,
          scheduledEnd: item.scheduledTime.end,
          scheduledTimeSGT: `${formatSGT(item.scheduledTime.start)} – ${formatSGT(item.scheduledTime.end)}`,
        },
      })),
    },
  });

  // ── Context: planning completed ──
  const _planDoneCtx = contextRegistry.get(traceContext.getStore() ?? '');
  if (itinerary) {
    void _planDoneCtx?.storeItinerary(itinerary).catch(() => {});
  }
  void _planDoneCtx?.updateAgentState({ agentId: 'planning-agent', status: itinerary ? 'completed' : 'failed', timestamp: new Date().toISOString() }).catch(() => {});
  void _planDoneCtx?.updateWorkflowPhase('plan_approval').catch(() => {});

  return {
    events,
    rankedEvents,
    filterStats,
    dedupStats,
    intentSummary,
    agentReasoning,
    recommendationNarrative,
    itinerary,
    planMetadata,
    planWarnings: planWarnings.length > 0 ? planWarnings : undefined,
  };
}
