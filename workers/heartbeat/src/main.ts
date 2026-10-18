// The heartbeat task's entry point: a cron job (Railway runs it every 30 minutes) that signs ONE heartbeat, posts it once to the application and exits.
// Run as `node workers/heartbeat/src/main.ts` (Node's type stripping; the image's CMD does the same).
//
// WHY: each scheduler watches the other. The application's monitor runs on QStash and cannot see QStash stop, so this task, which runs on Railway, tells the
// application it is alive: the application records the heartbeat, evaluates `qstash-stale` and answers how old the latest scheduler receipt is. The monitor
// raises `heartbeat-stale` when these stop. One signed call is both the heartbeat and the question, so a task that is refused exits non-zero and Railway marks
// the run failed as well.
//
// IT EXITS 0 on a 200 and 1 on anything else: a missing or malformed variable (before it signs anything), a refusal (401, 409, 503 ...), a redirect, a timeout, a
// network error. It prints ONE fixed line either way and never a value of the environment, the token, the key, the origin or the answer. It holds one secret, its
// own signing key: no database access and no Storage key.
//
// Only this file reads the environment, prints and exits; `run` takes the environment and what it needs as parameters so a test runs it without a network.
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {signHeartbeat} from '../../../lib/service-signing.ts';
import {readConfig, type Env} from './config.ts';

/**
 * How long the post may take before it counts as unanswered: thirty seconds. The route records the heartbeat and then evaluates and emails what is due before
 * it answers; the email dispatch starts no new send after ten seconds and each send has its own ten-second timeout (lib/alarms.ts `dispatchDeadlineMs`,
 * lib/mailer.ts `mailTimeoutMs`), so the slowest answer is about twenty seconds. A task that gave up sooner would report a failure for a heartbeat that was recorded.
 */
export const postTimeoutMs = 30_000;

export type RunDeps = {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Milliseconds since the epoch, for the token's `iat`. */
  now?: () => number;
  /** The one line of a run that went well, and the lines of one that did not. */
  log?: (line: string) => void;
  error?: (line: string) => void;
};

/** The fixed lines. Nothing about the run is added to them. */
export const lines = {
  recorded: 'The heartbeat was recorded.',
  refused: 'The heartbeat was not accepted.',
  unreachable: 'The heartbeat could not be sent.',
  notStarted: 'The heartbeat did not start:',
} as const;

/** Signs one heartbeat, posts it once and returns the exit code: 0 when the application answered 200, 1 otherwise. Never throws. */
export async function run(env: Env, deps: RunDeps = {}): Promise<0 | 1> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));
  const now = deps.now ?? Date.now;
  const read = readConfig(env, now());
  if (!read.ok) {
    error(lines.notStarted);
    for (const problem of read.problems) error(`  ${problem}`);
    return 1;
  }
  const {config} = read;
  let status: number;
  try {
    const token = signHeartbeat(config.signer, config.instanceId, {now: Math.floor(now() / 1000)});
    // POST with no body, no cookie and no Origin; a redirect is an error so the token can never be sent anywhere else; never cached.
    const response = await (deps.fetch ?? fetch)(config.endpoint, {
      method: 'POST',
      headers: {authorization: `Heartbeat ${token}`},
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(postTimeoutMs),
    });
    status = response.status;
    // The answer is never read or printed: letting go of it frees the connection.
    try {
      await response.body?.cancel();
    } catch {
      // Nothing to free.
    }
  } catch {
    error(lines.unreachable);
    return 1;
  }
  if (status === 200) {
    log(lines.recorded);
    return 0;
  }
  error(lines.refused);
  return 1;
}

/** Whether this file is the program being run (and not imported by a test), by real path on both sides. */
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exit(await run(process.env));
}
