import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  searchActionManuals,
  getActionManual,
  browserOpen,
  browserClick,
  browserFill,
  browserSelect,
  browserPress,
  browserWait,
  browserScreenshot,
  browserSnapshot,
  browserText,
  browserClose,
  browserClickByText,
  browserFillInFrame,
  browserFillByLabel,
  browserClickInFrame,
  browserEval,
  extractDomain,
  buildSearchQuery,
} from '../../lib/actionbook.js';

// ── Individual Browser Tools (for Execution Agent tool-call interface) ──

export const browserOpenTool = createTool({
  id: 'browser-open',
  description: 'Open a URL in the Actionbook browser. Use this as the first step to navigate to a booking page.',
  inputSchema: z.object({
    url: z.string().url().describe('The URL to open in the browser'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ url }) => {
    return browserOpen(url);
  },
});

export const browserSnapshotTool = createTool({
  id: 'browser-snapshot',
  description: 'Get a DOM snapshot of the current page. Returns structured text for analyzing page structure, form fields, and buttons.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async () => {
    return browserSnapshot();
  },
});

export const browserClickTool = createTool({
  id: 'browser-click',
  description: 'Click an element on the page by CSS selector. Use selectors from the action manual or page snapshot.',
  inputSchema: z.object({
    selector: z.string().describe('CSS or XPath selector of the element to click'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ selector }) => {
    return browserClick(selector);
  },
});

export const browserFillTool = createTool({
  id: 'browser-fill',
  description: 'Fill an input field with a value. Use for name, email, phone, and other form fields.',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector of the input field'),
    value: z.string().describe('Value to type into the field'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ selector, value }) => {
    return browserFill(selector, value);
  },
});

export const browserSelectTool = createTool({
  id: 'browser-select',
  description: 'Select an option from a dropdown/select element.',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector of the select element'),
    value: z.string().describe('Value of the option to select'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ selector, value }) => {
    return browserSelect(selector, value);
  },
});

export const browserPressTool = createTool({
  id: 'browser-press',
  description: 'Press a keyboard key. Useful for Enter, Tab, Escape, etc.',
  inputSchema: z.object({
    key: z.string().describe('Key to press (e.g., "Enter", "Tab", "Escape")'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ key }) => {
    return browserPress(key);
  },
});

export const browserWaitTool = createTool({
  id: 'browser-wait',
  description: 'Wait for an element to appear on the page. Use after clicking a button to wait for the next page/section to load.',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector to wait for'),
    timeoutMs: z.number().default(10000).describe('Maximum wait time in milliseconds'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ selector, timeoutMs }) => {
    return browserWait(selector, timeoutMs);
  },
});

export const browserScreenshotTool = createTool({
  id: 'browser-screenshot',
  description: 'Take a screenshot of the current page. Use after completing a booking to capture the confirmation.',
  inputSchema: z.object({
    outputPath: z.string().describe('File path to save the screenshot'),
    fullPage: z.boolean().default(false).describe('Capture the full page including scrolled content'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ outputPath, fullPage }) => {
    return browserScreenshot(outputPath, fullPage);
  },
});

export const browserTextTool = createTool({
  id: 'browser-text',
  description: 'Get the text content of the current page. Useful for extracting confirmation numbers or checking page state.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async () => {
    return browserText();
  },
});

export const browserEvalTool = createTool({
  id: 'browser-eval',
  description: 'Evaluate JavaScript on the current page. Use for clicking elements by text content, extracting data, or any DOM manipulation that CSS selectors cannot handle.',
  inputSchema: z.object({
    expression: z.string().describe('JavaScript expression to evaluate on the page. Must be a valid JS expression that returns a value.'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ expression }) => {
    return browserEval(expression);
  },
});

export const browserCloseTool = createTool({
  id: 'browser-close',
  description: 'Close the browser. Call this after all bookings are complete.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  execute: async () => {
    return browserClose();
  },
});

// ── Orchestrator Tool (called by pipeline, uses agent internally) ──

/**
 * Booking result for a single itinerary item.
 */
