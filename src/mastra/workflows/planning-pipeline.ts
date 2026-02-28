import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import {
  PlanFormDataSchema,
  EventSchema,
  ItinerarySchema,
} from '../../types/index.js';

import { intentStep, searchEventbriteStep, searchEventfindaStep } from './steps/intent.step.js';
import { prepareDiscoveryInput, mergeAndDeduplicateEvents } from './steps/discovery.step.js';
import { rankAndRecommend } from './steps/ranking.step.js';
import { planItinerary } from './steps/planning.step.js';
import { awaitApproval } from './steps/approval.step.js';
import { executeBookings } from './steps/execution.step.js';

export const planningPipelineWorkflow = createWorkflow({
  id: 'planning-pipeline',
  inputSchema: z.object({
    formData: PlanFormDataSchema,
    userQuery: z.string().optional().default(''),
  }),
  outputSchema: z.object({
    events: z.array(EventSchema),
    rankedEvents: z.array(
      z.object({
        event: EventSchema,
        score: z.number(),
        reasoning: z.string(),
      }),
    ).optional(),
    filterStats: z.object({
      totalInput: z.number(),
      passedFilters: z.number(),
      finalCount: z.number(),
    }).optional(),
    intentSummary: z.string().optional(),
    agentReasoning: z.string().optional(),
    recommendationNarrative: z.string().optional(),
    dedupStats: z.object({
      originalCount: z.number(),
      deduplicatedCount: z.number(),
      removedCount: z.number(),
    }).optional(),
    itinerary: ItinerarySchema.optional(),
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
    }).optional(),
    planWarnings: z.array(z.string()).optional(),
    bookingResults: z.array(z.object({
      eventId: z.string(),
      eventName: z.string(),
      actionType: z.enum(['check_availability', 'reserve', 'book', 'register', 'info_only']),
      status: z.enum([
        'success', 'failed', 'skipped', 'sold_out', 'login_required',
        'captcha_blocked', 'payment_required', 'page_error', 'timeout',
        'no_action_manual', 'no_source_url',
      ]),
      confirmationNumber: z.string().optional(),
      screenshotPath: z.string().optional(),
      error: z.string().optional(),
      timestamp: z.string(),
    })).optional(),
  }),
})
  .then(intentStep)

  .map(async ({ inputData }) => prepareDiscoveryInput({ inputData }))

  .parallel([searchEventbriteStep, searchEventfindaStep])

  .map(async ({ inputData, getStepResult }) => mergeAndDeduplicateEvents({ inputData, getStepResult }))

  // Step 3: Recommendation / Ranking
  .map(async ({ inputData }) => rankAndRecommend({ inputData }))

  // Step 4: Itinerary Planning
  .map(async ({ inputData, mastra }) => planItinerary({ inputData, mastra }))

  // Step 5: Plan Approval Gate
  .map(async ({ inputData }) => awaitApproval({ inputData }))

  // Step 6: Booking Execution
  .map(async ({ inputData }) => executeBookings({ inputData }))

  .commit();
