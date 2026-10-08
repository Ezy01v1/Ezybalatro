/** First retries of a failed `persistHand` (spec §3.3); then every `PERSIST_RETRY_STEADY_MS`, unbounded. */
export const PERSIST_RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000] as const;
export const PERSIST_RETRY_STEADY_MS = 15_000;

/** Delay before retry number `attempt` (1 = the first retry after the initial failure). */
export function persistRetryDelay(attempt: number): number {
  return PERSIST_RETRY_BACKOFF_MS[attempt - 1] ?? PERSIST_RETRY_STEADY_MS;
}
