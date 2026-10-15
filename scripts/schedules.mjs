#!/usr/bin/env node
// Story 1.9: the operator's command for the QStash schedules. The schedule registry (lib/schedules.ts) is the source of truth; this
// command makes the environment's live schedules equal to it. It is run by Josh, never by CI, and nothing in this repository runs it.
//
//   node scripts/schedules.mjs list
//       Prints the registered schedules (task, cron in UTC, description). It reads nothing from the environment and makes no network call.
//   node --env-file=.env.staging scripts/schedules.mjs check
//       Compares the live schedules with the registry and lists every difference. Exits 1 when there is one (or when QStash cannot be
//       asked), 0 when they are equal. Changes nothing.
//   node --env-file=.env.staging scripts/schedules.mjs apply --confirm staging
//       Makes them equal: creates a missing schedule, corrects a wrong one in place (a paused one is resumed), and deletes a schedule
//       that is not in the registry or that repeats a task, but ONLY one whose destination is exactly this application's jobs URL
//       (<APP_ORIGIN>/api/jobs). A schedule of that kind with any other destination is not this command's to delete: it is named (by schedule
//       ID and field), left alone, and the command exits 1 saying a person must remove it. Before it changes anything it prints every
//       change it is about to make ("will create ...", "will update ...", "will resume ...", "will delete ..."). Then it checks again and
//       exits 1 if the live schedules still differ.
//
// What a schedule is: one per registered task, calling POST `<APP_ORIGIN>/api/jobs` with the body {"task": <task>, "instance": <INSTANCE_ID>}
// on the task's cron expression (UTC). The retry count, the delay and every other delivery setting are left to the QStash account's
// defaults: this command sets none.
//
// It reads QSTASH_URL (the region endpoint, https), QSTASH_TOKEN, APP_ORIGIN (the deployed application's https origin), INSTANCE_ID and APP_ENV
// (staging or production) from the environment. It prints no token, and no value of the environment except APP_ORIGIN, INSTANCE_ID and the
// schedule IDs QStash itself assigned. `apply` refuses to run without --confirm <APP_ENV>.
//
// Exit codes: 0 equal or done, 1 differences or failure, 2 wrong usage.
//
// The functions below take the client as an argument, so the tests drive them with a fake and make no network call. Erasable TypeScript
// syntax is all lib/schedules.ts uses, so Node loads it directly.
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {jobsPath, scheduleBody, scheduleRegistry} from '../lib/schedules.ts';

const usage = `Usage:
  schedules.mjs list
  schedules.mjs check
  schedules.mjs apply --confirm <APP_ENV>
check and apply read QSTASH_URL, QSTASH_TOKEN, APP_ORIGIN, INSTANCE_ID and APP_ENV from the environment (node --env-file=.env.staging ...).`;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The lines `list` prints: the registry as it is, and nothing from the environment. */
export function listLines() {
  return scheduleRegistry.map((entry) => `${entry.task}  ${entry.cron}  (UTC)  ${entry.description}`);
}

/**
 * The settings of an environment, or the reasons it has none. Returns {config} or {errors}. A value is never repeated in a reason.
 * @param {Record<string, string | undefined>} env
 */
export function readConfig(env) {
  const errors = [];
  const token = env.QSTASH_TOKEN?.trim();
  if (!token) errors.push('QSTASH_TOKEN is not set');
  let baseUrl = env.QSTASH_URL?.trim();
  if (!baseUrl) errors.push('QSTASH_URL is not set (the region endpoint, for example the us-east-1 one)');
  else {
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== 'https:') errors.push('QSTASH_URL must be an https URL');
      baseUrl = url.origin;
    } catch {
      errors.push('QSTASH_URL is not a URL');
    }
  }
  let origin = env.APP_ORIGIN?.trim();
  if (!origin) errors.push('APP_ORIGIN is not set (the deployed application\'s https origin)');
  else {
    try {
      const url = new URL(origin);
      const plain = url.protocol === 'https:' && url.origin === origin && !url.username && !url.password;
      if (!plain) errors.push('APP_ORIGIN must be a plain https origin: no path, no trailing slash, no credentials');
      origin = url.origin;
    } catch {
      errors.push('APP_ORIGIN is not a URL');
    }
  }
  const instanceId = env.INSTANCE_ID?.trim().toLowerCase();
  if (!instanceId || !uuidPattern.test(instanceId)) errors.push('INSTANCE_ID must be the environment\'s instance UUID');
  const appEnv = env.APP_ENV?.trim();
  if (appEnv !== 'staging' && appEnv !== 'production') errors.push('APP_ENV must be staging or production: there are no schedules for local or a preview');
  if (errors.length) return {errors};
  return {config: {token, baseUrl, origin, instanceId, appEnv}};
}

