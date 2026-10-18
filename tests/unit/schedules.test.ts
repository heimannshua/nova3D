import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {afterAll, describe, expect, it} from 'vitest';
import {isScheduledTask, jobsPath, monitorTask, scheduleBody, scheduleRegistry, scheduledTasks} from '@/lib/schedules';

// The schedule registry (Story 1.9, lib/schedules.ts) and the operator's command that makes QStash's live schedules equal it
// (scripts/schedules.mjs), driven with a fake client: no network call is made, and nothing here is run against QStash.
type Difference = {kind: string; task?: string; scheduleId?: string; fields?: string[]};
type Live = {scheduleId: string; cron: string; destination: string; method: string; body?: string; bodyBase64?: string; isPaused: boolean};
type Config = {token: string; baseUrl: string; origin: string; instanceId: string; appEnv: string};
type Script = {
  listLines(): string[];
  readConfig(env: Record<string, string | undefined>): {config?: Config; errors?: string[]};
  desiredSchedules(config: Pick<Config, 'origin' | 'instanceId'>): {task: string; cron: string; destination: string; method: string; body: string}[];
  compareSchedules(desired: ReturnType<Script['desiredSchedules']>, live: Live[]): Difference[];
  describeDifference(difference: Difference): string;
  checkSchedules(client: FakeClient, config: Config): Promise<Difference[]>;
  applySchedules(client: FakeClient, config: Config, announce?: (line: string) => void): Promise<{done: string[]; foreign: {scheduleId: string; fields: string[]; line: string}[]; remaining: Difference[]}>;
  isEntryPoint(moduleUrl: string, argv1?: string): boolean;
  run(argv: string[], deps?: {env?: Record<string, string | undefined>; client?: FakeClient; out?: (line: string) => void; err?: (line: string) => void}): Promise<number>;
};
const scriptPath = resolve(import.meta.dirname, '../../scripts/schedules.mjs');
const load = async () => (await import(pathToFileURL(scriptPath).href)) as Script;

const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ORIGIN = 'https://nova3d-staging.vercel.app';
const env = {QSTASH_URL: 'https://qstash-us-east-1.upstash.io', QSTASH_TOKEN: 'qstash-token-that-must-never-be-printed', APP_ORIGIN: ORIGIN, INSTANCE_ID: INSTANCE, APP_ENV: 'staging'};
const config: Config = {token: env.QSTASH_TOKEN, baseUrl: env.QSTASH_URL, origin: ORIGIN, instanceId: INSTANCE, appEnv: 'staging'};

type Created = Record<string, unknown>;
type FakeClient = ReturnType<typeof fakeClient>;
/** QStash's schedules, in memory, with the four calls the command makes and a log of every call. */
function fakeClient(initial: Live[] = [], options: {ignoreWrites?: boolean; fail?: string; timeline?: string[]} = {}) {
  const live = [...initial];
  const log: {call: string; args: unknown}[] = [];
  let counter = 0;
  const act = async <T>(call: string, args: unknown, work: () => T): Promise<T> => {
    log.push({call, args});
    options.timeline?.push(`call:${call}`);
    if (options.fail === call) throw Object.assign(new Error(`QStash said no (token ${env.QSTASH_TOKEN})`), {name: 'QstashError'});
    return work();
  };
  return {
    live,
    log,
    schedules: {
      list: () => act('list', undefined, () => live.map((schedule) => ({...schedule}))),
      create: (request: Created) =>
        act('create', request, () => {
          if (options.ignoreWrites) return {scheduleId: 'scd_ignored'};
          const existing = request.scheduleId ? live.find((schedule) => schedule.scheduleId === request.scheduleId) : undefined;
          const next = {scheduleId: String(request.scheduleId ?? `scd_new${(counter += 1)}`), cron: String(request.cron), destination: String(request.destination), method: String(request.method ?? 'POST'), body: String(request.body), isPaused: existing?.isPaused ?? false};
          if (existing) Object.assign(existing, next);
          else live.push(next);
          return {scheduleId: next.scheduleId};
        }),
      delete: (id: string) =>
        act('delete', id, () => {
          if (options.ignoreWrites) return;
          live.splice(live.findIndex((schedule) => schedule.scheduleId === id), 1);
        }),
      resume: (request: {schedule: string}) =>
        act('resume', request, () => {
          if (options.ignoreWrites) return;
          live.find((schedule) => schedule.scheduleId === request.schedule)!.isPaused = false;
        }),
    },
  };
}
const matching = (script: Script, suffix = ''): Live[] =>
  script.desiredSchedules(config).map((want) => ({scheduleId: `scd_${want.task}${suffix}`, cron: want.cron, destination: want.destination, method: want.method, body: want.body, isPaused: false}));