const BookingResultSchema = z.object({
  eventId: z.string(),
  eventName: z.string(),
  actionType: z.enum(['check_availability', 'reserve', 'book', 'register', 'info_only']),
  status: z.enum([
    'success',
    'failed',
    'skipped',
    'sold_out',
    'waitlist',
    'login_required',
    'captcha_blocked',
    'payment_required',
    'custom_fields_required',
    'page_error',
    'timeout',
    'no_action_manual',
    'no_source_url',
  ]),
  confirmationNumber: z.string().optional(),
  screenshotPath: z.string().optional(),
  error: z.string().optional(),
  timestamp: z.string(),
});

export type BookingResult = z.infer<typeof BookingResultSchema>;

// ── Booking Flow Helper Types ──

type BlockingStatus = 'sold_out' | 'waitlist' | 'captcha_blocked' | 'login_required' | null;

interface UserProfile {
  name: string;
  email: string;
  phone?: string;
  dietaryPreferences?: string[];
  specialRequests?: string;
}

// ── Step Helpers ──

/**
 * Steps 1–2: Search for an action manual and fetch the detailed version if found.
 * Returns { hasManual, detailedManual }.
 */
async function fetchActionManual(
  sourceUrl: string,
  eventSource: string,
  eventName: string,
): Promise<{ hasManual: boolean; detailedManual: string }> {
  console.log(`[booking] Step 1: Searching action manuals for "${eventName}" (${eventSource})`);
  const domain = extractDomain(sourceUrl);
  const searchQuery = buildSearchQuery(eventSource, 'book');
  const actionManualText = await searchActionManuals(searchQuery, {
    domain: domain ?? undefined,
    background: `Booking event: ${eventName}. URL: ${sourceUrl}`,
  });

  const hasManual = !actionManualText.includes('No action manuals found');
  console.log(`[booking] Action manual ${hasManual ? 'found' : 'NOT found'} for ${domain ?? eventSource}`);

  let detailedManual = '';
  if (hasManual && domain) {
    console.log(`[booking] Step 2: Getting detailed action manual for ${domain}`);
    const areaId = `${domain}:/:default`;
    detailedManual = await getActionManual(areaId);
  }

  return { hasManual, detailedManual };
}

/**
 * Checks the page snapshot for common blocking conditions.
 * Returns the blocking status or null if the page looks bookable.
 */
function checkBlockingConditions(snapshotLower: string): BlockingStatus {
  if (
    snapshotLower.includes('sold out') ||
    snapshotLower.includes('sold_out') ||
    snapshotLower.includes('no tickets available')
  ) {
    return 'sold_out';
  }

  if (
    snapshotLower.includes('join waitlist') ||
    snapshotLower.includes('join the waitlist') ||
    snapshotLower.includes('waitlist only') ||
    snapshotLower.includes('add to waitlist')
  ) {
    return 'waitlist';
  }

  if (
    snapshotLower.includes('captcha') ||
    snapshotLower.includes('recaptcha') ||
    snapshotLower.includes('hcaptcha')
  ) {
    return 'captcha_blocked';
  }

  if (
    snapshotLower.includes('must sign in') ||
    snapshotLower.includes('please log in') ||
    snapshotLower.includes('login required')
  ) {
    return 'login_required';
  }

  return null;
}

/**
 * Clicks the ticket quantity "+" stepper (partySize - 1) times to reach the desired count.
 * Default ticket count on Eventbrite is 1, so we increment from there.
 */
