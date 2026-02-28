// ── Retry configuration ──

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1100; // >1s to respect 1 req/sec rate limit

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a fetch call with retry logic and exponential backoff.
 * Specifically handles:
 *   - 429 Too Many Requests (rate limited) — waits longer
 *   - 5xx Server Errors — retries with backoff
 *   - Network errors — retries with backoff
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);

      if (response.ok) return response;

      // Rate limited — wait and retry
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[http] Rate limited (429), retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(waitMs);
        continue;
      }

      // Server error — retry with backoff
      if (response.status >= 500) {
        const waitMs = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[http] Server error (${response.status}), retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(waitMs);
        continue;
      }

      // Client error (4xx, not 429) — don't retry, throw immediately
      const errorText = await response.text();
      throw new Error(
        `HTTP request failed (${response.status}): ${errorText}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('HTTP request failed')) {
        throw error; // Re-throw non-retryable client errors
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        const waitMs = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[http] Network error, retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries}): ${lastError?.message}`);
        await sleep(waitMs);
      }
    }
  }

  throw lastError ?? new Error('HTTP request failed after retries');
}

// ── Bright Data proxy fetcher ──

export interface BrightDataConfig {
  apiKey: string;
  zone?: string;
}

/**
 * Fetch a URL through Bright Data's web scraping proxy.
 */
export async function fetchViaBrightData(
  targetUrl: string,
  config: BrightDataConfig,
): Promise<string> {
  const body: Record<string, string> = {
    url: targetUrl,
    format: 'raw',
  };
  if (config.zone) {
    body.zone = config.zone;
  }

  const response = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Bright Data request failed (${response.status}): ${errorText}`,
    );
  }

  return response.text();
}
