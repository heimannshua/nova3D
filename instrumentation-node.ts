import {checkInstanceIdentity} from './lib/environment';

type Options = {
  /** Wait before each retry. Two entries means up to two more attempts. */
  backoffMs?: number[];
};

/**
 * Stops startup when the environment identity is mixed or cannot be verified (AR-26).
 *
 * Only failures that may clear by themselves are retried (network errors, timeouts, 5xx), up to
 * twice with a short backoff. A mismatch, an absent row or a 4xx exits at once. Once the retries
 * are used the check still fails closed.
 *
 * Throwing from `register` would leave a production server up answering 500s, so the process
 * exits instead. Messages name the mismatch and a fix; they never include a secret or a UUID.
 */
export async function verifyStartupIdentity({backoffMs = [250, 750]}: Options = {}) {
  let result = await checkInstanceIdentity(process.env);
  for (const delay of backoffMs) {
    if (result.errors.length === 0 || !result.retryable) break;
    console.warn(`Environment identity check could not verify the database (${result.errors[0]}); retrying in ${delay} ms.`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await checkInstanceIdentity(process.env);
  }
  if (result.errors.length === 0) return;

  console.error(`Environment identity check failed for ${process.env.APP_ENV || 'unset'}: ${result.errors.join('; ')}`);
  process.exit(1);
}