async function adjustTicketQuantity(partySize: number): Promise<void> {
  if (partySize <= 1) return;

  console.log(`[booking] Adjusting ticket quantity to ${partySize} (clicking + ${partySize - 1} times)`);
  for (let q = 0; q < partySize - 1; q++) {
    // Find and click the "+" / increment button in the ticket stepper
    // Searches both main document and iframes (Eventbrite renders checkout in an iframe)
    const incrResult = await browserEval(`(() => {
      function findInc(doc) {
        // Strategy 1: aria-label based (most reliable)
        var btn = doc.querySelector('button[aria-label*="Increase"]') || doc.querySelector('button[aria-label*="increase"]') || doc.querySelector('button[aria-label*="Add"]');
        if (btn) return btn;
        // Strategy 2: find "+" text button near a quantity input/display
        var btns = Array.from(doc.querySelectorAll('button'));
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').trim();
          if (t === '+' || t === '＋') { return btns[i]; }
        }
        // Strategy 3: data-testid patterns
        btn = doc.querySelector('[data-testid*="increase"]') || doc.querySelector('[data-testid*="increment"]') || doc.querySelector('[data-testid*="plus"]');
        if (btn) return btn;
        return null;
      }
      // Check main document
      var el = findInc(document);
      if (el) { el.click(); return 'clicked_main'; }
      // Check iframes
      var iframes = Array.from(document.querySelectorAll('iframe'));
      for (var i = 0; i < iframes.length; i++) {
        try {
          el = findInc(iframes[i].contentDocument);
          if (el) { el.click(); return 'clicked_iframe'; }
        } catch(e) {}
      }
      return 'not_found';
    })()`);

    if (incrResult.success && incrResult.output.includes('clicked')) {
      console.log(`[booking] Clicked + (${q + 1}/${partySize - 1})`);
    } else {
      console.log(`[booking] Could not find + button on attempt ${q + 1} — stepper may not be present`);
      break;
    }
    // Small delay between clicks to let the UI update
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  // Wait for quantity to settle before proceeding
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Phase A + B: Fill known form fields by CSS selector, then fill custom fields by label text.
 * Returns true if any field was filled.
 */
async function fillFormFields(userProfile: UserProfile, step: number): Promise<boolean> {
  // Split name safely: single-word names use full name for both first and last
  const nameParts = userProfile.name.trim().split(/\s+/);
  const firstName = nameParts[0] || userProfile.name;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  // Phase A: Fill known form fields by CSS selector
  const formFieldMap: [string[], string][] = [
    // Eventbrite buyer/attendee form (both buyer.N-* and ticketTypeId.N-* patterns)
    [['input[name="buyer.N-first_name"]', 'input[id="buyer.N-first_name"]', 'input[name$="N-first_name"]'], firstName],
    [['input[name="buyer.N-last_name"]', 'input[id="buyer.N-last_name"]', 'input[name$="N-last_name"]'], lastName || firstName],
    [['input[name="buyer.N-email"]', 'input[id="buyer.N-email"]', 'input[name$="N-email"]'], userProfile.email],
    [['input[name="buyer.confirmEmailAddress"]', 'input[id="buyer.confirmEmailAddress"]', 'input[name$="confirmEmailAddress"]'], userProfile.email],
    // Generic form selectors
    [['input[name="name"]', 'input[name="full_name"]', 'input[name="first_name"]', '#name'], userProfile.name],
    [['input[name="email"]', 'input[type="email"]:not([name*="confirm"])'], userProfile.email],
    [['input[name="phone"]', 'input[type="tel"]', '#phone'], userProfile.phone ?? ''],
  ];

  let anyFilled = false;
  for (const [selectors, value] of formFieldMap) {
    if (!value) continue;
    const fillResult = await browserFillInFrame(selectors, value);
    if (fillResult.success) {
      console.log(`[booking] Step ${step}: Filled ${fillResult.output}`);
      anyFilled = true;
    }
  }

  // Phase B: Fill organizer-specific custom fields by label text
  // These fields have unpredictable names like "22622368989.U-319798808"
  // so we match by label text instead
  const labelFieldMap: [string, string][] = [
    ['phone', userProfile.phone ?? '+6500000000'],
    ['tel', userProfile.phone ?? '+6500000000'],
    ['telephone', userProfile.phone ?? '+6500000000'],
    ['mobile', userProfile.phone ?? '+6500000000'],
    ['contact number', userProfile.phone ?? '+6500000000'],
    ['first name', firstName],
    ['last name', lastName || firstName],
    ['email', userProfile.email],
    ['name', userProfile.name],
  ];

  const labelFillResult = await browserFillByLabel(labelFieldMap);
  if (labelFillResult.filledCount > 0) {
    console.log(`[booking] Step ${step}: Filled ${labelFillResult.filledCount} fields by label`);
    anyFilled = true;
  }

  return anyFilled;
}

/**
 * Phase C: Click a proceed/submit/register button.
 * Tries CSS selectors in iframes first, falls back to text matching.
 * Returns true if a button was clicked.
 */
async function clickProceedButton(step: number): Promise<boolean> {
  // Try CSS selectors in iframes first
  const cssSubmitResult = await browserClickInFrame([
    'button[type="submit"]',
    'input[type="submit"]',
    'button[data-testid="submit-button"]',
    'button[data-testid="register-button"]',
  ]);
  if (cssSubmitResult.success) {
    console.log(`[booking] Step ${step}: Clicked CSS: ${cssSubmitResult.output}`);
    return true;
  }

  // Fall back to text matching (searches main doc + iframes)
  const textResult = await browserClickByText([
    'complete order',       // Eventbrite organizer questions step
    'place order',
    'complete registration',
    'register',             // Eventbrite attendee form submit
    'checkout',
    'confirm',
    'submit',
    'complete',
  ]);
  if (textResult.success) {
    console.log(`[booking] Step ${step}: Clicked text: "${textResult.matchedText}"`);
    return true;
  }

  return false;
}

/**
 * Extracts confirmation number / success indicator from the current page.
 * Scrapes both main document and iframes, then applies pattern matching.
 * Returns the confirmation string or undefined.
 */
async function extractConfirmation(): Promise<string | undefined> {
  const textResult = await browserText();
  let allPageText = textResult.success ? textResult.output : '';

  // Also grab text from iframes via eval
  const iframeTextResult = await browserEval(
    '(() => { var texts = []; var iframes = Array.from(document.querySelectorAll("iframe")); for (var i = 0; i < iframes.length; i++) { try { texts.push(iframes[i].contentDocument.body.innerText); } catch(e) {} } return texts.join(" "); })()',
  );
  if (iframeTextResult.success && iframeTextResult.output) {
    try {
      const iframeText = JSON.parse(iframeTextResult.output);
      if (typeof iframeText === 'string') allPageText += ' ' + iframeText;
    } catch {
      allPageText += ' ' + iframeTextResult.output;
    }
  }

  if (!allPageText) return undefined;

  // Look for Eventbrite order number pattern: #NNNNNNNNNNN
  const orderMatch = allPageText.match(/#(\d{8,15})/);
  if (orderMatch) {
    console.log(`[booking] Found order number: #${orderMatch[1]}`);
    return orderMatch[1];
  }

  // Look for common confirmation patterns — require keyword proximity to avoid false matches
  const confirmMatch = allPageText.match(
    /(?:confirmation|order|booking|reference|ticket)\s*(?:#|number|no\.?|id|:)\s*:?\s*([A-Z0-9][A-Z0-9-]{3,19})/i,
  );
  if (confirmMatch && !/^[a-z]+$/i.test(confirmMatch[1])) {
    console.log(`[booking] Found confirmation number: ${confirmMatch[1]}`);
    return confirmMatch[1];
  }

  // Check for success indicators without numeric confirmation
  const textLower = allPageText.toLowerCase();
  if (
    textLower.includes('thanks for your order') ||
    textLower.includes('your order is confirmed') ||
    textLower.includes("you're going") ||
    textLower.includes('registration confirmed') ||
    textLower.includes('successfully registered') ||
    textLower.includes('take me to my tickets')
  ) {
    console.log(`[booking] Detected success confirmation text (no numeric confirmation number)`);
    return 'CONFIRMED';
  }

  return undefined;
}

/**
 * Runs the multi-step checkout loop (up to MAX_CHECKOUT_STEPS).
 * Fills forms and clicks proceed buttons until confirmation is detected or no progress is made.
 * Returns true if confirmation was detected mid-loop.
 */
async function runCheckoutLoop(userProfile: UserProfile): Promise<boolean> {
  const MAX_CHECKOUT_STEPS = 6;
  const CONFIRMATION_JS =
    '(() => { function getAll() { var t = document.body.innerText || ""; var iframes = Array.from(document.querySelectorAll("iframe")); for (var i = 0; i < iframes.length; i++) { try { t += " " + iframes[i].contentDocument.body.innerText; } catch(e) {} } return t; } var t = getAll().toLowerCase(); if (t.includes("thanks for your order") || t.includes("your order is confirmed") || t.includes("you\u0027re going") || t.includes("registration confirmed") || t.includes("successfully registered") || t.includes("take me to my tickets")) return "CONFIRMED"; return "CONTINUE"; })()';
  const PAGE_TEXT_JS =
    '(() => { var t = (document.body.innerText || "").substring(0, 2000); var iframes = Array.from(document.querySelectorAll("iframe")); for (var i = 0; i < iframes.length; i++) { try { t += iframes[i].contentDocument.body.innerText.substring(0, 2000); } catch(e) {} } return t.substring(0, 4000); })()';
  const REQUIRED_FIELDS_JS =
    '(() => { function scan() { var problems = []; var entries = [{ doc: document, win: window }]; var iframes = Array.from(document.querySelectorAll("iframe")); for (var k = 0; k < iframes.length; k++) { try { entries.push({ doc: iframes[k].contentDocument, win: iframes[k].contentWindow }); } catch(e) {} } for (var e = 0; e < entries.length; e++) { var inputs = Array.from(entries[e].doc.querySelectorAll("input[required], select[required], textarea[required]")); for (var i = 0; i < inputs.length; i++) { var inp = inputs[i]; if (!inp.value || inp.value.trim() === "") { var label = ""; if (inp.id) { var lbl = entries[e].doc.querySelector("label[for=\'" + inp.id + "\']"); if (lbl) label = lbl.textContent.trim(); } if (!label) { var parent = inp.closest("label, .eds-field-styled, .form-group, .field"); if (parent) label = parent.textContent.trim().substring(0, 60); } problems.push(label || inp.name || inp.id || "unknown"); } } } return problems; } var p = scan(); return JSON.stringify(p); })()';

  let previousPageText = '';
  let stuckCount = 0;

  for (let step = 0; step < MAX_CHECKOUT_STEPS; step++) {
    // Wait for the current step to render (longer for first step after initial click)
    await new Promise((resolve) => setTimeout(resolve, step === 0 ? 3000 : 2500));

    // Check for confirmation indicators before trying more steps
    const quickCheck = await browserEval(CONFIRMATION_JS);
    if (quickCheck.success) {
      let checkVal = quickCheck.output.trim();
      try { checkVal = JSON.parse(checkVal); } catch {}
      if (typeof checkVal === 'string') { try { checkVal = JSON.parse(checkVal); } catch {} }
      if (checkVal === 'CONFIRMED') {
        console.log(`[booking] Detected confirmation at step ${step + 1}`);
        return true;
      }
    }

    // ── Stuck detection: compare page text to previous step ──
    const stuckCheckResult = await browserEval(PAGE_TEXT_JS);
    let currentPageText = '';
    if (stuckCheckResult.success) {
      try { currentPageText = JSON.parse(stuckCheckResult.output.trim()); } catch { currentPageText = stuckCheckResult.output.trim(); }
      if (typeof currentPageText !== 'string') currentPageText = String(currentPageText);
    }

    if (previousPageText && currentPageText === previousPageText) {
      stuckCount++;
      console.log(`[booking] Step ${step + 1}: Page unchanged (stuck count: ${stuckCount})`);
      if (stuckCount >= 2) {
        console.log(`[booking] Page stuck for ${stuckCount} steps — breaking checkout loop`);
        break;
      }
    } else {
      stuckCount = 0;
    }
    previousPageText = currentPageText;

    // ── Check for required custom fields we can't fill ──
    if (step >= 2) {
      const requiredFieldCheck = await browserEval(REQUIRED_FIELDS_JS);
      if (requiredFieldCheck.success) {
        try {
          let parsed = JSON.parse(requiredFieldCheck.output.trim());
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`[booking] Step ${step + 1}: Found ${parsed.length} unfilled required fields: ${parsed.join(', ')}`);
          }
        } catch { /* ignore parse errors */ }
      }
    }

    const anyFilled = await fillFormFields(userProfile, step + 1);

    // Small delay between filling and clicking to let React process state updates
    if (anyFilled) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const clickedProceed = await clickProceedButton(step + 1);

    // If nothing happened this step (no fills, no clicks), we're done
    if (!anyFilled && !clickedProceed) {
      console.log(`[booking] Step ${step + 1}: No action taken — stopping checkout loop`);
      break;
    }
  }

  return false;
}

/**
 * Execute Booking Tool — Full Actionbook 7-Step Flow
 *
 * Orchestrates the complete booking flow for a single itinerary item:
 * 1. Search Actionbook SDK for action manuals matching the booking site
 * 2. Get detailed action manual with verified CSS selectors
 * 3. Open the booking URL in Actionbook browser
 * 4. Snapshot the page for LLM analysis
 * 5. Use Execution Agent (GPT-4o-mini) to decide and execute browser commands
 * 6. Capture confirmation screenshot
 * 7. Close browser and return result
 */
export const executeBookingTool = createTool({
  id: 'execute-booking',
  description:
    'Executes a booking for a specific itinerary item via Actionbook browser automation. Searches for action manuals, opens the booking page, fills forms using verified selectors, and captures confirmation.',
  inputSchema: z.object({
    eventId: z.string().describe('ID of the event to book'),
    eventName: z.string().describe('Name of the event'),
    sourceUrl: z.string().describe('Booking URL — empty string if no URL available'),
    partySize: z.number().min(1).describe('Number of people'),
    userProfile: z.object({
      name: z.string().describe('User full name'),
      email: z.string().describe('User email'),
      phone: z.string().optional().describe('User phone number'),
      dietaryPreferences: z.array(z.string()).optional().describe('Dietary restrictions'),
      specialRequests: z.string().optional().describe('Special requests'),
    }),
    eventSource: z.string().default('unknown').describe('Source of the event (eventbrite, eventfinda, etc.)'),
    bookingRequired: z.boolean().default(true).describe('Whether this item needs booking vs info-only'),
  }),
  outputSchema: BookingResultSchema,
  execute: async ({ eventId, eventName, sourceUrl, partySize, userProfile, eventSource, bookingRequired }) => {
    const timestamp = new Date().toISOString();

    // ── Guard: no URL → info-only ──
    if (!sourceUrl || sourceUrl.trim() === '') {
      console.log(`[booking] No source URL for "${eventName}" — marking as info_only`);
      return {
        eventId,
        eventName,
        actionType: 'info_only' as const,
        status: 'no_source_url' as const,
        error: 'No booking URL available — this is a generated/suggested activity',
        timestamp,
      };
    }

    // ── Guard: not booking required → skip ──
    if (!bookingRequired) {
      console.log(`[booking] Booking not required for "${eventName}" — skipping`);
      return {
        eventId,
        eventName,
        actionType: 'info_only' as const,
        status: 'skipped' as const,
        timestamp,
      };
    }

    try {
      // ── Steps 1–2: Fetch action manual ──
      const { hasManual } = await fetchActionManual(sourceUrl, eventSource, eventName);

      // ── Step 3: Open booking URL ──
      console.log(`[booking] Step 3: Opening browser at ${sourceUrl}`);
      const openResult = await browserOpen(sourceUrl);
      if (!openResult.success) {
        return {
          eventId,
          eventName,
          actionType: 'book' as const,
          status: 'page_error' as const,
          error: `Failed to open browser: ${openResult.error}`,
          timestamp,
        };
      }

      // Small delay for page load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // ── Step 4: Snapshot the page ──
      console.log(`[booking] Step 4: Taking page snapshot`);
      const snapshotResult = await browserSnapshot();
      const pageSnapshot = snapshotResult.success ? snapshotResult.output : '';

      // ── Step 5: Execute booking flow ──
      // Instead of calling executionAgent.generate() here (which would create circular dependency),
      // we do a deterministic booking flow using the action manual selectors + snapshot.
      // The Execution Agent is available for the pipeline to use directly if needed.
      console.log(`[booking] Step 5: Executing booking flow for "${eventName}"`);

      // Check for common blocking conditions in the snapshot
      const blockingStatus = checkBlockingConditions(pageSnapshot.toLowerCase());
      if (blockingStatus) {
        await browserClose().catch(() => {});
        const errorMessages: Record<typeof blockingStatus, string> = {
          sold_out: 'Event is sold out',
          waitlist: 'Event is at capacity — only waitlist available',
          captcha_blocked: 'Captcha detected — cannot proceed with automated booking',
          login_required: 'Login required to book this event',
        };
        console.log(`[booking] Blocking condition detected: ${blockingStatus}`);
        return {
          eventId,
          eventName,
          actionType: 'book' as const,
          status: blockingStatus,
          error: errorMessages[blockingStatus],
          timestamp,
        };
      }

      // Try to find and click a booking/register/RSVP button
      // Uses JS-based text matching (searches main doc + iframes) — CSS selectors were removed
      // because Eventbrite's dynamic class names meant they never matched.
      let bookingClicked = false;

      const textClickResult = await browserClickByText([
        'reserve a spot',    // Eventbrite free events
        'get tickets',       // Eventbrite paid events
        'register',          // Generic registration
        'book now',
        'book',
        'rsvp',
        'reserve',
        'sign up',
        'join',
        'attend',
      ]);
      if (textClickResult.success) {
        console.log(`[booking] Clicked booking button via JS: "${textClickResult.matchedText}"`);
        bookingClicked = true;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await adjustTicketQuantity(partySize);
      }

      if (!bookingClicked && !hasManual) {
        await browserClose().catch(() => {});
        return {
          eventId,
          eventName,
          actionType: 'info_only' as const,
          status: 'no_action_manual' as const,
          error: 'No booking button found and no action manual available',
          timestamp,
        };
      }

      // ── Post-click: Multi-step checkout flow ──
      // Eventbrite full flow:
      //   1. Reserve a spot → modal (ticket selection) → Register
      //   2. Register → attendee form (name, email) → Register/Submit
      //   3. Order successful → "Answer questions" (organizer custom fields: phone, etc.) → Complete order
      //   4. Get your tickets → CONFIRMED
      // Generic flow: Book Now → form → Submit
      const submitted = await runCheckoutLoop(userProfile);

      // ── Step 6: Capture confirmation ──
      // Extra wait for final page to render after last click
      await new Promise((resolve) => setTimeout(resolve, 3000));
      console.log(`[booking] Step 6: Capturing confirmation`);
      const screenshotPath = `/tmp/booking-${eventId}-${Date.now()}.png`;
      await browserScreenshot(screenshotPath);

      const confirmationNumber = await extractConfirmation();

      // ── Step 7: Close browser ──
      console.log(`[booking] Step 7: Closing browser`);
      await browserClose().catch(() => {});

      // Determine final status:
      // - 'success' ONLY if we detected actual confirmation text (order confirmed, thanks for your order, etc.)
      // - 'failed' if we clicked buttons but never saw confirmation
      // This prevents false positives from clicking non-checkout elements (e.g. FAQ items)
      const hasConfirmation = !!confirmationNumber;
      const finalStatus = hasConfirmation ? 'success' as const : 'failed' as const;

      if (!hasConfirmation && submitted) {
        console.log(`[booking] Warning: Checkout loop ran but no confirmation detected — marking as failed`);
      }

      return {
        eventId,
        eventName,
        actionType: 'book' as const,
        status: finalStatus,
        confirmationNumber,
        screenshotPath,
        timestamp,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown booking error';
      console.error(`[booking] Error booking "${eventName}":`, errMsg);

      // Try to close browser on error
      await browserClose().catch(() => {});

      return {
        eventId,
        eventName,
        actionType: 'book' as const,
        status: 'failed' as const,
        error: errMsg,
        timestamp,
      };
    }
  },
});