/** What each registered task's schedule must be, in registry order. */
export function desiredSchedules({origin, instanceId}) {
  return scheduleRegistry.map((entry) => ({
    task: entry.task,
    cron: entry.cron,
    destination: `${origin}${jobsPath}`,
    method: 'POST',
    body: scheduleBody(entry.task, instanceId),
  }));
}

/** The body of a live schedule as text (QStash may return it base64 encoded), or null. */
function liveBody(schedule) {
  if (typeof schedule.body === 'string') return schedule.body;
  if (typeof schedule.bodyBase64 === 'string') return Buffer.from(schedule.bodyBase64, 'base64').toString('utf8');
  return null;
}

/** The registered task a live schedule is for: the one its body names, or null when it names none that is registered. */
function liveTask(schedule, desired) {
  const body = liveBody(schedule);
  if (body === null) return null;
  try {
    const task = JSON.parse(body)?.task;
    return desired.some((entry) => entry.task === task) ? task : null;
  } catch {
    return null;
  }
}

/** Whether a live schedule is, in every field this command sets, what the registry says it must be. */
function matches(schedule, want) {
  return (
    schedule.cron === want.cron &&
    schedule.destination === want.destination &&
    (schedule.method ?? 'POST').toUpperCase() === want.method &&
    liveBody(schedule) === want.body &&
    schedule.isPaused !== true
  );
}

/**
 * Compares the live schedules with the desired ones. Returns the differences as plain data:
 *   {kind: 'missing', task}                         no live schedule for a registered task
 *   {kind: 'wrong', task, scheduleId, fields}       one differs in cron, destination, method, body or by being paused
 *   {kind: 'duplicate', task, scheduleId}           a second (or later) schedule for one task
 *   {kind: 'unregistered', scheduleId}              a live schedule for no registered task
 * Of several schedules for one task the one kept is the one that is already right, else the one that already calls this application's jobs
 * URL, else the first: so a duplicate is never the correct schedule, and never the one that calls this application.
 */
export function compareSchedules(desired, live) {
  const differences = [];
  const named = new Map();
  for (const schedule of live) {
    const task = liveTask(schedule, desired);
    if (task !== null) named.set(task, [...(named.get(task) ?? []), schedule]);
  }
  const kept = new Map();
  for (const want of desired) {
    const candidates = named.get(want.task) ?? [];
    const chosen = candidates.find((candidate) => matches(candidate, want)) ?? candidates.find((candidate) => candidate.destination === want.destination) ?? candidates[0];
    if (chosen) kept.set(want.task, chosen);
  }
  for (const schedule of live) {
    const task = liveTask(schedule, desired);
    if (task === null) differences.push({kind: 'unregistered', scheduleId: schedule.scheduleId});
    else if (kept.get(task) !== schedule) differences.push({kind: 'duplicate', task, scheduleId: schedule.scheduleId});
  }
  for (const want of desired) {
    const schedule = kept.get(want.task);
    if (!schedule) {
      differences.push({kind: 'missing', task: want.task});
      continue;
    }
    const fields = [];
    if (schedule.cron !== want.cron) fields.push('cron');
    if (schedule.destination !== want.destination) fields.push('destination');
    if ((schedule.method ?? 'POST').toUpperCase() !== want.method) fields.push('method');
    if (liveBody(schedule) !== want.body) fields.push('body');
    if (schedule.isPaused === true) fields.push('paused');
    if (fields.length) differences.push({kind: 'wrong', task: want.task, scheduleId: schedule.scheduleId, fields});
  }
  return differences;
}

