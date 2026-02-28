/**
 * Actionbook SDK Wrapper
 *
 * Wraps `@actionbookdev/sdk` to search action manuals and retrieve
 * verified CSS selectors for known booking sites.
 * Returns plain text designed for LLM consumption.
 */

import { Actionbook } from '@actionbookdev/sdk';

// ── Types ──

export interface BrowserCommandResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface BookingStepResult {
  step: string;
  success: boolean;
  detail: string;
  screenshotPath?: string;
}

// ── SDK Client ──

let _sdk: Actionbook | null = null;

function getSDK(): Actionbook {
  if (!_sdk) {
    _sdk = new Actionbook();
  }
  return _sdk;
}

/**
 * Search for action manuals matching a query.
 * Returns plain text with action IDs and descriptions (designed for LLM consumption).
 */
export async function searchActionManuals(
  query: string,
  options?: { domain?: string; background?: string },
): Promise<string> {
  const sdk = getSDK();
  try {
    const result = await sdk.searchActions({
      query,
      domain: options?.domain,
      background: options?.background,
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[actionbook:sdk] Search failed for "${query}":`, msg);
    return `No action manuals found for "${query}". Error: ${msg}`;
  }
}

/**
 * Get detailed action manual by area_id.
 * Returns plain text with selectors, element types, and step-by-step instructions.
 */
export async function getActionManual(areaId: string): Promise<string> {
  const sdk = getSDK();
  try {
    const result = await sdk.getActionByAreaId(areaId);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[actionbook:sdk] getActionByAreaId failed for "${areaId}":`, msg);
    return `Failed to get action manual for "${areaId}". Error: ${msg}`;
  }
}
