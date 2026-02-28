/**
 * Actionbook CLI Wrapper
 *
 * Wraps `@actionbookdev/cli` via child_process to control a Chrome browser
 * for automated form-filling and booking flows.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { BrowserCommandResult } from './actionbook-sdk.js';

const execFileAsync = promisify(execFile);

// ── CLI Config ──

const CLI_TIMEOUT_MS = 30_000;
const CLI_BINARY = 'actionbook';

/**
 * Execute an actionbook CLI command and return the result.
 * All browser commands support --json for structured output.
 */
async function execCLI(args: string[], timeoutMs = CLI_TIMEOUT_MS): Promise<BrowserCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(CLI_BINARY, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return {
      success: true,
      output: stdout.trim(),
      error: stderr.trim() || undefined,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown CLI error';
    console.error(`[actionbook:cli] Command failed: actionbook ${args.join(' ')}`, msg);
    return {
      success: false,
      output: '',
      error: msg,
    };
  }
}

// ── Browser Primitives ──

/** Open a URL in the browser */
export async function browserOpen(url: string): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Opening: ${url}`);
  return execCLI(['browser', 'open', url]);
}

/** Click an element by CSS/XPath selector */
export async function browserClick(selector: string): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Clicking: ${selector}`);
  return execCLI(['browser', 'click', selector]);
}

/** Fill an input field with a value */
export async function browserFill(selector: string, value: string): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Filling: ${selector} = "${value.substring(0, 20)}..."`);
  return execCLI(['browser', 'fill', selector, value]);
}

/** Select an option from a dropdown */
export async function browserSelect(selector: string, value: string): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Selecting: ${selector} = "${value}"`);
  return execCLI(['browser', 'select', selector, value]);
}

/** Press a keyboard key */
export async function browserPress(key: string): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Pressing: ${key}`);
  return execCLI(['browser', 'press', key]);
}

/** Wait for an element to appear */
export async function browserWait(
  selector: string,
  timeoutMs = 10_000,
): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Waiting for: ${selector}`);
  return execCLI(['browser', 'wait', selector, '--timeout', String(timeoutMs)]);
}

/** Take a screenshot and save to path */
export async function browserScreenshot(outputPath: string, fullPage = false): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Screenshot → ${outputPath}`);
  const args = ['browser', 'screenshot', outputPath];
  if (fullPage) args.push('--full-page');
  return execCLI(args);
}

/** Get a DOM snapshot (structured text for LLM consumption) */
export async function browserSnapshot(): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Taking snapshot`);
  return execCLI(['browser', 'snapshot']);
}

/** Get page text content */
export async function browserText(): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Getting page text`);
  return execCLI(['browser', 'text']);
}

/** Evaluate JavaScript on the page */
export async function browserEval(expression: string): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Evaluating JS`);
  return execCLI(['browser', 'eval', expression]);
}

/** Close the browser */
export async function browserClose(): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Closing browser`);
  return execCLI(['browser', 'close']);
}

/** Navigate to a URL (alias for goto) */
export async function browserGoto(url: string): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Navigating to: ${url}`);
  return execCLI(['browser', 'goto', url]);
}