/** One line per difference, with nothing in it but task names, schedule IDs and field names. */
export function describeDifference(difference) {
  switch (difference.kind) {
    case 'missing':
      return `missing: no schedule for ${difference.task}`;
    case 'wrong':
      return `differs: ${difference.task} (${difference.scheduleId}): ${difference.fields.join(', ')}`;
    case 'duplicate':
      return `duplicate: ${difference.task} has another schedule (${difference.scheduleId})`;
    default:
      return `unregistered: ${difference.scheduleId} is not for a registered task`;
  }
}

/** The live schedules. Throws if QStash cannot be asked. */
async function liveSchedules(client) {
  const live = await client.schedules.list();
  if (!Array.isArray(live)) throw new TypeError('QStash did not answer with a list of schedules');
  return live;
}

/** `check`: the differences between the live schedules and the registry (empty when equal). Changes nothing. */
export async function checkSchedules(client, config) {
  return compareSchedules(desiredSchedules(config), await liveSchedules(client));
}

/**
 * What `apply` would do, from the live schedules and the registry, without doing it. Returns `{steps, foreign}`:
 *   steps    in order, each {action: 'create' | 'update' | 'resume' | 'delete', line, ...}; `line` says it by task or schedule ID
 *   foreign  the schedules `apply` must not delete because they do not call this application's jobs URL: {scheduleId, fields, line}
 * A duplicate or unregistered schedule is deleted only when its destination is exactly `<origin>/api/jobs`.
 */
export function planApply(config, live) {
  const desired = desiredSchedules(config);
  const ownUrl = `${config.origin}${jobsPath}`;
  const byId = new Map(live.map((schedule) => [schedule.scheduleId, schedule]));
  const steps = [];
  const foreign = [];
  for (const difference of compareSchedules(desired, live)) {
    const want = desired.find((entry) => entry.task === difference.task);
    if (difference.kind === 'missing') steps.push({action: 'create', task: want.task, line: `will create the schedule of ${want.task}`});
    if (difference.kind === 'wrong' && difference.fields.some((field) => field !== 'paused')) {
      const fields = difference.fields.filter((field) => field !== 'paused');
      steps.push({action: 'update', task: want.task, scheduleId: difference.scheduleId, fields, line: `will update ${want.task} (${difference.scheduleId}): ${fields.join(', ')}`});
    }
    if (difference.kind === 'wrong' && difference.fields.includes('paused')) {
      steps.push({action: 'resume', task: want.task, scheduleId: difference.scheduleId, line: `will resume ${want.task} (${difference.scheduleId})`});
    }
    if (difference.kind === 'duplicate' || difference.kind === 'unregistered') {
      const why = difference.kind === 'duplicate' ? `a second schedule for ${difference.task}` : 'for no registered task';
      if (byId.get(difference.scheduleId)?.destination === ownUrl) {
        steps.push({action: 'delete', scheduleId: difference.scheduleId, line: `will delete ${difference.scheduleId} (${why})`});
      } else {
        foreign.push({scheduleId: difference.scheduleId, fields: ['destination'], line: `will NOT delete ${difference.scheduleId} (${why}; field: destination): it does not call ${ownUrl}, so it is not this command's to delete and a person must remove it`});
      }
    }
  }
  return {steps, foreign};
}

/**
 * `apply`: makes the live schedules equal the registry, then returns what is still different (empty when it worked). It announces every
 * change (`announce(line)`) BEFORE it makes the first one. A wrong schedule is corrected in place (the same schedule ID, so nothing fires twice
 * and nothing is missed), a paused one is resumed, a missing one is created, and a duplicate or unregistered one is deleted if, and only if, it
 * calls this application's jobs URL; any other is left alone and returned in `foreign`.
 * Returns {done: string[], foreign: {scheduleId, fields, line}[], remaining: difference[]}.
 */