const lines = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {out, err, deps: {out: (line: string) => out.push(line), err: (line: string) => err.push(line)}};
};
const callsOf = (client: FakeClient) => client.log.map((entry) => entry.call);

describe('the registry', () => {
  it('lists the four tasks: the daily dormant-identity purge, the ledger relay every five minutes, (Story 1.12) the hourly staging cleanup and (Story 1.13) the alarm monitor every five minutes, all in UTC', () => {
    expect(scheduleRegistry.map(({task, cron}) => ({task, cron}))).toEqual([
      {task: 'dormant-identity-purge', cron: '0 3 * * *'},
      {task: 'ledger-relay', cron: '*/5 * * * *'},
      {task: 'staging-cleanup', cron: '0 * * * *'},
      {task: 'alarm-monitor', cron: '*/5 * * * *'},
    ]);
    for (const entry of scheduleRegistry) {
      expect(entry.description.length, entry.task).toBeGreaterThan(20);
      expect(entry.cron.split(' '), entry.task).toHaveLength(5);
      expect(entry.cron, entry.task).not.toMatch(/TZ=/i);
    }
  });

  it('says how often each task fires, in whole seconds, and agrees with its cron expression (Story 1.13: the condition `task-late` is twice this)', () => {
    expect(scheduleRegistry.map(({task, intervalSeconds}) => ({task, intervalSeconds}))).toEqual([
      {task: 'dormant-identity-purge', intervalSeconds: 86400},
      {task: 'ledger-relay', intervalSeconds: 300},
      {task: 'staging-cleanup', intervalSeconds: 3600},
      {task: 'alarm-monitor', intervalSeconds: 300},
    ]);
    // The interval is what the cron expression says: a step in the minutes field (`*/5`) is that many minutes, a fixed minute with `*` hours is an hour, and a fixed hour is a day.
    for (const entry of scheduleRegistry) {
      const [minute, hour] = entry.cron.split(' ');
      const step = /^\*\/(\d+)$/.exec(minute);
      const expected = step ? Number(step[1]) * 60 : hour === '*' ? 3600 : 86400;
      expect(entry.intervalSeconds, `${entry.task} (${entry.cron})`).toBe(expected);
      expect(Number.isSafeInteger(entry.intervalSeconds), entry.task).toBe(true);
    }
  });

  it('names the monitor once, as a registered task: the one task `task-late` leaves out', () => {
    expect(monitorTask).toBe('alarm-monitor');
    expect(scheduledTasks).toContain(monitorTask);
  });

  it('names each task once, in the shape the database and the route accept', () => {
    expect(new Set(scheduledTasks).size).toBe(scheduledTasks.length);
    for (const task of scheduledTasks) expect(task).toMatch(/^[a-z][a-z0-9-]{0,62}$/);
    expect(jobsPath).toBe('/api/jobs');
  });

  it('knows its own tasks and nothing that every object has', () => {
    for (const task of scheduledTasks) expect(isScheduledTask(task)).toBe(true);
    for (const value of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', '', ' ledger-relay', 'LEDGER-RELAY', 'ledger-relay ', 'session-cleanup', undefined, null, 7, {}, ['ledger-relay']]) {
      expect(isScheduledTask(value), String(value)).toBe(false);
    }
  });

  it('writes the body a schedule sends: exactly the task and the instance, as compact JSON', () => {
    expect(scheduleBody('ledger-relay', INSTANCE)).toBe(`{"task":"ledger-relay","instance":"${INSTANCE}"}`);
  });

  it('has no imports, so the route, the tasks, the operator\'s command and the tests all read the one list', async () => {
    const source = (await import('node:fs')).readFileSync(resolve(import.meta.dirname, '../../lib/schedules.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/^import\s|\bfrom\s+['"]/m);
  });
});

describe('scripts/schedules.mjs list', () => {
  it('prints the registered schedules and makes no network call and no client, with an empty environment', async () => {
    const script = await load();
    const output = lines();
    expect(await script.run(['list'], {env: {}, ...output.deps})).toBe(0);
    expect(output.out).toEqual(script.listLines());
    expect(output.out).toHaveLength(4);
    expect(output.out[0]).toContain('dormant-identity-purge  0 3 * * *  (UTC)');
    expect(output.out[1]).toContain('ledger-relay  */5 * * * *  (UTC)');
    expect(output.out[2]).toContain('staging-cleanup  0 * * * *  (UTC)');
    expect(output.out[3]).toContain('alarm-monitor  */5 * * * *  (UTC)');
    expect(output.err).toEqual([]);
  });

  it('is what the command line prints, from a bare process, with no environment', () => {
    const result = spawnSync(process.execPath, [scriptPath, 'list'], {encoding: 'utf8', env: {PATH: process.env.PATH ?? ''} as unknown as NodeJS.ProcessEnv});
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n').map((line) => line.split('  ')[0])).toEqual(['dormant-identity-purge', 'ledger-relay', 'staging-cleanup', 'alarm-monitor']);
  });
});

describe('usage', () => {
  it.each([[[]], [['nope']], [['list', 'extra']], [['check', '--unknown']], [['list', '--confirm', 'staging']], [['check', '--confirm', 'staging']]])('exits 2 for %j and touches nothing', async (argv) => {
    const script = await load();
    const output = lines();
    const client = fakeClient();
    expect(await script.run(argv, {env, client, ...output.deps})).toBe(2);
    expect(client.log).toEqual([]);
    expect(output.err.join('\n')).toContain('Usage:');
  });
});

describe('the settings it needs', () => {
  it('reads a complete environment', async () => {
    const script = await load();
    expect(script.readConfig(env)).toEqual({config});
    expect(script.readConfig({...env, APP_ENV: 'production', INSTANCE_ID: INSTANCE.toUpperCase(), QSTASH_URL: 'https://qstash.upstash.io/', APP_ORIGIN: ` ${ORIGIN} `}).config).toMatchObject({appEnv: 'production', instanceId: INSTANCE, baseUrl: 'https://qstash.upstash.io', origin: ORIGIN});
  });

  it.each([
    ['no token', {QSTASH_TOKEN: undefined}, 'QSTASH_TOKEN'],
    ['no endpoint', {QSTASH_URL: undefined}, 'QSTASH_URL'],
    ['an endpoint that is not https', {QSTASH_URL: 'http://qstash.example'}, 'QSTASH_URL'],
    ['an endpoint that is not a URL', {QSTASH_URL: 'qstash'}, 'QSTASH_URL'],
    ['no origin', {APP_ORIGIN: undefined}, 'APP_ORIGIN'],
    ['an origin that is not https', {APP_ORIGIN: 'http://nova3d.example'}, 'APP_ORIGIN'],
    ['an origin with a path', {APP_ORIGIN: `${ORIGIN}/app`}, 'APP_ORIGIN'],
    ['an origin with a trailing slash', {APP_ORIGIN: `${ORIGIN}/`}, 'APP_ORIGIN'],
    ['an origin with credentials', {APP_ORIGIN: 'https://user:pass@nova3d.example'}, 'APP_ORIGIN'],
    ['an origin that is not a URL', {APP_ORIGIN: 'nova3d'}, 'APP_ORIGIN'],
    ['no instance', {INSTANCE_ID: undefined}, 'INSTANCE_ID'],
    ['an instance that is not a UUID', {INSTANCE_ID: 'abc'}, 'INSTANCE_ID'],
    ['a local environment', {APP_ENV: 'local'}, 'APP_ENV'],
    ['no environment', {APP_ENV: undefined}, 'APP_ENV'],
  ])('refuses %s, naming the variable and no value', async (_name, change, variable) => {
    const script = await load();
    const result = script.readConfig({...env, ...change});
    expect(result.config).toBeUndefined();
    expect(result.errors?.some((line) => line.includes(variable))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(env.QSTASH_TOKEN);
  });

  it('stops before any client is made when the settings are wrong, exiting 1', async () => {
    const script = await load();
    const output = lines();
    const client = fakeClient();
    expect(await script.run(['check'], {env: {...env, QSTASH_TOKEN: undefined}, client, ...output.deps})).toBe(1);
    expect(client.log).toEqual([]);
    expect(output.err.join('\n')).toContain('QSTASH_TOKEN');
  });
});

describe('what a schedule must be', () => {
  it('is one per task, POST to <origin>/api/jobs, with the task\'s cron and the body {task, instance}', async () => {
    const script = await load();
    expect(script.desiredSchedules(config)).toEqual([
      {task: 'dormant-identity-purge', cron: '0 3 * * *', destination: `${ORIGIN}/api/jobs`, method: 'POST', body: `{"task":"dormant-identity-purge","instance":"${INSTANCE}"}`},
      {task: 'ledger-relay', cron: '*/5 * * * *', destination: `${ORIGIN}/api/jobs`, method: 'POST', body: `{"task":"ledger-relay","instance":"${INSTANCE}"}`},
      {task: 'staging-cleanup', cron: '0 * * * *', destination: `${ORIGIN}/api/jobs`, method: 'POST', body: `{"task":"staging-cleanup","instance":"${INSTANCE}"}`},
      {task: 'alarm-monitor', cron: '*/5 * * * *', destination: `${ORIGIN}/api/jobs`, method: 'POST', body: `{"task":"alarm-monitor","instance":"${INSTANCE}"}`},
    ]);
  });
});

describe('comparing the live schedules with the registry', () => {
  it('finds none when they are equal, whatever order QStash lists them in, and reads a body that came back base64 encoded', async () => {
    const script = await load();
    const desired = script.desiredSchedules(config);
    const live = matching(script).reverse();
    expect(script.compareSchedules(desired, live)).toEqual([]);
    const encoded = live.map(({body, ...rest}) => ({...rest, bodyBase64: Buffer.from(body!).toString('base64')}));
    expect(script.compareSchedules(desired, encoded)).toEqual([]);
    expect(script.compareSchedules(desired, live.map((schedule) => ({...schedule, method: 'post'})))).toEqual([]);
  });

  it('finds a missing schedule for each task that has none', async () => {
    const script = await load();
    const desired = script.desiredSchedules(config);
    expect(script.compareSchedules(desired, [])).toEqual([{kind: 'missing', task: 'dormant-identity-purge'}, {kind: 'missing', task: 'ledger-relay'}, {kind: 'missing', task: 'staging-cleanup'}, {kind: 'missing', task: 'alarm-monitor'}]);
  });

  it.each([
    ['cron', {cron: '*/10 * * * *'}],
    ['destination', {destination: 'https://other.example/api/jobs'}],
    ['destination', {destination: `${ORIGIN}/api/jobs/`}],
    ['method', {method: 'GET'}],
    ['body', {body: `{"task":"ledger-relay","instance":"${INSTANCE.replace('3f', '4f')}"}`}],
    ['body', {body: `{"instance":"${INSTANCE}","task":"ledger-relay"}`}],
    ['paused', {isPaused: true}],
  ])('finds a schedule that differs in %s', async (field, change) => {
    const script = await load();
    const live = matching(script).map((schedule) => (schedule.scheduleId === 'scd_ledger-relay' ? {...schedule, ...change} : schedule));
    expect(script.compareSchedules(script.desiredSchedules(config), live)).toEqual([{kind: 'wrong', task: 'ledger-relay', scheduleId: 'scd_ledger-relay', fields: [field]}]);
  });

  it('finds a second schedule for one task, and a schedule for no registered task (even one that calls the same path)', async () => {
    const script = await load();
    const live = [
      ...matching(script),
      ...matching(script, '_again').slice(1),
      {scheduleId: 'scd_other', cron: '* * * * *', destination: `${ORIGIN}/api/jobs`, method: 'POST', body: `{"task":"session-cleanup","instance":"${INSTANCE}"}`, isPaused: false},
      {scheduleId: 'scd_nobody', cron: '* * * * *', destination: 'https://elsewhere.example/', method: 'POST', body: 'not json', isPaused: false},
      {scheduleId: 'scd_empty', cron: '* * * * *', destination: 'https://elsewhere.example/', method: 'POST', isPaused: false},
    ];
    expect(script.compareSchedules(script.desiredSchedules(config), live)).toEqual([
      {kind: 'duplicate', task: 'ledger-relay', scheduleId: 'scd_ledger-relay_again'},
      {kind: 'duplicate', task: 'staging-cleanup', scheduleId: 'scd_staging-cleanup_again'},
      {kind: 'duplicate', task: 'alarm-monitor', scheduleId: 'scd_alarm-monitor_again'},
      {kind: 'unregistered', scheduleId: 'scd_other'},
      {kind: 'unregistered', scheduleId: 'scd_nobody'},
      {kind: 'unregistered', scheduleId: 'scd_empty'},
    ]);
  });

  it('describes a difference with task names, schedule IDs and field names only', async () => {
    const script = await load();
    expect(script.describeDifference({kind: 'missing', task: 'ledger-relay'})).toBe('missing: no schedule for ledger-relay');
    expect(script.describeDifference({kind: 'wrong', task: 'ledger-relay', scheduleId: 'scd_1', fields: ['cron', 'paused']})).toBe('differs: ledger-relay (scd_1): cron, paused');
    expect(script.describeDifference({kind: 'duplicate', task: 'ledger-relay', scheduleId: 'scd_2'})).toContain('scd_2');
    expect(script.describeDifference({kind: 'unregistered', scheduleId: 'scd_3'})).toContain('scd_3');
  });
});

describe('check', () => {
  it('exits 0 and changes nothing when the live schedules equal the registry', async () => {
    const script = await load();
    const client = fakeClient(matching(script));
    const output = lines();
    expect(await script.run(['check'], {env, client, ...output.deps})).toBe(0);
    expect(callsOf(client)).toEqual(['list']);
    expect(output.out.at(-1)).toContain('equal the registry (4)');
  });

  it('exits 1, lists every difference and changes nothing when they differ', async () => {
    const script = await load();
    const client = fakeClient([{...matching(script)[1], cron: '*/10 * * * *'}, {scheduleId: 'scd_extra', cron: '* * * * *', destination: 'https://x.example', method: 'POST', body: 'x', isPaused: false}]);
    const output = lines();
    expect(await script.run(['check'], {env, client, ...output.deps})).toBe(1);
    expect(callsOf(client)).toEqual(['list']);
    expect(output.out.join('\n')).toContain('missing: no schedule for dormant-identity-purge');
    expect(output.out.join('\n')).toContain('differs: ledger-relay (scd_ledger-relay): cron');
    expect(output.out.join('\n')).toContain('unregistered: scd_extra');
    expect(output.err.join('\n')).toContain('differ from the registry');
  });

  it('exits 1 when QStash cannot be asked, naming the class of the failure and never its message or the token', async () => {
    const script = await load();
    const output = lines();
    expect(await script.run(['check'], {env, client: fakeClient([], {fail: 'list'}), ...output.deps})).toBe(1);
    const printed = [...output.out, ...output.err].join('\n');
    expect(printed).toContain('QstashError');
    expect(printed).not.toContain(env.QSTASH_TOKEN);
    expect(printed).not.toContain('QStash said no');
  });

  it('exits 1 for an answer that is not a list', async () => {
    const script = await load();
    const output = lines();
    const client = {schedules: {list: async () => ({schedules: []})}} as never;
    expect(await script.run(['check'], {env, client, ...output.deps})).toBe(1);
  });
});

describe('apply', () => {
  it('refuses without --confirm <APP_ENV>, or with another environment\'s name, and touches nothing', async () => {
    const script = await load();
    for (const argv of [['apply'], ['apply', '--confirm', 'production'], ['apply', '--confirm', '']]) {
      const client = fakeClient();
      const output = lines();
      expect(await script.run(argv, {env, client, ...output.deps}), argv.join(' ')).toBe(1);
      expect(client.log).toEqual([]);
      expect(output.err.join('\n')).toContain('--confirm staging');
    }
  });

  it('creates what is missing: POST to the application, on the task\'s cron, with the body, and none of the delivery settings', async () => {
    const script = await load();
    const client = fakeClient();
    const output = lines();
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client, ...output.deps})).toBe(0);
    expect(output.out).toEqual(expect.arrayContaining(['created dormant-identity-purge', 'created ledger-relay', 'created staging-cleanup', 'created alarm-monitor']));
    const created = client.log.filter((entry) => entry.call === 'create').map((entry) => entry.args as Created);
    expect(created).toEqual([
      {destination: `${ORIGIN}/api/jobs`, cron: '0 3 * * *', method: 'POST', body: `{"task":"dormant-identity-purge","instance":"${INSTANCE}"}`, headers: {'Content-Type': 'application/json'}},
      {destination: `${ORIGIN}/api/jobs`, cron: '*/5 * * * *', method: 'POST', body: `{"task":"ledger-relay","instance":"${INSTANCE}"}`, headers: {'Content-Type': 'application/json'}},
      {destination: `${ORIGIN}/api/jobs`, cron: '0 * * * *', method: 'POST', body: `{"task":"staging-cleanup","instance":"${INSTANCE}"}`, headers: {'Content-Type': 'application/json'}},
      {destination: `${ORIGIN}/api/jobs`, cron: '*/5 * * * *', method: 'POST', body: `{"task":"alarm-monitor","instance":"${INSTANCE}"}`, headers: {'Content-Type': 'application/json'}},
    ]);
    // Retries, delay, callbacks, timeouts and flow control are the account's defaults: this command sets none of them.
    for (const request of created) for (const name of ['retries', 'delay', 'callback', 'failureCallback', 'timeout', 'flowControl', 'retryDelay', 'queueName']) expect(request, name).not.toHaveProperty(name);
    expect(client.live).toHaveLength(4);
    expect(await script.run(['check'], {env, client, ...lines().deps})).toBe(0);
  });

  it('corrects a wrong schedule in place, under its own ID, so nothing fires twice and nothing is missed', async () => {
    const script = await load();
    const client = fakeClient(matching(script).map((schedule) => (schedule.scheduleId === 'scd_dormant-identity-purge' ? {...schedule, cron: '0 4 * * *', destination: 'https://old.example/api/jobs'} : schedule)));
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client, ...lines().deps})).toBe(0);
    const creates = client.log.filter((entry) => entry.call === 'create').map((entry) => entry.args as Created);
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({scheduleId: 'scd_dormant-identity-purge', cron: '0 3 * * *', destination: `${ORIGIN}/api/jobs`});
    expect(callsOf(client)).not.toContain('delete');
    expect(client.live.map((schedule) => schedule.scheduleId).sort()).toEqual(['scd_alarm-monitor', 'scd_dormant-identity-purge', 'scd_ledger-relay', 'scd_staging-cleanup']);
  });

  it('resumes a paused schedule and rewrites nothing else', async () => {
    const script = await load();
    const client = fakeClient(matching(script).map((schedule) => ({...schedule, isPaused: schedule.scheduleId === 'scd_ledger-relay'})));
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client, ...lines().deps})).toBe(0);
    expect(callsOf(client)).toEqual(['list', 'resume', 'list']);
    expect(client.log[1].args).toEqual({schedule: 'scd_ledger-relay'});
  });

  it('deletes a duplicate and a schedule for no registered task that call this application, and keeps the first schedule of a task', async () => {
    const script = await load();
    // The stray used to point at https://x.example and was deleted; a schedule that does not call this application's jobs URL is no longer this
    // command's to delete (the next tests), so the stray that is deleted here is one that does.
    const client = fakeClient([...matching(script), ...matching(script, '_again'), {scheduleId: 'scd_stray', cron: '* * * * *', destination: `${ORIGIN}/api/jobs`, method: 'POST', body: 'x', isPaused: false}]);
    const output = lines();
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client, ...output.deps})).toBe(0);
    expect(client.log.filter((entry) => entry.call === 'delete').map((entry) => entry.args).sort()).toEqual(['scd_alarm-monitor_again', 'scd_dormant-identity-purge_again', 'scd_ledger-relay_again', 'scd_staging-cleanup_again', 'scd_stray']);
    expect(client.live.map((schedule) => schedule.scheduleId).sort()).toEqual(['scd_alarm-monitor', 'scd_dormant-identity-purge', 'scd_ledger-relay', 'scd_staging-cleanup']);
  });

  it('does NOT delete a schedule for no registered task, or a duplicate, whose destination is anything but this application\'s jobs URL: it names the schedule ID and the field, and exits 1 saying a person must remove it', async () => {
    const script = await load();
    const elsewhere = (id: string, destination: string, body: string) => ({scheduleId: id, cron: '* * * * *', destination, method: 'POST', body, isPaused: false});
    const foreignDuplicate = {...matching(script, '_other')[1], destination: 'https://old-deployment.example/api/jobs'};
    const live: Live[] = [
      ...matching(script),
      elsewhere('scd_foreign_unregistered', 'https://elsewhere.example/hook', 'not json'),
      elsewhere('scd_foreign_unknown_task', 'https://elsewhere.example/api/jobs', `{"task":"session-cleanup","instance":"${INSTANCE}"}`),
      elsewhere('scd_foreign_path', `${ORIGIN}/api/status`, 'x'),
      elsewhere('scd_foreign_origin', `${ORIGIN}.evil.example/api/jobs`, 'x'),
      elsewhere('scd_foreign_slash', `${ORIGIN}/api/jobs/`, 'x'),
      foreignDuplicate,
    ];
    const client = fakeClient(live);
    const output = lines();
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client, ...output.deps})).toBe(1);
    expect(callsOf(client)).not.toContain('delete');
    expect(callsOf(client)).not.toContain('create');
    expect(client.live).toHaveLength(live.length);
    const printed = output.out.join('\n');
    for (const id of ['scd_foreign_unregistered', 'scd_foreign_unknown_task', 'scd_foreign_path', 'scd_foreign_origin', 'scd_foreign_slash', foreignDuplicate.scheduleId]) {
      expect(printed, id).toMatch(new RegExp(`will NOT delete ${id} \\([^)]*field: destination\\)`));
      expect(output.err.join('\n'), id).toContain(id);
    }
    expect(output.err.join('\n')).toContain('a person');
    expect(output.err.join('\n')).toContain('by hand');
    // The destination of a schedule that is not this application's is not printed: its ID and the name of the field are enough to find it.
    expect(printed + output.err.join('\n')).not.toMatch(/elsewhere\.example|old-deployment|evil\.example/);
    // `check` still reports every one of them as drift, and exits 1.
    const checking = lines();
    expect(await script.run(['check'], {env, client, ...checking.deps})).toBe(1);
    for (const id of ['scd_foreign_unregistered', 'scd_foreign_unknown_task', 'scd_foreign_path', 'scd_foreign_origin', 'scd_foreign_slash', foreignDuplicate.scheduleId]) expect(checking.out.join('\n'), id).toContain(id);
    expect(checking.out.join('\n')).toContain('unregistered: scd_foreign_unregistered');
    expect(checking.out.join('\n')).toContain(`duplicate: ledger-relay has another schedule (${foreignDuplicate.scheduleId})`);
  });

  it('still does what is its own when a foreign schedule is also there: deletes the owned stray, creates what is missing, and exits 1 for the foreign one', async () => {
    const script = await load();
    const live: Live[] = [
      matching(script)[0],
      {scheduleId: 'scd_owned_stray', cron: '* * * * *', destination: `${ORIGIN}/api/jobs`, method: 'POST', body: 'x', isPaused: false},
      {scheduleId: 'scd_foreign', cron: '* * * * *', destination: 'https://elsewhere.example/', method: 'POST', body: 'x', isPaused: false},
    ];
    const client = fakeClient(live);
    const output = lines();
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client, ...output.deps})).toBe(1);
    expect(client.log.filter((entry) => entry.call === 'delete').map((entry) => entry.args)).toEqual(['scd_owned_stray']);
    expect(client.log.filter((entry) => entry.call === 'create')).toHaveLength(3);
    expect(client.live.map((schedule) => schedule.scheduleId).sort()).toEqual(['scd_dormant-identity-purge', 'scd_foreign', 'scd_new1', 'scd_new2', 'scd_new3']);
    expect(output.err.join('\n')).toContain('scd_foreign');
  });

  it('keeps the schedule that is right, or that already calls this application, and never makes the correct schedule the duplicate of a foreign one', async () => {
    const script = await load();
    const [purge, relay, cleanup, monitor] = matching(script);
    const foreignFirst = {...relay, scheduleId: 'scd_old_domain', destination: 'https://old-deployment.example/api/jobs'};
    // The foreign one is listed first; the one that is right is the one kept, and the foreign one is reported (and left alone).
    const client = fakeClient([purge, foreignFirst, relay, cleanup, monitor]);
    const output = lines();
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client, ...output.deps})).toBe(1);
    expect(callsOf(client)).toEqual(['list', 'list']);
    expect(output.out.join('\n')).toContain('will NOT delete scd_old_domain');
    expect(script.compareSchedules(script.desiredSchedules(config), [purge, foreignFirst, relay, cleanup, monitor])).toEqual([{kind: 'duplicate', task: 'ledger-relay', scheduleId: 'scd_old_domain'}]);
    // Of two schedules that both need a change, the one that already calls this application is the one corrected.
    const wrongCron = {...relay, scheduleId: 'scd_ours', cron: '*/10 * * * *'};
    expect(script.compareSchedules(script.desiredSchedules(config), [purge, foreignFirst, wrongCron, cleanup, monitor])).toEqual([
      {kind: 'duplicate', task: 'ledger-relay', scheduleId: 'scd_old_domain'},
      {kind: 'wrong', task: 'ledger-relay', scheduleId: 'scd_ours', fields: ['cron']},
    ]);
  });

  it('prints every change it is going to make BEFORE it makes the first one, by task or schedule ID', async () => {
    const script = await load();
    const timeline: string[] = [];
    const live: Live[] = [
      {...matching(script)[0], cron: '0 4 * * *'},
      {...matching(script)[1], isPaused: true},
      {scheduleId: 'scd_stray', cron: '* * * * *', destination: `${ORIGIN}/api/jobs`, method: 'POST', body: 'x', isPaused: false},
    ];
    const client = fakeClient(live, {timeline});
    const output = {out: (line: string) => timeline.push(`out:${line}`), err: (line: string) => timeline.push(`err:${line}`)};
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client, ...output})).toBe(0);
    const planned = timeline.filter((entry) => entry.startsWith('out:will '));
    // (Deletions come first, in the order QStash lists the schedules; then the creations, corrections and resumptions, in the registry's order.)
    expect(planned).toEqual([
      'out:will delete scd_stray (for no registered task)',
      'out:will update dormant-identity-purge (scd_dormant-identity-purge): cron',
      'out:will resume ledger-relay (scd_ledger-relay)',
      'out:will create the schedule of staging-cleanup',
      'out:will create the schedule of alarm-monitor',
    ]);
    const firstChange = timeline.findIndex((entry) => ['call:create', 'call:resume', 'call:delete'].includes(entry));
    const lastPlanned = timeline.lastIndexOf(planned[planned.length - 1]);
    expect(firstChange).toBeGreaterThan(lastPlanned);
    // ... and a creation is announced by task.
    const fresh = fakeClient([], {timeline: (timeline.length = 0, timeline)});
    await script.run(['apply', '--confirm', 'staging'], {env, client: fresh, out: (line) => timeline.push(`out:${line}`), err: () => undefined});
    expect(timeline.filter((entry) => entry.startsWith('out:will '))).toEqual(['out:will create the schedule of dormant-identity-purge', 'out:will create the schedule of ledger-relay', 'out:will create the schedule of staging-cleanup', 'out:will create the schedule of alarm-monitor']);
    expect(timeline.findIndex((entry) => entry === 'call:create')).toBeGreaterThan(timeline.lastIndexOf('out:will create the schedule of alarm-monitor'));
  });

  it('says nothing is going to change, and changes nothing, when the schedules are equal', async () => {
    const script = await load();
    const output = lines();
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client: fakeClient(matching(script)), ...output.deps})).toBe(0);
    expect(output.out.filter((line) => line.startsWith('will '))).toEqual([]);
  });

  it('does nothing, and says the schedules are equal, when they are', async () => {
    const script = await load();
    const client = fakeClient(matching(script));
    const output = lines();
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client, ...output.deps})).toBe(0);
    expect(callsOf(client)).toEqual(['list', 'list']);
  });

  it('checks again afterwards and exits 1 when QStash did not take the change', async () => {
    const script = await load();
    const client = fakeClient([], {ignoreWrites: true});
    const output = lines();
    expect(await script.run(['apply', '--confirm', 'staging'], {env, client, ...output.deps})).toBe(1);
    expect(output.err.join('\n')).toContain('still differ');
    expect(output.out.join('\n')).toContain('missing: no schedule for ledger-relay');
  });

  it('exits 1, naming the class of the failure only, when QStash refuses a write', async () => {
    const script = await load();
    for (const fail of ['create', 'delete', 'resume']) {
      const live = fail === 'create' ? [] : fail === 'delete' ? [...matching(script), ...matching(script, '_again')] : matching(script).map((schedule) => ({...schedule, isPaused: true}));
      const output = lines();
      expect(await script.run(['apply', '--confirm', 'staging'], {env, client: fakeClient(live, {fail}), ...output.deps}), fail).toBe(1);
      const printed = [...output.out, ...output.err].join('\n');
      expect(printed).toContain('QstashError');
      expect(printed).not.toContain(env.QSTASH_TOKEN);
    }
  });

  it('prints no token, in any run', async () => {
    const script = await load();
    const output = lines();
    await script.run(['apply', '--confirm', 'staging'], {env, client: fakeClient(), ...output.deps});
    await script.run(['check'], {env, client: fakeClient(), ...output.deps});
    expect([...output.out, ...output.err].join('\n')).not.toContain(env.QSTASH_TOKEN);
  });
});