/** Hover over an element */
export async function browserHover(selector: string): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Hovering: ${selector}`);
  return execCLI(['browser', 'hover', selector]);
}

/** Focus an element */
export async function browserFocus(selector: string): Promise<BrowserCommandResult> {
  console.log(`[actionbook:browser] Focusing: ${selector}`);
  return execCLI(['browser', 'focus', selector]);
}

// ── Composite Browser Helpers ──

/**
 * Click a button or link by matching its visible text content.
 * Uses browserEval to run JS on the page since Actionbook CLI only supports CSS selectors
 * (not Playwright :has-text() pseudo-selectors).
 *
 * @param textPatterns - Regex patterns to match against element textContent (tried in order)
 * @param elementTypes - CSS selector for candidate elements (default: 'button, a, [role="button"]')
 * @returns The text of the clicked element, or failure
 */
export async function browserClickByText(
  textPatterns: string[],
  elementTypes = 'button, a, [role="button"]',
): Promise<BrowserCommandResult & { matchedText?: string }> {
  // Build a JS expression that finds and clicks the first matching element
  // Searches both the main document AND same-origin iframes (e.g., Eventbrite checkout modal)
  const patternsJson = JSON.stringify(textPatterns);
  const escapedSelector = elementTypes.replace(/'/g, "\\'");
  const js = [
    '(() => {',
    '  function getAll(doc, sel, isIframe) {',
    '    var main = Array.from(doc.querySelectorAll(sel)).map(function(el) { return { el: el, iframe: isIframe }; });',
    '    if (!isIframe) {',
    '      var iframes = Array.from(doc.querySelectorAll("iframe"));',
    '      for (var k = 0; k < iframes.length; k++) {',
    '        try { var d = iframes[k].contentDocument || iframes[k].contentWindow.document; main = main.concat(Array.from(d.querySelectorAll(sel)).map(function(el) { return { el: el, iframe: true }; })); } catch(e) {}',
    '      }',
    '    }',
    '    return main;',
    '  }',
    `  var patterns = ${patternsJson}.map(function(p) { return new RegExp(p, "i"); });`,
    `  var items = getAll(document, '${escapedSelector}', false);`,
    '  function isVisible(el) { try { var r = el.getBoundingClientRect(); return r.height > 0 && r.width > 0; } catch(e) { return el.offsetParent !== null; } }',
    // For each pattern, collect all matching elements, then pick the best one
    // Best = shortest text + iframe elements preferred (checkout buttons are in iframes)
    '  for (var i = 0; i < patterns.length; i++) {',
    '    var candidates = [];',
    '    for (var j = 0; j < items.length; j++) {',
    '      var txt = (items[j].el.textContent || "").trim();',
    '      if (txt.length > 0 && txt.length < 50 && patterns[i].test(txt) && isVisible(items[j].el)) {',
    '        candidates.push({ el: items[j].el, txt: txt, iframe: items[j].iframe });',
    '      }',
    '    }',
    '    if (candidates.length > 0) {',
    // Sort: iframe elements first, then by text length (shorter = more likely a button)
    '      candidates.sort(function(a, b) { if (a.iframe !== b.iframe) return a.iframe ? -1 : 1; return a.txt.length - b.txt.length; });',
    '      candidates[0].el.click();',
    '      return JSON.stringify({ clicked: true, text: candidates[0].txt.substring(0, 80) });',
    '    }',
    '  }',
    '  var btnTexts = items.filter(function(it) { return isVisible(it.el); }).slice(0, 15).map(function(it) { return (it.el.textContent || "").trim().substring(0, 60); });',
    '  return JSON.stringify({ clicked: false, available: btnTexts });',
    '})()',
  ].join(' ');

  console.log(`[actionbook:browser] Clicking by text patterns: ${textPatterns.join(', ')}`);
  const result = await browserEval(js);

  if (!result.success) {
    return { ...result, matchedText: undefined };
  }

  try {
    // Actionbook CLI may return the result as a JSON-encoded string (double-quoted),
    // so we may need to parse twice: first unwrap the string, then parse the JSON object
    let parsed: { clicked: boolean; text?: string; available?: string[] };
    const raw = result.output.trim();
    const firstParse = JSON.parse(raw);
    if (typeof firstParse === 'string') {
      parsed = JSON.parse(firstParse);
    } else {
      parsed = firstParse;
    }

    if (parsed.clicked) {
      console.log(`[actionbook:browser] Clicked element with text: "${parsed.text}"`);
      return { success: true, output: parsed.text ?? '', matchedText: parsed.text };
    } else {
      console.log(`[actionbook:browser] No matching element found. Available buttons: ${JSON.stringify(parsed.available)}`);
      return { success: false, output: '', error: `No matching element. Available: ${JSON.stringify(parsed.available)}` };
    }
  } catch {
    // eval returned raw text, not JSON — might still have clicked
    console.log(`[actionbook:browser] browserClickByText raw output: ${result.output}`);
    return { success: result.output.length > 0, output: result.output };
  }
}

/**
 * Fill a form field inside the main document or any same-origin iframe.
 * Tries each selector in order, in both main doc and iframes.
 *
 * CRITICAL: For iframe inputs, we must use the iframe's own window prototype setter
 * (not the main window's) so that React's synthetic event system detects the change.
 * Each realm (window) has its own HTMLInputElement prototype — using the wrong one
 * sets the DOM property but doesn't trigger React's change detection.
 */
export async function browserFillInFrame(
  selectors: string[],
  value: string,
): Promise<BrowserCommandResult> {
  const selectorsJson = JSON.stringify(selectors);
  const valueEscaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const js = [
    '(() => {',
    '  function getDocsWithWindows() {',
    '    var entries = [{ doc: document, win: window }];',
    '    var iframes = Array.from(document.querySelectorAll("iframe"));',
    '    for (var k = 0; k < iframes.length; k++) {',
    '      try { entries.push({ doc: iframes[k].contentDocument || iframes[k].contentWindow.document, win: iframes[k].contentWindow }); } catch(e) {}',
    '    }',
    '    return entries;',
    '  }',
    `  var sels = ${selectorsJson};`,
    '  var entries = getDocsWithWindows();',
    '  for (var i = 0; i < sels.length; i++) {',
    '    for (var d = 0; d < entries.length; d++) {',
    '      var el = entries[d].doc.querySelector(sels[i]);',
    '      if (el) {',
    '        var ownerWin = entries[d].win;',
    `        var nativeSetter = Object.getOwnPropertyDescriptor(ownerWin.HTMLInputElement.prototype, 'value').set;`,
    `        el.focus();`,
    `        nativeSetter.call(el, '${valueEscaped}');`,
    '        el.dispatchEvent(new Event("input", { bubbles: true }));',
    '        el.dispatchEvent(new Event("change", { bubbles: true }));',
    '        el.blur();',
    '        return JSON.stringify({ filled: true, selector: sels[i] });',
    '      }',
    '    }',
    '  }',
    '  return JSON.stringify({ filled: false });',
    '})()',
  ].join(' ');

  console.log(`[actionbook:browser] Filling in frame: ${selectors[0]}... = "${value.substring(0, 20)}..."`);
  const result = await browserEval(js);
  if (!result.success) return result;

  try {
    const raw = result.output.trim();
    const firstParse = JSON.parse(raw);
    const parsed = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
    if (parsed.filled) {
      console.log(`[actionbook:browser] Filled field via ${parsed.selector}`);
      return { success: true, output: parsed.selector };
    }
    return { success: false, output: '', error: 'No matching form field found in any frame' };
  } catch {
    return { success: false, output: result.output, error: 'Failed to parse fill result' };
  }
}

/**
 * Click a CSS selector inside the main document or any same-origin iframe.
 * Tries each selector in order across all documents.
 */
export async function browserClickInFrame(
  selectors: string[],
): Promise<BrowserCommandResult> {
  const selectorsJson = JSON.stringify(selectors);
  const js = [
    '(() => {',
    '  function getDocs() {',
    '    var docs = [document];',
    '    var iframes = Array.from(document.querySelectorAll("iframe"));',
    '    for (var k = 0; k < iframes.length; k++) {',
    '      try { docs.push(iframes[k].contentDocument || iframes[k].contentWindow.document); } catch(e) {}',
    '    }',
    '    return docs;',
    '  }',
    `  var sels = ${selectorsJson};`,
    '  var docs = getDocs();',
    '  for (var i = 0; i < sels.length; i++) {',
    '    for (var d = 0; d < docs.length; d++) {',
    '      var el = docs[d].querySelector(sels[i]);',
    '      if (el && (el.offsetParent !== null || el.getBoundingClientRect().height > 0)) {',
    '        el.click();',
    '        return JSON.stringify({ clicked: true, selector: sels[i], text: (el.textContent || "").trim().substring(0, 80) });',
    '      }',
    '    }',
    '  }',
    '  return JSON.stringify({ clicked: false });',
    '})()',
  ].join(' ');

  console.log(`[actionbook:browser] Clicking in frame: ${selectors[0]}...`);
  const result = await browserEval(js);
  if (!result.success) return result;

  try {
    const raw = result.output.trim();
    const firstParse = JSON.parse(raw);
    const parsed = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
    if (parsed.clicked) {
      console.log(`[actionbook:browser] Clicked in frame via ${parsed.selector}: "${parsed.text}"`);
      return { success: true, output: parsed.text ?? '' };
    }
    return { success: false, output: '', error: 'No matching element found in any frame' };
  } catch {
    return { success: false, output: result.output, error: 'Failed to parse click result' };
  }
}

/**
 * Fill form fields by matching their associated label text.
 * Searches across the main document and all same-origin iframes.
 * Useful for organizer-specific custom fields where input names are unpredictable
 * (e.g., Eventbrite's `22622368989.U-319798808` for a "Phone Number" field).
 *
 * @param labelValueMap - Array of [labelRegex, value] pairs to fill
 * @returns Result with count of fields filled
 */
export async function browserFillByLabel(
  labelValueMap: [string, string][],
): Promise<BrowserCommandResult & { filledCount: number }> {
  const mapJson = JSON.stringify(labelValueMap);
  const js = [
    '(() => {',
    '  function getEntries() {',
    '    var entries = [{ doc: document, win: window }];',
    '    var iframes = Array.from(document.querySelectorAll("iframe"));',
    '    for (var k = 0; k < iframes.length; k++) {',
    '      try { entries.push({ doc: iframes[k].contentDocument || iframes[k].contentWindow.document, win: iframes[k].contentWindow }); } catch(e) {}',
    '    }',
    '    return entries;',
    '  }',
    `  var pairs = ${mapJson};`,
    '  var entries = getEntries();',
    '  var filled = 0;',
    '  var details = [];',
    '  for (var p = 0; p < pairs.length; p++) {',
    '    var re = new RegExp(pairs[p][0], "i");',
    '    var val = pairs[p][1];',
    '    for (var e = 0; e < entries.length; e++) {',
    '      var labels = Array.from(entries[e].doc.querySelectorAll("label"));',
    '      for (var l = 0; l < labels.length; l++) {',
    '        var txt = (labels[l].textContent || "").trim();',
    '        if (!re.test(txt)) continue;',
    '        var inputId = labels[l].htmlFor;',
    '        var input = inputId ? entries[e].doc.getElementById(inputId) : labels[l].querySelector("input, select, textarea");',
    '        if (!input) continue;',
    '        if (input.tagName === "INPUT" || input.tagName === "TEXTAREA") {',
    '          var setter = Object.getOwnPropertyDescriptor(entries[e].win.HTMLInputElement.prototype, "value").set;',
    '          input.focus();',
    '          setter.call(input, val);',
    '          input.dispatchEvent(new Event("input", { bubbles: true }));',
    '          input.dispatchEvent(new Event("change", { bubbles: true }));',
    '          input.blur();',
    '          filled++;',
    '          details.push(txt.substring(0, 40));',
    '          break;',
    '        }',
    '        if (input.tagName === "SELECT") {',
    '          input.value = val;',
    '          input.dispatchEvent(new Event("change", { bubbles: true }));',
    '          filled++;',
    '          details.push(txt.substring(0, 40));',
    '          break;',
    '        }',
    '      }',
    '    }',
    '  }',
    '  return JSON.stringify({ filled: filled, details: details });',
    '})()',
  ].join(' ');

  console.log(`[actionbook:browser] Filling ${labelValueMap.length} fields by label`);
  const result = await browserEval(js);
  if (!result.success) return { ...result, filledCount: 0 };

  try {
    const raw = result.output.trim();
    const firstParse = JSON.parse(raw);
    const parsed = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
    const count = parsed.filled ?? 0;
    if (count > 0) {
      console.log(`[actionbook:browser] Filled ${count} fields by label: ${(parsed.details ?? []).join(', ')}`);
    }
    return { success: count > 0, output: JSON.stringify(parsed.details ?? []), filledCount: count };
  } catch {
    return { success: false, output: result.output, error: 'Failed to parse label fill result', filledCount: 0 };
  }
}

// ── Composite Search Helpers ──

/**
 * Infer the site domain from a source URL for targeted action manual search.
 * e.g. "https://www.eventbrite.sg/e/foo-123" → "eventbrite.sg"
 */
export function extractDomain(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/**
 * Build an actionbook search query based on the event source and action type.
 */
export function buildSearchQuery(
  source: string,
  actionType: 'book' | 'register' | 'reserve',
): string {
  const sourceQueries: Record<string, Record<string, string>> = {
    eventbrite: {
      book: 'eventbrite book ticket register',
      register: 'eventbrite register event',
      reserve: 'eventbrite reserve ticket',
    },
    eventfinda: {
      book: 'book event ticket',
      register: 'register event',
      reserve: 'reserve event',
    },
    chope: {
      book: 'chope book restaurant reservation',
      register: 'chope reserve table',
      reserve: 'chope restaurant reservation',
    },
    opentable: {
      book: 'opentable book restaurant',
      register: 'opentable reserve table',
      reserve: 'opentable reservation',
    },
  };

  const sourceLower = source.toLowerCase();
  return sourceQueries[sourceLower]?.[actionType] ?? `${source} ${actionType} event`;
}