export async function applySchedules(client, config, announce = () => {}) {
  const desired = desiredSchedules(config);
  const {steps, foreign} = planApply(config, await liveSchedules(client));
  for (const line of [...steps, ...foreign].map((step) => step.line)) announce(line);
  const done = [];
  for (const step of steps) {
    const want = desired.find((entry) => entry.task === step.task);
    if (step.action === 'create' || step.action === 'update') {
      await client.schedules.create({
        destination: want.destination,
        cron: want.cron,
        method: want.method,
        body: want.body,
        headers: {'Content-Type': 'application/json'},
        ...(step.action === 'update' ? {scheduleId: step.scheduleId} : {}),
      });
      done.push(step.action === 'create' ? `created ${want.task}` : `corrected ${want.task} (${step.scheduleId})`);
    } else if (step.action === 'resume') {
      await client.schedules.resume({schedule: step.scheduleId});
      done.push(`resumed ${want.task} (${step.scheduleId})`);
    } else {
      await client.schedules.delete(step.scheduleId);
      done.push(`deleted ${step.scheduleId}`);
    }
  }
  return {done, foreign, remaining: compareSchedules(desired, await liveSchedules(client))};
}

/** The real client, made only when a command that needs one runs. */
async function realClient({baseUrl, token}) {
  const {Client} = await import('@upstash/qstash');
  return new Client({baseUrl, token});
}

/**
 * Runs the command line and returns its exit code. `deps.client` replaces the real QStash client (the tests pass a fake); `deps.env` the
 * process environment; `deps.out` and `deps.err` the two output streams.
 */
export async function run(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((line) => console.log(line));
  const err = deps.err ?? ((line) => console.error(line));
  let parsed;
  try {
    parsed = parseArgs({args: argv, allowPositionals: true, options: {confirm: {type: 'string'}}});
  } catch (error) {
    err(`${error.message}\n${usage}`);
    return 2;
  }
  const [command, ...extra] = parsed.positionals;
  const {confirm} = parsed.values;
  if (extra.length || !['list', 'check', 'apply'].includes(command ?? '') || (confirm !== undefined && command !== 'apply')) {
    err(usage);
    return 2;
  }

  if (command === 'list') {
    for (const line of listLines()) out(line);
    return 0;
  }

  const read = readConfig(env);
  if (read.errors) {
    for (const error of read.errors) err(error);
    return 1;
  }
  const {config} = read;
  if (command === 'apply' && confirm !== config.appEnv) {
    err(`apply changes the live QStash schedules of ${config.appEnv}: run it again with --confirm ${config.appEnv}`);
    return 1;
  }

  try {
    const client = deps.client ?? (await realClient(config));
    out(`${command === 'apply' ? 'Applying to' : 'Checking'} ${config.appEnv}: ${config.origin}${jobsPath}, instance ${config.instanceId}`);
    let remaining;
    let foreign = [];
    if (command === 'check') remaining = await checkSchedules(client, config);
    else {
      const applied = await applySchedules(client, config, out);
      for (const line of applied.done) out(line);
      remaining = applied.remaining;
      foreign = applied.foreign;
    }
    if (remaining.length) {
      for (const difference of remaining) out(describeDifference(difference));
      if (foreign.length) err(`The live schedules still differ from the registry. apply deletes only schedules that call ${config.origin}${jobsPath}; a person must remove ${foreign.map((entry) => entry.scheduleId).join(', ')} by hand (the QStash console), then run check again.`);
      else err(command === 'check' ? 'The live schedules differ from the registry. Run apply to correct them.' : 'The live schedules still differ from the registry.');
      return 1;
    }
    out(`The live schedules equal the registry (${scheduleRegistry.length}).`);
    return 0;
  } catch (error) {
    // The class only: a client's message may quote a request.
    err(`QStash could not be asked or changed (${error instanceof Error ? error.name : 'Error'}).`);
    return 1;
  }
}

/**
 * Whether this file is the program being run. Compared by REAL path on both sides: Node resolves a module's own URL through symlinks, but
 * `process.argv[1]` is the path as it was typed, so comparing them as written is false through a symlink and the command would exit 0 having
 * done nothing, which looks exactly like "the schedules are equal".
 */
export function isEntryPoint(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2));
}
