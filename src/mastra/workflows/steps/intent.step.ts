import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

import {
  PlanFormDataSchema,
  EventCategorySchema,
  mapPlanFormToConstraints,
} from '../../../types/index.js';
import { searchEventbriteTool } from '../../tools/search-eventbrite.js';
import { searchEventfindaTool } from '../../tools/search-eventfinda.js';
import { traceContext } from '../../../tracing/index.js';
import { contextRegistry } from '../../../context/index.js';
import { emitTrace } from '../utils/trace-helpers.js';

export const intentStep = createStep({
  id: 'intent-understanding',
  description: 'Parses form data and uses Intent Agent LLM to enrich with category preferences',
  inputSchema: z.object({
    formData: PlanFormDataSchema,
    userQuery: z.string().optional().default(''),
  }),
  outputSchema: z.object({
    intentType: z.enum(['plan_date', 'plan_trip', 'find_events', 'book_specific', 'modify_plan']),
    constraints: z.record(z.any()),
    naturalLanguageSummary: z.string(),
    formData: z.record(z.any()),
    agentEnrichment: z.object({
      preferredCategories: z.array(EventCategorySchema).optional(),
      excludedCategories: z.array(EventCategorySchema).optional(),
      weatherSensitive: z.boolean().optional(),
      reasoning: z.string().optional(),
      confidence: z.number().optional(),
    }).optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const { formData, userQuery } = inputData;
    const intentStartTime = Date.now();

    const mapped = mapPlanFormToConstraints(formData);

    emitTrace({
      id: `intent-started-${Date.now()}`,
      type: 'workflow_step',
      name: 'Understanding your request…',
      status: 'started',
      startedAt: new Date().toISOString(),
      metadata: {
        pipelineStep: 'intent',
        agentName: 'Intent Agent',
        agentStatus: 'Analyzing your preferences…',
        inputSummary: mapped.naturalLanguageSummary,
      },
    });

    console.log(`[pipeline:intent] 🧠 Intent Agent invoked`);
    console.log(`[pipeline:intent] Input: ${mapped.naturalLanguageSummary}`);

    let agentEnrichment: {
      preferredCategories?: z.infer<typeof EventCategorySchema>[];
      excludedCategories?: z.infer<typeof EventCategorySchema>[];
      weatherSensitive?: boolean;
      reasoning?: string;
      confidence?: number;
    } | undefined;

    try {
      const intentAgent = mastra.getAgent('intentAgent');
      const prompt = `User request: ${mapped.naturalLanguageSummary}${userQuery ? `\nAdditional context: ${userQuery}` : ''}

Occasion: ${formData.occasion}
Budget: ${formData.budgetRange}
Party size: ${formData.partySize}
Time: ${formData.timeOfDay}
Duration: ${formData.duration}
Areas: ${formData.areas.join(', ')}${formData.additionalNotes ? `\nNotes: ${formData.additionalNotes}` : ''}`;

      const response = await intentAgent.generate(prompt);
      const text = response.text.trim();

      console.log(`[pipeline:intent] Agent response: ${text}`);

      try {
        const parsed = JSON.parse(text);
        agentEnrichment = {
          preferredCategories: parsed.preferredCategories,
          excludedCategories: parsed.excludedCategories,
          weatherSensitive: parsed.weatherSensitive,
          reasoning: parsed.reasoning,
          confidence: parsed.confidence,
        };
        console.log(`[pipeline:intent] Enriched categories: ${agentEnrichment.preferredCategories?.join(', ') ?? 'none'}`);
        console.log(`[pipeline:intent] Confidence: ${agentEnrichment.confidence ?? 'unknown'}`);
        console.log(`[pipeline:intent] Reasoning: ${agentEnrichment.reasoning ?? 'none'}`);
      } catch {
        console.warn(`[pipeline:intent] Failed to parse agent JSON response, using deterministic mapping only`);
      }
    } catch (err) {
      console.warn(`[pipeline:intent] Agent enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
      console.warn(`[pipeline:intent] Falling back to deterministic mapping only`);
    }

    const result = {
      intentType: mapped.intentType,
      constraints: mapped.constraints as Record<string, unknown>,
      naturalLanguageSummary: mapped.naturalLanguageSummary,
      formData: formData as unknown as Record<string, unknown>,
      agentEnrichment,
    };

    const intentDuration = Date.now() - intentStartTime;
    const categoriesStr = agentEnrichment?.preferredCategories?.join(', ') ?? 'general';
    const confidenceVal = agentEnrichment?.confidence;

    emitTrace({
      id: `intent-completed-${Date.now()}`,
      type: 'workflow_step',
      name: 'Intent understood',
      status: 'completed',
      startedAt: new Date(intentStartTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: intentDuration,
      metadata: {
        pipelineStep: 'intent',
        agentName: 'Intent Agent',
        agentStatus: 'Done — handing off to Discovery Agent',
        reasoning: agentEnrichment?.reasoning ?? `Mapped request to ${result.intentType} with categories: ${categoriesStr}`,
        confidence: confidenceVal,
        inputSummary: mapped.naturalLanguageSummary,
        outputSummary: `Type: ${result.intentType} | Categories: ${categoriesStr}`,
        reasoningSteps: [
          {
            label: 'Occasion analysis',
            detail: `Identified "${formData.occasion}" → intent type "${result.intentType}"`,
            status: 'pass' as const,
          },
          {
            label: 'Category mapping',
            detail: categoriesStr !== 'general'
              ? `Matched categories: ${categoriesStr}`
              : 'No specific category match — using general discovery',
            status: categoriesStr !== 'general' ? 'pass' : 'info',
          },
          {
            label: 'Budget constraint',
            detail: formData.budgetRange
              ? `Budget range "${formData.budgetRange}" applied as filter`
              : 'No budget constraint specified',
            status: 'info' as const,
          },
          {
            label: 'LLM enrichment',
            detail: agentEnrichment
              ? `GPT-4o-mini enriched with confidence ${Math.round((confidenceVal ?? 0) * 100)}%`
              : 'Skipped — using deterministic mapping only',
            status: agentEnrichment ? 'pass' : 'info',
          },
        ],
      },
    });

    console.log(`[pipeline:intent] ✅ Intent resolved: ${result.intentType}`);

    // ── Context: intent completed ──
    const _intentCtx = contextRegistry.get(traceContext.getStore() ?? '');
    void _intentCtx?.updateAgentState({ agentId: 'intent-agent', status: 'completed', timestamp: new Date().toISOString() }).catch(() => {});
    void _intentCtx?.updateWorkflowPhase('event_discovery').catch(() => {});
    return result;
  },
});

export const searchEventbriteStep = createStep(searchEventbriteTool);
export const searchEventfindaStep = createStep(searchEventfindaTool);
