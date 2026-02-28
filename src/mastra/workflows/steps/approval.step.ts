import type { BookingResult } from '../../tools/execute-booking.js';
import { traceContext } from '../../../tracing/index.js';
import { contextRegistry } from '../../../context/index.js';
import { waitForApproval } from '../../../api/approval-registry.js';
import { emitTrace } from '../utils/trace-helpers.js';

/**
 * Mapper: Pauses the pipeline and waits for user approval of the generated itinerary.
 * Used as the `.map()` callback after the planning step.
 */
export async function awaitApproval({ inputData }: { inputData: {
  events: unknown[];
  rankedEvents: unknown[] | undefined;
  filterStats: { totalInput: number; passedFilters: number; finalCount: number } | undefined;
  dedupStats: { originalCount: number; deduplicatedCount: number; removedCount: number } | undefined;
  intentSummary: string | undefined;
  agentReasoning: string | undefined;
  recommendationNarrative: string | undefined;
  itinerary: {
    id: string;
    name: string;
    date: string;
    items: Array<{
      id: string;
      event: {
        name: string;
        category?: string;
        location: { name: string; address: string };
        price?: { min: number; max: number; currency: string };
      };
      scheduledTime: { start: string; end: string };
      notes?: string;
    }>;
    totalCost: number;
    totalDuration: number;
  } | undefined;
  planMetadata: {
    itineraryName: string;
    overallVibe?: string;
    practicalTips?: string[];
    budgetStatus: string;
    budgetNotes?: string;
    totalEstimatedCostPerPerson: number;
    itemCount: number;
    mainEventCount?: number;
  } | undefined;
  planWarnings: string[] | undefined;
  constraints?: Record<string, unknown>;
  formData?: Record<string, unknown>;
} }) {
  const {
    events,
    rankedEvents,
    filterStats,
    dedupStats,
    intentSummary,
    agentReasoning,
    recommendationNarrative,
    itinerary,
    planMetadata,
    planWarnings,
  } = inputData;

  // If no itinerary was generated, skip approval gate
  if (!itinerary) {
    console.log(`[pipeline:approval] ⏭️ No itinerary — skipping approval gate`);
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
      planWarnings,
      constraints: inputData.constraints,
      formData: inputData.formData,
    };
  }

  const traceId = traceContext.getStore() ?? 'unknown';
  const formData = inputData.formData as Record<string, unknown> | undefined;
  const constraints = inputData.constraints as Record<string, unknown> | undefined;
  const occasion = (formData?.occasion as string) ?? 'outing';
  const partySize = (constraints?.partySize as number) ?? 1;
  const budgetMax = (constraints?.budget as Record<string, unknown>)?.max as number | undefined;

  console.log(`[pipeline:approval] ⏸️  Awaiting user approval for itinerary: ${planMetadata?.itineraryName ?? 'unnamed'}`);

  // Emit the approval trace event with full itinerary data
  emitTrace({
    id: `approval-required-${Date.now()}`,
    type: 'plan_approval',
    name: 'Plan ready for approval',
    status: 'awaiting_approval',
    startedAt: new Date().toISOString(),
    metadata: {
      pipelineStep: 'planning',
      agentName: 'Planning Agent',
      agentStatus: 'Waiting for your approval…',
      approvalData: {
        itinerary: {
          id: itinerary.id,
          name: itinerary.name,
          date: itinerary.date,
          items: itinerary.items.map((item) => ({
            id: item.id,
            event: {
              name: item.event.name,
              category: item.event.category ?? 'activity',
              location: { name: item.event.location.name, address: item.event.location.address },
              price: item.event.price,
            },
            scheduledTime: item.scheduledTime,
            notes: item.notes,
          })),
          totalCost: itinerary.totalCost,
          totalDuration: itinerary.totalDuration,
        },
        planMetadata: {
          itineraryName: planMetadata?.itineraryName ?? itinerary.name,
          overallVibe: planMetadata?.overallVibe,
          practicalTips: planMetadata?.practicalTips,
          budgetStatus: planMetadata?.budgetStatus ?? 'unknown',
          budgetNotes: planMetadata?.budgetNotes,
          totalEstimatedCostPerPerson: planMetadata?.totalEstimatedCostPerPerson ?? itinerary.totalCost,
          itemCount: planMetadata?.itemCount ?? itinerary.items.length,
        },
        occasion,
        partySize,
        budgetMax,
      },
    },
  });

  // Wait for user approval (Promise resolves when POST /api/workflow/:id/approve is called)
  const approved = await waitForApproval(traceId);

  if (approved) {
    console.log(`[pipeline:approval] ✅ User approved the plan`);
    emitTrace({
      id: `approval-approved-${Date.now()}`,
      type: 'plan_approval',
      name: 'Plan approved',
      status: 'approved',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
      metadata: {
        pipelineStep: 'planning',
        agentName: 'Planning Agent',
        agentStatus: 'Plan approved — proceeding to execution',
      },
    });
  } else {
    console.log(`[pipeline:approval] ❌ User rejected the plan`);
    emitTrace({
      id: `approval-rejected-${Date.now()}`,
      type: 'plan_approval',
      name: 'Plan rejected',
      status: 'rejected',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
      metadata: {
        pipelineStep: 'planning',
        agentName: 'Planning Agent',
        agentStatus: 'Plan rejected by user',
      },
    });

    // Return early — pipeline stops here
    const _rejectCtx = contextRegistry.get(traceId);
    void _rejectCtx?.updateWorkflowPhase('completed').catch(() => {});
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
      planWarnings: ['Plan rejected by user'],
      bookingResults: undefined as BookingResult[] | undefined,
      constraints,
      formData,
    };
  }

  // Approved — continue pipeline with full data
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
    planWarnings,
    bookingResults: undefined as BookingResult[] | undefined,
    constraints,
    formData,
  };
}