describe('the command line entry point', () => {
  const temp = mkdtempSync(join(tmpdir(), 'nova3d-schedules-link-'));
  afterAll(() => rmSync(temp, {recursive: true, force: true}));
  const bare = {PATH: process.env.PATH ?? ''} as unknown as NodeJS.ProcessEnv;

  it('runs through a symlink, not silently doing nothing and exiting 0 as "the schedules are equal"', () => {
    const link = join(temp, 'link-to-schedules.mjs');
    symlinkSync(scriptPath, link);
    const direct = spawnSync(process.execPath, [scriptPath, 'list'], {encoding: 'utf8', env: bare});
    const linked = spawnSync(process.execPath, [link, 'list'], {encoding: 'utf8', env: bare});
    expect(linked.status).toBe(0);
    expect(linked.stdout).toBe(direct.stdout);
    expect(linked.stdout.trim().split('\n')).toHaveLength(4);
    // ... and a symlink to a symlink, and a symlinked directory, behave the same.
    const second = join(temp, 'second-link.mjs');
    symlinkSync(link, second);
    expect(spawnSync(process.execPath, [second, 'list'], {encoding: 'utf8', env: bare}).stdout).toBe(direct.stdout);
    const directory = join(temp, 'scripts-link');
    symlinkSync(resolve(import.meta.dirname, '../../scripts'), directory);
    expect(spawnSync(process.execPath, [join(directory, 'schedules.mjs'), 'list'], {encoding: 'utf8', env: bare}).stdout).toBe(direct.stdout);
    // A command that is wrong still fails loudly through the link, so a link cannot turn a failure into a quiet success.
    expect(spawnSync(process.execPath, [link, 'check'], {encoding: 'utf8', env: bare}).status).toBe(1);
    expect(spawnSync(process.execPath, [link, 'nope'], {encoding: 'utf8', env: bare}).status).toBe(2);
  });

  it('knows its own file by real path: the same file by a link is the entry point, another file is not, and a path that does not exist is not', async () => {
    const script = await load();
    const url = pathToFileURL(scriptPath).href;
    const link = join(temp, 'helper-link.mjs');
    symlinkSync(scriptPath, link);
    expect(script.isEntryPoint(url, scriptPath)).toBe(true);
    expect(script.isEntryPoint(url, link)).toBe(true);
    expect(script.isEntryPoint(url, resolve(import.meta.dirname, '../../scripts/config-toml.mjs'))).toBe(false);
    expect(script.isEntryPoint(url, join(temp, 'missing.mjs'))).toBe(false);
    expect(script.isEntryPoint(url, '')).toBe(false);
    expect(script.isEntryPoint(url, undefined)).toBe(false);
  });
});
