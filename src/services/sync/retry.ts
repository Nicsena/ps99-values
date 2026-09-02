import { createLogger } from '../../logger.js';

const log = createLogger({ namespace: 'sync' }).child('retry');

export interface RetryOptions {
  /** Total attempts including the first; must be >= 1. */
  attempts?: number;
  /** Base linear-backoff delay between attempts, multiplied by attempt number. */
  delayMs?: number;
}

// Bounded retry with short linear backoff for transient upstream failures.
// The final failure is thrown to the caller after the last attempt.
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delayMs = opts.delayMs ?? 500;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        log.warn(`attempt ${attempt} / ${attempts} failed, retrying: ${err}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}
