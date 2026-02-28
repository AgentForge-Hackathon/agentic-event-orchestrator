import { executeBookingTool, type BookingResult } from '../../tools/execute-booking.js';
import { traceContext } from '../../../tracing/index.js';
import { contextRegistry } from '../../../context/index.js';
import { emitTrace } from '../utils/trace-helpers.js';

/**
 * Mapper: Executes bookings for approved itinerary items via Actionbook.
 * Used as the `.map()` callback after the approval step.
 */
export async function executeBookings({ inputData }: { inputData: {
  events: unknown[];
  rankedEvents: unknown[] | undefined;
  filterStats: { totalInput: number; passedFilters: number; finalCount: number } | undefined;
  dedupStats: { originalCount: number; deduplicatedCount: number; removedCount: number } | undefined;
  intentSummary: string | undefined;
  agentReasoning: string | undefined;
  recommendationNarrative: string | undefined;
  itinerary: {
    items: Array<{
      id: string;
      event: {
        id: string;
        name: string;
        sourceUrl: string | null;
        source: string;
        category?: string;
        bookingRequired?: boolean;
      };
      notes?: string;
    }>;
  } | undefined;
  planMetadata: unknown | undefined;
  planWarnings: string[] | undefined;
  bookingResults?: BookingResult[] | undefined;
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
    constraints,
    formData,
  } = inputData;

  // Extract partySize from constraints (threaded from form data)
  const partySize = (constraints as Record<string, unknown> | undefined)?.partySize as number ?? 1;

  // If no itinerary or it was rejected, pass through
  if (!itinerary || !itinerary.items || itinerary.items.length === 0) {
    return { ...inputData };
  }

  const traceId = traceContext.getStore() ?? 'unknown';
  const items = itinerary.items as Array<{
    id: string;
    event: {
      id: string;
      name: string;
      sourceUrl: string | null;
      source: string;
      category?: string;
      bookingRequired?: boolean;
    };
    notes?: string;
  }>;

  // Filter to items that are real discovered events (not LLM-generated) with a valid source URL
  const bookableItems = items.filter(
    (item) => item.event.source !== 'planned' && item.event.sourceUrl && item.event.sourceUrl.trim() !== '',
  );

  if (bookableItems.length === 0) {
    console.log(`[pipeline:execution] ⏭️ No bookable items — skipping execution`);
    emitTrace({
      id: `execution-skipped-${Date.now()}`,
      type: 'booking_execution',
      name: 'No bookable items',
      status: 'booking_completed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
      metadata: {
        pipelineStep: 'execution',
        agentName: 'Execution Agent',
        agentStatus: 'No items require booking — all are generated activities',
      },
    });
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
      bookingResults: [] as BookingResult[],
    };
  }

  console.log(`[pipeline:execution] 🎯 Starting booking execution for ${bookableItems.length} items`);
  const executionStartTime = Date.now();

  emitTrace({
    id: `execution-started-${Date.now()}`,
    type: 'booking_execution',
    name: `Booking ${bookableItems.length} items…`,
    status: 'booking_started',
    startedAt: new Date().toISOString(),
    metadata: {
      pipelineStep: 'execution',
      agentName: 'Execution Agent',
      agentStatus: `Preparing to book ${bookableItems.length} items via Actionbook`,
      bookingData: {
        itemIndex: 0,
        totalItems: bookableItems.length,
        itemName: bookableItems[0]?.event.name ?? 'Unknown',
      },
    },
  });

  // ── Context: execution started ──
  const _execCtx = contextRegistry.get(traceId);
  void _execCtx?.updateAgentState({ agentId: 'execution-agent', status: 'running', timestamp: new Date().toISOString() }).catch(() => {});
  void _execCtx?.updateWorkflowPhase('booking_execution').catch(() => {});

  const bookingResults: BookingResult[] = [];

  // Fetch user profile from context (set by workflow route from Supabase)
  const userProfile = await _execCtx?.getCustomData<{
    name: string;
    email: string;
    phone: string;
    dietaryPreferences: string[];
    specialRequests: string;
  }>('userProfile') ?? { name: 'Guest', email: '', phone: '' };

  // Execute bookings sequentially (one browser at a time)
  for (let i = 0; i < bookableItems.length; i++) {
    const item = bookableItems[i]!;
    const itemStartTime = Date.now();

    console.log(`[pipeline:execution] 📋 Booking item ${i + 1}/${bookableItems.length}: ${item.event.name}`);

    emitTrace({
      id: `booking-item-${i}-${Date.now()}`,
      type: 'booking_execution',
      name: `Booking: ${item.event.name}`,
      status: 'booking_progress',
      startedAt: new Date().toISOString(),
      metadata: {
        pipelineStep: 'execution',
        agentName: 'Execution Agent',
        agentStatus: `Booking ${i + 1} of ${bookableItems.length}: ${item.event.name}`,
        bookingData: {
          itemIndex: i + 1,
          totalItems: bookableItems.length,
          itemName: item.event.name,
          sourceUrl: item.event.sourceUrl ?? undefined,
        },
      },
    });

    try {
      // Call executeBookingTool directly (not via agent — faster, more deterministic)
      const rawResult = await executeBookingTool.execute!({
        eventId: item.event.id,
        eventName: item.event.name,
        sourceUrl: item.event.sourceUrl ?? '',
        partySize,
        userProfile: {
          name: userProfile.name,
          email: userProfile.email,
          phone: userProfile.phone,
        },
        eventSource: item.event.source ?? 'unknown',
        bookingRequired: (item.event.bookingRequired as boolean) ?? true,
      }, {} as Record<string, never>);

      // Type-narrow: rawResult is ValidationError<any> | BookingResult
      if (!rawResult || !('eventId' in rawResult)) {
        bookingResults.push({
          eventId: item.event.id,
          eventName: item.event.name,
          actionType: 'book',
          status: 'failed',
          error: 'Tool returned validation error',
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const result = rawResult as BookingResult;

      const bookingResult: BookingResult = {
        eventId: result.eventId,
        eventName: result.eventName,
        actionType: result.actionType,
        status: result.status,
        confirmationNumber: result.confirmationNumber,
        screenshotPath: result.screenshotPath,
        error: typeof result.error === 'string' ? result.error : undefined,
        timestamp: result.timestamp,
      };

      bookingResults.push(bookingResult);

      const itemDuration = Date.now() - itemStartTime;
      console.log(`[pipeline:execution] ${result.status === 'success' ? '✅' : '⚠️'} Item ${i + 1}: ${result.status} (${itemDuration}ms)`);

      emitTrace({
        id: `booking-item-done-${i}-${Date.now()}`,
        type: 'booking_execution',
        name: `${result.status === 'success' ? '✅' : '⚠️'} ${item.event.name}`,
        status: result.status === 'success' ? 'booking_completed' : 'booking_failed',
        startedAt: new Date(itemStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: itemDuration,
        metadata: {
          pipelineStep: 'execution',
          agentName: 'Execution Agent',
          agentStatus: `${result.status}: ${result.confirmationNumber ?? (typeof result.error === 'string' ? result.error : 'done')}`,
          bookingData: {
            itemIndex: i + 1,
            totalItems: bookableItems.length,
            itemName: item.event.name,
            sourceUrl: item.event.sourceUrl ?? undefined,
            confirmationNumber: result.confirmationNumber,
            screenshotPath: result.screenshotPath,
            bookingError: typeof result.error === 'string' ? result.error : undefined,
            actionManualFound: result.status !== 'no_action_manual',
          },
        },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[pipeline:execution] ❌ Booking failed for ${item.event.name}:`, errMsg);

      bookingResults.push({
        eventId: item.event.id,
        eventName: item.event.name,
        actionType: 'book',
        status: 'failed',
        error: errMsg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  const executionDuration = Date.now() - executionStartTime;
  const successCount = bookingResults.filter((r) => r.status === 'success').length;
  const failedCount = bookingResults.filter((r) => r.status === 'failed').length;
  const skippedCount = bookingResults.filter((r) => ['skipped', 'no_source_url', 'no_action_manual', 'info_only'].includes(r.status)).length;

  console.log(`[pipeline:execution] 🏁 Execution complete: ${successCount} success, ${failedCount} failed, ${skippedCount} skipped (${executionDuration}ms)`);

  emitTrace({
    id: `execution-completed-${Date.now()}`,
    type: 'booking_execution',
    name: `Execution complete`,
    status: 'booking_completed',
    startedAt: new Date(executionStartTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: executionDuration,
    metadata: {
      pipelineStep: 'execution',
      agentName: 'Execution Agent',
      agentStatus: `${successCount} booked, ${failedCount} failed, ${skippedCount} skipped`,
      resultCount: bookingResults.length,
      reasoning: `Processed ${bookableItems.length} bookable items: ${successCount} successful, ${failedCount} failed, ${skippedCount} skipped/info-only`,
      reasoningSteps: bookingResults.map((r) => ({
        label: r.eventName,
        detail: r.status === 'success'
          ? `Booked successfully${r.confirmationNumber ? ` (ref: ${r.confirmationNumber})` : ''}`
          : r.error ?? r.status,
        status: r.status === 'success' ? 'pass' as const : r.status === 'failed' ? 'fail' as const : 'info' as const,
      })),
    },
  });

  // ── Context: execution completed ──
  void _execCtx?.updateAgentState({ agentId: 'execution-agent', status: 'completed', timestamp: new Date().toISOString() }).catch(() => {});
  void _execCtx?.updateWorkflowPhase('completed').catch(() => {});

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
    bookingResults,
  };
}
