import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {parse} from 'yaml';
import {afterAll, describe, expect, it} from 'vitest';
import {isPlaceholder} from '@/lib/environment';
import {
  checkItem,
  checkProvisioning,
  evaluateEvidence,
  isPlaceholderSecret,
  itemsDueBy,
  parseBuildOrder,
  readLedger,
  renderGuide,
  secretNamesByEnvironment,
  validateLedger,
  type Ledger,
  type LedgerItem,
} from '@/lib/provisioning';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const pkg = JSON.parse(read('package.json'));

const buildOrder = parseBuildOrder(read('_bmad-output/implementation-artifacts/sprint-status.yaml'));
const committedText = read('provisioning/ledger.json');
const committed = readLedger(committedText, buildOrder).ledger as Ledger;

const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const today = dayOffset(0);
const goodEvidence = () => ({date: dayOffset(-1), ref: 'console-export-2026-10-01'});

/** What the checker must say about an item, from the item's own evidence and the variables it is run with. */
function expectedStatus(entry: LedgerItem, environment: string, variables: Record<string, string> = {}) {
  if (entry.kind === 'secret-present') return entry.secrets.every((name) => !isPlaceholderSecret(variables[name])) ? 'present' : 'missing';
  const verdict = evaluateEvidence((entry.evidence ?? {})[environment], today);
  return verdict.valid ? 'present' : verdict.missing ? 'missing' : 'invalid';
}

// ------------------------------------------------------------------ fixtures
// The build order is deliberately not numeric: 1-10 is built before 1-2, and 1-4 after 1-3.
const fixtureOrder = ['1-1', '1-10', '1-2', '1-3', '1-4', '1-5'];
const fixtureSprint = [
  'development_status:',
  '  epic-1: in-progress',
  '  1-1-seed: review',
  '  1-10-provision: in-progress',
  '  1-2-navigation: backlog',
  '  1-3-accounts: backlog',
  '  1-4-authentication: backlog',
  '  1-5-disable: backlog',
  '  epic-1-retrospective: optional',
  '',
].join('\n');

type FixtureItem = {id: string; service: string; title: string; kind: string; due: string; environments: string[]; secrets: string[]; howto: string[]; evidence: Record<string, unknown>};
type FixtureService = {id: string; name: string; owner: string; plan: string; region: string; spendBackstop: string; firstNeeded: string; limits: Array<Record<string, unknown>>};
type FixtureLedger = {version: number; environments: string[]; services: FixtureService[]; items: FixtureItem[]};

const item = (overrides: Partial<FixtureItem> = {}): FixtureItem => ({
  id: 'item',
  service: 'svc',
  title: 'An item',
  kind: 'attestation',
  due: '1-3',
  environments: ['staging'],
  secrets: [],
  howto: ['Do the thing.'],
  evidence: {},
  ...overrides,
});
function fixtureLedger(items: FixtureItem[]): FixtureLedger {
  const first = Math.min(...items.map((entry) => fixtureOrder.indexOf(entry.due)));
  return {
    version: 1,
    environments: ['local', 'staging', 'production'],
    services: [{id: 'svc', name: 'Service', owner: 'Josh', plan: 'Free', region: 'us-east-1', spendBackstop: 'None', firstNeeded: fixtureOrder[first], limits: []}],
    items,
  };
}

const scratch = mkdtempSync(join(tmpdir(), 'provisioning-test-'));
afterAll(() => rmSync(scratch, {recursive: true, force: true}));
// Every run reads this empty file, so a developer's real .env.local or .env.staging can never leak into a test.
const emptyEnvFile = join(scratch, 'empty.env');
writeFileSync(emptyEnvFile, '');
let counter = 0;
/** Writes a ledger (and, unless null, a sprint-status file) under a unique name; `prefix` names other files of the case. */
function files(ledger: unknown, sprint: string | null = fixtureSprint) {
  counter += 1;
  const prefix = join(scratch, `case-${counter}`);
  const ledgerPath = `${prefix}-ledger.json`;
  const sprintPath = `${prefix}-sprint-status.yaml`;
  writeFileSync(ledgerPath, typeof ledger === 'string' ? ledger : JSON.stringify(ledger, null, 2));
  if (sprint !== null) writeFileSync(sprintPath, sprint);
  return {ledgerPath, sprintPath, prefix};
}
function run(script: string, args: string[], env: Record<string, string> = {}) {
  // An explicit environment, so nothing the developer's shell holds can satisfy or disturb a check.
  const childEnv: Record<string, string | undefined> = {PATH: process.env.PATH, ...env};
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', script), ...args], {env: childEnv as NodeJS.ProcessEnv, encoding: 'utf8'});
  return {status: result.status, stdout: result.stdout, stderr: result.stderr, output: `${result.stdout}${result.stderr}`};
}
/** The empty env file for the checked environment; production reads no file at all. */
function envFileArgs(args: string[], env: Record<string, string>) {
  if (args.includes('--values-file')) return [];
  const at = args.indexOf('--env');
  const label = at === -1 ? env.APP_ENV : args[at + 1];
  return label === 'production' ? [] : ['--values-file', emptyEnvFile];
}
function check(ledger: unknown, args: string[], env: Record<string, string> = {}, sprint: string | null = fixtureSprint) {
  const {ledgerPath, sprintPath} = files(ledger, sprint);
  return run('check-provisioning.mjs', [...args, ...envFileArgs(args, env), '--ledger', ledgerPath, '--sprint-status', sprintPath], env);
}
/** The real ledger and the real build order. */
function checkCommitted(args: string[], env: Record<string, string> = {}) {
  return run('check-provisioning.mjs', [...args, ...envFileArgs(args, env)], env);
}

// ------------------------------------------------------------------ build order
describe('build order', () => {
  // Relative order of a few stable pairs, so renumbering or inserting a story elsewhere does not break this.
  it('follows the key order of sprint-status.yaml, not numeric story order', () => {
    const before = (first: string, second: string) => {
      expect(buildOrder, first).toContain(first);
      expect(buildOrder, second).toContain(second);
      expect(buildOrder.indexOf(first), `${first} before ${second}`).toBeLessThan(buildOrder.indexOf(second));
    };
    before('1-1', '1-10');
    before('1-10', '1-3');
    before('1-10', '1-2');
    before('1-4', '1-11');
    before('8-9', '8-4');
    expect(new Set(buildOrder).size).toBe(buildOrder.length);
  });

  it('lists every story key of the file and skips epics and retrospectives', () => {
    const keys = Object.keys((parse(read('_bmad-output/implementation-artifacts/sprint-status.yaml')) as {development_status: object}).development_status);
    const stories = keys.filter((key) => /^\d+-\d+-/.test(key));
    expect(buildOrder).toHaveLength(stories.length);
    expect(buildOrder.some((id) => id.startsWith('epic'))).toBe(false);
  });

  it('rejects a file it cannot use', () => {
    expect(() => parseBuildOrder('foo: [')).toThrow(/not valid YAML/);
    expect(() => parseBuildOrder('other: 1')).toThrow(/no development_status/);
    expect(() => parseBuildOrder('development_status:\n  epic-1: backlog')).toThrow(/no stories/);
    expect(() => parseBuildOrder('development_status:\n  1-1-a: x\n  1-1-b: y')).toThrow(/twice/);
  });
});

// ------------------------------------------------------------------ ledger content (AC-1)
describe('the committed ledger', () => {
  it('is valid against the real build order', () => {
    expect(readLedger(committedText, buildOrder).errors).toEqual([]);
  });

  it('records, for each service, an owner, plan, region, spend backstop and first-needed story', () => {
    for (const service of committed.services) {
      for (const field of ['owner', 'plan', 'region', 'spendBackstop'] as const) {
        expect(service[field].trim(), `${service.id} ${field}`).not.toBe('');
      }
      const own = committed.items.filter((entry) => entry.service === service.id);
      expect(own.length, service.id).toBeGreaterThan(0);
      const earliest = own.map((entry) => buildOrder.indexOf(entry.due)).sort((a, b) => a - b)[0];
      expect(service.firstNeeded, service.id).toBe(buildOrder[earliest]);
    }
  });

  it('gives every item a verification kind and every service with secrets their names per environment', () => {
    for (const entry of committed.items) expect(['secret-present', 'attestation']).toContain(entry.kind);
    // The public model-asset bucket holds public files only, so it has no secret to name.
    for (const service of committed.services.filter((entry) => entry.id !== 'public-model-assets')) {
      expect(Object.keys(secretNamesByEnvironment(committed, service.id)).length, service.id).toBeGreaterThan(0);
    }
  });

  it('covers every external service the Spine and the story name', () => {
    const ids = committed.services.map((service) => service.id);
    for (const id of ['google-oauth', 'supabase', 'vercel', 'github', 'resend', 'upstash', 'railway', 'anthropic', 'brave', 'stripe', 'public-model-assets', 'web-push', 'backblaze']) {
      expect(ids, id).toContain(id);
    }
  });

  it('seeds the Story 1.10 task list, each tagged with the story that first needs it', () => {
    const due = Object.fromEntries(committed.items.map((entry) => [entry.id, entry.due]));
    expect(due).toMatchObject({
      'google-oauth-client': '1-3',
      'vercel-staging-project': '1-4',
      'supabase-organization-plan': '1-4',
      'supabase-cli-credentials': '1-4',
      'github-staging-environment': '1-4',
      'resend-account': '1-6',
      'resend-api-key': '1-6',
      'resend-api-key-production': '1-6',
      'upstash-account': '1-9',
      'upstash-credentials': '1-9',
      'upstash-credentials-production': '1-9',
      'railway-account': '1-9',
      'ghcr-token': '1-9',
      'railway-project-token': '1-9',
      'anthropic-workspace-spend-limit': '2-5',
      'anthropic-api-key': '2-5',
      'anthropic-api-key-production': '2-5',
      'brave-prepaid-credit': '2-5',
      'brave-api-key': '2-5',
      'brave-api-key-production': '2-5',
      'brave-terms-review': '2-5',
      'vercel-pro-plan': '2-16',
      'stripe-account': '2-16',
      'stripe-live-mode': '8-7',
      'stripe-restricted-key': '2-16',
      'stripe-restricted-key-production': '8-7',
      'stripe-webhook-secret': '2-16',
      'stripe-webhook-secret-production': '8-7',
      'stripe-fees-tax-review': '2-16',
      'payment-terms-text': '2-16',
      'public-model-asset-bucket': '7-2',
      'vapid-keys': '7-7',
      'vapid-keys-production': '7-7',
      'backblaze-buckets': '8-9',
      'backblaze-read-only-keys': '8-9',
      'backblaze-read-only-keys-production': '8-9',
      'age-key-pair': '8-9',
      'age-public-key': '8-9',
      'age-public-key-production': '8-9',
      'supabase-restore-project-permission': '8-4',
    });
    const google = committed.items.find((entry) => entry.id === 'google-oauth-client');
    expect(google?.environments).toEqual(['local', 'staging', 'production']);
    expect(committed.items.find((entry) => entry.id === 'brave-terms-review')?.kind).toBe('attestation');
  });

  it('records the free-tier limits the design relies on, each with its upgrade trigger', () => {
    const limits = (id: string) => committed.services.find((service) => service.id === id)?.limits ?? [];
    expect(limits('vercel').map((limit) => limit.relied).join(' ')).toMatch(/4\.5 MB/);
    expect(limits('vercel').map((limit) => limit.relied).join(' ')).toMatch(/Hobby/);
    expect(limits('upstash').map((limit) => limit.relied).join(' ')).toMatch(/1,000 messages/);
    expect(limits('railway').map((limit) => limit.relied).join(' ')).toMatch(/shared by the CAD worker, the reconversion engine worker, the gateway and the backup service/);
    for (const id of ['vercel', 'upstash', 'railway']) {
      expect(limits(id).length, id).toBeGreaterThan(0);
      for (const limit of limits(id)) expect(limit.upgradeTrigger.trim(), id).not.toBe('');
    }
  });

  // Written so recording real evidence does not break it: the expectation comes from the ledger's own entries.
  it('passes an item only with a secret in the environment or a valid dated evidence entry', () => {
    for (const environment of committed.environments) {
      const outcome = checkProvisioning(committed, buildOrder, {story: buildOrder[buildOrder.length - 1], env: environment, processEnv: {}, today});
      expect(outcome.usageErrors).toEqual([]);
      expect(outcome.results.map((result) => result.id)).toEqual(itemsDueBy(committed, buildOrder, buildOrder[buildOrder.length - 1], environment).map((entry) => entry.id));
      for (const result of outcome.results) {
        const entry = committed.items.find((candidate) => candidate.id === result.id)!;
        expect(result.status, `${result.id} in ${environment}`).toBe(expectedStatus(entry, environment));
      }
      expect(outcome.ok).toBe(outcome.results.every((result) => expectedStatus(committed.items.find((candidate) => candidate.id === result.id)!, environment) === 'present'));
    }
  });

  it('checks no production value from a file: a production item is an attestation, and the howto text says where files may be used', () => {
    for (const entry of committed.items) {
      if (entry.environments.includes('production')) expect(entry.kind, entry.id).toBe('attestation');
      const text = entry.howto.join(' ');
      expect(text, entry.id).not.toContain('.env.production');
      if (text.includes('.env.staging')) expect(entry.environments, entry.id).toContain('staging');
      if (text.includes('.env.local')) expect(entry.environments, entry.id).toContain('local');
      if (text.includes('.env.')) expect(entry.environments, entry.id).not.toContain('production');
    }
    // Every environment that has a presence-checked key has a production sibling that is an attestation.
    for (const entry of committed.items.filter((candidate) => candidate.kind === 'secret-present')) {
      const sibling = committed.items.find((candidate) => candidate.id === `${entry.id}-production`);
      expect(sibling?.kind, entry.id).toBe('attestation');
      expect(sibling?.environments, entry.id).toEqual(['production']);
      expect(sibling?.secrets, entry.id).toEqual(entry.secrets);
      expect(sibling?.due, entry.id).toBe(entry.due === '2-16' ? '8-7' : entry.due);
    }
  });

  it('puts the Stripe live-mode and production items at Story 8.7 and keeps test mode and the account at Story 2.16', () => {
    const due = (id: string) => committed.items.find((entry) => entry.id === id)?.due;
    expect(due('stripe-live-mode')).toBe('8-7');
    expect(due('stripe-restricted-key-production')).toBe('8-7');
    expect(due('stripe-webhook-secret-production')).toBe('8-7');
    expect(committed.items.find((entry) => entry.id === 'stripe-live-mode')?.environments).toEqual(['production']);
    for (const id of ['stripe-account', 'stripe-restricted-key', 'stripe-webhook-secret', 'stripe-fees-tax-review', 'payment-terms-text']) expect(due(id), id).toBe('2-16');
    expect(committed.services.find((service) => service.id === 'stripe')?.firstNeeded).toBe('2-16');
  });

  it('uses a separate age key pair for each environment', () => {
    const pair = committed.items.find((entry) => entry.id === 'age-key-pair');
    expect(pair?.environments).toEqual(['staging', 'production']);
    expect(pair?.howto.join(' ')).toMatch(/separate pair for each environment/);
    expect(committed.items.find((entry) => entry.id === 'age-public-key')?.environments).toEqual(['staging']);
    expect(committed.items.find((entry) => entry.id === 'age-public-key-production')?.environments).toEqual(['production']);
  });

  it('holds only valid evidence, so a typo is caught here and not at check time', () => {
    for (const entry of committed.items) {
      for (const [environment, evidence] of Object.entries(entry.evidence)) {
        expect(evaluateEvidence(evidence, today), `${entry.id} ${environment}`).toEqual({valid: true});
      }
    }
  });

  it('holds names, dates and references only: no field can carry a value', () => {
    const secretNames = committed.items.flatMap((entry) => entry.secrets);
    expect(secretNames.length).toBeGreaterThan(0);
    for (const name of secretNames) expect(name).toMatch(/^[A-Z][A-Z0-9_]{2,63}$/);
    const withField = JSON.parse(committedText);
    withField.items[0].value = 'abc';
    expect(validateLedger(withField, buildOrder).join()).toContain('unknown field value');
  });
});

describe('ledger validation', () => {
  const valid = () => fixtureLedger([item({id: 'a', due: '1-3'}), item({id: 'b', kind: 'secret-present', secrets: ['SOME_API_KEY'], due: '1-4'})]);
  type L = FixtureLedger;
  const errorsFor = (mutate: (ledger: L) => void) => {
    const ledger = valid();
    mutate(ledger);
    return validateLedger(ledger, fixtureOrder).join('\n');
  };

  it('accepts a well-formed ledger', () => {
    expect(validateLedger(valid(), fixtureOrder)).toEqual([]);
  });

  it.each([
    ['a due story outside the build order', (l: L) => void (l.items[0].due = '9-9'), 'due must be a story in the build order'],
    ['an unknown service', (l: L) => void (l.items[0].service = 'nope'), 'service must be one of'],
    ['a duplicate item id', (l: L) => void (l.items[1].id = 'a'), 'duplicate item id'],
    ['a secret that is a value, not a name', (l: L) => void (l.items[1].secrets = ['abc123def']), 'variable names'],
    ['a secret-present item with no variable', (l: L) => void (l.items[1].secrets = []), 'at least one variable'],
    ['evidence on a secret-present item', (l: L) => void (l.items[1].evidence = {staging: goodEvidence()}), 'holds no evidence'],
    ['evidence for an environment the item does not list', (l: L) => void (l.items[0].evidence = {production: goodEvidence()}), 'does not list'],
    ['an environment that does not exist', (l: L) => void (l.items[0].environments = ['qa']), 'not in ledger.environments'],
    ['a first-needed story that is not the earliest due', (l: L) => void (l.services[0].firstNeeded = '1-5'), 'firstNeeded must be 1-3'],
    ['a missing owner', (l: L) => void (l.services[0].owner = ' '), 'owner is required'],
    ['a free-tier limit without an upgrade trigger', (l: L) => void (l.services[0].limits = [{relied: 'x'}]), 'upgradeTrigger'],
    ['no how-to steps', (l: L) => void (l.items[0].howto = []), 'howto'],
    ['an unknown verification kind', (l: L) => void (l.items[0].kind = 'trust-me'), 'kind must be'],
    ['a secret-present item that covers production', (l: L) => void (l.items[1].environments = ['staging', 'production']), 'cannot cover production'],
    ['a secret-present item for production alone', (l: L) => void (l.items[1].environments = ['production']), 'cannot cover production'],
  ])('rejects %s', (_name, mutate, message) => {
    expect(errorsFor(mutate)).toContain(message);
  });

  it('accepts an attestation that covers production, and a secret-present item for local and staging', () => {
    const ledger = valid();
    ledger.items[0].environments = ['staging', 'production'];
    ledger.items[1].environments = ['local', 'staging'];
    expect(validateLedger(ledger, fixtureOrder)).toEqual([]);
  });

  describe('single-line fields (so generated Markdown cannot be broken)', () => {
    const breaks = ['\n', '\r\n', '\r', '\u2028'];
    const cases: Array<[string, (l: L, text: string) => void]> = [
      ['service name', (l, text) => void (l.services[0].name = `Name${text}## Injected heading`)],
      ['service owner', (l, text) => void (l.services[0].owner = `Josh${text}x`)],
      ['service plan', (l, text) => void (l.services[0].plan = `Free${text}x`)],
      ['service region', (l, text) => void (l.services[0].region = `us-east-1${text}x`)],
      ['spend backstop', (l, text) => void (l.services[0].spendBackstop = `None${text}x`)],
      ['limit relied', (l, text) => void (l.services[0].limits = [{relied: `a${text}b`, upgradeTrigger: 'c'}])],
      ['limit upgrade trigger', (l, text) => void (l.services[0].limits = [{relied: 'a', upgradeTrigger: `b${text}c`}])],
      ['item title', (l, text) => void (l.items[0].title = `Title${text}x`)],
      ['how-to step', (l, text) => void (l.items[0].howto = ['fine', `step${text}- injected`])],
    ];
    for (const [label, mutate] of cases) {
      it.each(breaks)(`rejects a line break in the ${label} (%j)`, (text) => {
        expect(errorsFor((ledger) => mutate(ledger, text))).toContain('must be a single line');
      });
    }

    it('rejects a line break in the notice', () => {
      const ledger = valid() as FixtureLedger & {notice?: string};
      ledger.notice = 'one\ntwo';
      expect(validateLedger(ledger, fixtureOrder).join()).toContain('notice must be a single line');
    });

    it('still accepts ordinary punctuation and long single lines', () => {
      expect(errorsFor((ledger) => void (ledger.items[0].howto = ['Use `code`, "quotes", | pipes and (parentheses) - all on one line. '.repeat(10).trim()]))).toBe('');
    });
  });

  it('reports unparseable input without echoing it', () => {
    expect(readLedger('{not json', fixtureOrder).errors).toEqual(['ledger is not valid JSON']);
    expect(validateLedger([], fixtureOrder)).toEqual(['ledger must be a JSON object']);
  });
});

// ------------------------------------------------------------------ evidence
describe('evaluateEvidence', () => {
  it('accepts a dated entry that names an export', () => {
    expect(evaluateEvidence(goodEvidence(), today)).toEqual({valid: true});
    expect(evaluateEvidence({date: today, ref: 'Supabase org (billing).pdf'}, today)).toEqual({valid: true});
  });

  it.each([
    'ייצוא הגדרות קונסולה 2026',
    'Écran Supabase (facturation)',
    '设置导出 2026-10-09',
    "Josh's console export, part 2 & 3 + notes",
    'Screenshot 2026-10-09 at 9.41.07\u202FAM.png',
  ])('accepts the Unicode or punctuated name %j', (ref) => {
    expect(evaluateEvidence({date: today, ref}, today)).toEqual({valid: true});
  });

  it('accepts a date up to one day ahead of UTC, so a correct local date is not rejected east of Greenwich', () => {
    expect(evaluateEvidence({date: dayOffset(1), ref: 'console-export-name'}, today)).toEqual({valid: true});
    expect(evaluateEvidence({date: dayOffset(2), ref: 'console-export-name'}, today)).toMatchObject({valid: false, missing: false});
  });

  it.each(['tbd', 'TBA', 'None', 'pending', 'Test', 'example', 'EXPORT', 'exports', 'xxx', 'XXXXXX', 'todo', 'placeholder', '...', '---'])('refuses the filler reference %j', (ref) => {
    const verdict = evaluateEvidence({date: today, ref}, today);
    expect(verdict).toMatchObject({valid: false, missing: false});
    expect(verdict.valid === false && verdict.reason).toMatch(/filler|plain export name/);
  });

  it('refuses control characters and separators that are not part of a file name', () => {
    for (const ref of ['name\nwith break', 'name/with/slash', 'name\\back', 'name:colon', 'name\ttab', 'a<b>c', 'name;rm']) {
      expect(evaluateEvidence({date: today, ref}, today), JSON.stringify(ref)).toMatchObject({valid: false});
    }
  });

  it('treats an absent entry as missing, not invalid', () => {
    expect(evaluateEvidence(undefined, today)).toMatchObject({valid: false, missing: true});
  });

  it.each([
    ['a malformed date', {date: '10/09/2026', ref: 'export-name'}, 'malformed'],
    ['an impossible date', {date: '2026-02-30', ref: 'export-name'}, 'malformed'],
    ['a missing date', {ref: 'export-name'}, 'malformed'],
    ['a date two days ahead', {date: dayOffset(2), ref: 'export-name'}, 'in the future'],
    ['a far future date', {date: '2999-01-01', ref: 'export-name'}, 'in the future'],
    ['no reference name', {date: today}, 'reference name is missing'],
    ['a blank reference name', {date: today, ref: '   '}, 'reference name is missing'],
    ['a URL as the reference', {date: today, ref: 'https://example.com/export'}, 'plain export name'],
    ['a path as the reference', {date: today, ref: '../exports/file.pdf'}, 'plain export name'],
    ['a placeholder reference', {date: today, ref: 'replace-with-export-name'}, 'plain export name'],
    ['an extra field that could carry a value', {date: today, ref: 'export-name', value: 'x'}, 'other than date and ref'],
    ['a string instead of an entry', 'done', 'malformed'],
  ])('rejects %s as invalid, not missing', (_name, entry, reason) => {
    const verdict = evaluateEvidence(entry, today);
    expect(verdict).toMatchObject({valid: false, missing: false});
    expect(verdict.valid === false && verdict.reason).toContain(reason);
  });

  it('never echoes the entry in its reason', () => {
    const verdict = evaluateEvidence({date: 'marker-should-not-appear', ref: 'x'}, today);
    expect(JSON.stringify(verdict)).not.toContain('marker-should-not-appear');
  });
});

// ------------------------------------------------------------------ placeholder secret values
describe('isPlaceholderSecret (provisioning only; isPlaceholder keeps its meaning for the environment checks)', () => {
  it.each([
    undefined, '', '   ', 'undefined', 'null', 'NULL', 'none', 'None', 'n/a', 'tbd', 'xxx', 'XXXXXXXX', 'x-x-x', '***', '...', 'your-key-here', 'Your Key Here', 'your_api_key', 'insert-key', 'put-key-here',
    'replace-with-the-real-key', '<mailer-key>', 'changeme', 'TODO', '${MAILER_API_KEY}', '$MAILER_API_KEY', '[token]', '"none"', "'xxx'", 'secret', 'password', 'test', 'example',
  ])('treats %j as a placeholder', (value) => {
    expect(isPlaceholderSecret(value)).toBe(true);
  });

  it.each(['canary-value-that-must-never-be-printed-0123456789', 'a1b2c3d4e5f6', 'todos-and-more', 'yourself123', 'noneofthis-is-placeholder-xyz', 'xxy'])('treats %j as a real value', (value) => {
    expect(isPlaceholderSecret(value)).toBe(false);
  });

  it('leaves the environment checks as they were', () => {
    for (const value of ['none', 'null', 'undefined', 'xxx', 'your-key-here']) expect(isPlaceholder(value), value).toBe(false);
    for (const value of ['replace-with-x', '<x>', 'changeme', 'todo']) expect(isPlaceholder(value), value).toBe(true);
  });
});

// ------------------------------------------------------------------ selection
describe('items due by a story (build order, not numeric order)', () => {
  const ledger = readLedger(
    JSON.stringify(
      fixtureLedger([
        item({id: 'due-1-10', due: '1-10'}),
        item({id: 'due-1-2', due: '1-2'}),
        item({id: 'due-1-3', due: '1-3'}),
        item({id: 'due-1-4', due: '1-4'}),
        item({id: 'other-env', due: '1-3', environments: ['production']}),
      ]),
    ),
    fixtureOrder,
  ).ledger as Ledger;
  const ids = (story: string, env = 'staging') => itemsDueBy(ledger, fixtureOrder, story, env).map((entry) => entry.id);

  it('includes an item due 1-10 for 1-3 because 1-10 is built before 1-3, and ignores one due 1-4', () => {
    expect(ids('1-3')).toEqual(['due-1-10', 'due-1-2', 'due-1-3']);
  });

  it('includes the due-by story itself and nothing built later', () => {
    expect(ids('1-10')).toEqual(['due-1-10']);
    expect(ids('1-1')).toEqual([]);
    expect(ids('1-4')).toEqual(['due-1-10', 'due-1-2', 'due-1-3', 'due-1-4']);
  });

  it('keeps to the checked environment and returns nothing for an unknown story', () => {
    expect(ids('1-3', 'production')).toEqual(['other-env']);
    expect(ids('9-9')).toEqual([]);
  });

  it('matches the real build order for the committed ledger', () => {
    const through = (story: string) => itemsDueBy(committed, buildOrder, story, 'staging').map((entry) => entry.due);
    expect(through('1-3')).toEqual(['1-3']);
    expect(new Set(through('1-9'))).toEqual(new Set(['1-3', '1-4', '1-6', '1-9']));
    expect(through('2-5')).not.toContain('2-16');
    expect(through('8-9')).not.toContain('8-4');
    expect(through('8-4')).toContain('8-4');
  });
});

// ------------------------------------------------------------------ the checker, row by row (AC-2, AC-3)
describe('check-provisioning', () => {
  const canary = 'canary-value-that-must-never-be-printed-0123456789';

  const allSatisfied = () =>
    fixtureLedger([
      item({id: 'oauth-client', due: '1-3', evidence: {staging: goodEvidence()}}),
      item({id: 'mailer-key', kind: 'secret-present', secrets: ['MAILER_API_KEY', 'MAILER_OTHER_KEY'], due: '1-4'}),
    ]);

  it('lists the items as present and exits 0 when every item due by the story is satisfied', () => {
    const result = check(allSatisfied(), ['--story', '1-4', '--env', 'staging'], {MAILER_API_KEY: canary, MAILER_OTHER_KEY: `${canary}-2`});
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/present\s+oauth-client/);
    expect(result.stdout).toMatch(/present\s+mailer-key/);
    expect(result.output).not.toContain(canary);
  });

  it('exits 1 and names the item, its story and the variable when a secret is unset, never printing a value', () => {
    const result = check(allSatisfied(), ['--story', '1-4', '--env', 'staging'], {MAILER_API_KEY: canary});
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/MISSING\s+mailer-key\s+\(secret-present, due 1-4\)\s+MAILER_OTHER_KEY is unset/);
    expect(result.output).toContain('MAILER_OTHER_KEY');
    expect(result.output).not.toContain(canary);
  });

  it.each(['replace-with-the-real-key', '<mailer-key>', 'changeme', 'todo', 'undefined', 'null', 'none', 'xxxxxxxx', 'your-key-here', '${MAILER_API_KEY}', '   '])('treats %j as missing and does not print it', (value) => {
    const result = check(allSatisfied(), ['--story', '1-4', '--env', 'staging'], {MAILER_API_KEY: value, MAILER_OTHER_KEY: canary});
    expect(result.status).toBe(1);
    expect(result.output).toContain('MAILER_API_KEY');
    expect(result.output).not.toContain(canary);
    if (value.trim()) expect(result.output).not.toContain(value);
  });

  it('ignores items due later than the checked story', () => {
    const result = check(allSatisfied(), ['--story', '1-3', '--env', 'staging']);
    expect(result.status).toBe(0);
    expect(result.output).not.toContain('mailer-key');
  });

  it('includes the due-by story itself', () => {
    const result = check(fixtureLedger([item({id: 'oauth-client', due: '1-3'})]), ['--story', '1-3', '--env', 'staging']);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/MISSING\s+oauth-client\s+\(attestation, due 1-3\)/);
  });

  it('is missing, exit 1, for an attestation with no dated evidence for that environment', () => {
    const ledger = fixtureLedger([item({id: 'oauth-client', due: '1-3', environments: ['staging', 'production'], evidence: {staging: goodEvidence()}})]);
    expect(check(ledger, ['--story', '1-3', '--env', 'staging']).status).toBe(0);
    const production = check(ledger, ['--story', '1-3', '--env', 'production']);
    expect(production.status).toBe(1);
    expect(production.output).toMatch(/MISSING\s+oauth-client/);
    expect(production.output).toContain('no dated evidence for production');
  });

  it.each([
    ['a malformed date', {date: 'yesterday', ref: 'export-name'}],
    ['a future date', {date: '2999-01-01', ref: 'export-name'}],
    ['no reference name', {date: today}],
  ])('treats %s as invalid, counts it as missing and exits 1', (_name, evidence) => {
    const result = check(fixtureLedger([item({id: 'oauth-client', due: '1-3', evidence: {staging: evidence}})]), ['--story', '1-3', '--env', 'staging']);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/INVALID\s+oauth-client/);
    expect(result.output).not.toContain('2999');
  });

  it('applies the build order: story 1-3 includes an item due 1-10 and ignores one due 1-4', () => {
    const ledger = fixtureLedger([item({id: 'early', due: '1-10'}), item({id: 'late', due: '1-4'})]);
    const result = check(ledger, ['--story', '1-3', '--env', 'staging']);
    expect(result.status).toBe(1);
    expect(result.output).toContain('early');
    expect(result.output).not.toContain('late');
  });

  it('exits 2 for an unknown story, an unknown environment or a missing option', () => {
    const ledger = allSatisfied();
    expect(check(ledger, ['--story', '9-9', '--env', 'staging']).status).toBe(2);
    expect(check(ledger, ['--story', 'abc', '--env', 'staging']).status).toBe(2);
    expect(check(ledger, ['--story', '1-3', '--env', 'qa']).status).toBe(2);
    expect(check(ledger, ['--env', 'staging']).status).toBe(2);
    expect(check(ledger, ['--story', '1-3']).status).toBe(2);
    expect(check(ledger, ['--story', '1-3', '--env', 'staging', '--nope']).status).toBe(2);
    expect(check(ledger, ['--story', '1-3', '--story', '1-4', '--env', 'staging']).status).toBe(2);
  });

  it('defaults --env to APP_ENV', () => {
    expect(check(allSatisfied(), ['--story', '1-3'], {APP_ENV: 'staging'}).status).toBe(0);
    expect(check(allSatisfied(), ['--story', '1-3'], {APP_ENV: 'qa'}).status).toBe(2);
  });

  it('exits 2 when APP_ENV is set and differs from --env, naming both labels and no value', () => {
    const env = {APP_ENV: 'local', MAILER_API_KEY: canary, MAILER_OTHER_KEY: canary};
    const result = check(allSatisfied(), ['--story', '1-4', '--env', 'staging'], env);
    expect(result.status).toBe(2);
    expect(result.output).toMatch(/APP_ENV is local but --env is staging/);
    expect(result.output).not.toContain(canary);
    expect(check(allSatisfied(), ['--story', '1-4', '--env', 'production'], {APP_ENV: 'staging'}).status).toBe(2);
    // The same label, or no APP_ENV, is fine; an unprintable APP_ENV is not echoed.
    expect(check(allSatisfied(), ['--story', '1-3', '--env', 'staging'], {APP_ENV: 'staging'}).status).toBe(0);
    const odd = check(allSatisfied(), ['--story', '1-3', '--env', 'staging'], {APP_ENV: `sk_live_${'a1'.repeat(12)} x`});
    expect(odd.status).toBe(2);
    expect(odd.output).not.toContain('sk_live_');
  });

  it('does not echo an unknown option, which may be a pasted secret', () => {
    const secret = `${'sk'}_${'live'}_${'a1'.repeat(12)}`;
    const base = ['--story', '1-3', '--env', 'staging'];
    for (const argument of [secret, `--${secret}`, `--token=${secret}`, `--Token=${secret}`, `-${secret}`]) {
      const result = check(allSatisfied(), [...base, argument]);
      expect(result.status, argument).toBe(2);
      expect(result.output, argument).not.toContain(secret);
      expect(result.output, argument).toContain('Unknown option');
    }
    expect(check(allSatisfied(), [...base, secret]).output).toContain('(unprintable)');
    expect(check(allSatisfied(), [...base, '--nope']).output).toContain('--nope');
    // A known option is named in its own errors, never its value.
    expect(check(allSatisfied(), ['--story', secret, '--env', 'staging']).output).not.toContain(secret);
  });

  describe('--values-file (what npm run check:provisioning loads for local and staging)', () => {
    const keyed = () => fixtureLedger([item({id: 'mailer-key', kind: 'secret-present', secrets: ['MAILER_API_KEY'], due: '1-3'})]);
    const envFile = (text: string) => {
      counter += 1;
      const path = join(scratch, `values-${counter}.env`);
      writeFileSync(path, text);
      return path;
    };

    it('reads secret-present values from the file, without printing them', () => {
      const result = check(keyed(), ['--story', '1-3', '--env', 'staging', '--values-file', envFile(`APP_ENV=staging\nMAILER_API_KEY=${canary}\n`)]);
      expect(result.status).toBe(0);
      expect(result.output).toMatch(/present\s+mailer-key/);
      expect(result.output).not.toContain(canary);
    });

    it('lets a variable already in the shell win over the file', () => {
      const file = envFile('MAILER_API_KEY=replace-with-the-real-key\n');
      expect(check(keyed(), ['--story', '1-3', '--env', 'staging', '--values-file', file]).status).toBe(1);
      expect(check(keyed(), ['--story', '1-3', '--env', 'staging', '--values-file', file], {MAILER_API_KEY: canary}).status).toBe(0);
    });

    it('treats a placeholder in the file as missing', () => {
      const result = check(keyed(), ['--story', '1-3', '--env', 'staging', '--values-file', envFile('MAILER_API_KEY=your-key-here\n')]);
      expect(result.status).toBe(1);
      expect(result.output).toContain('MAILER_API_KEY is a placeholder');
    });

    it('refuses a file whose APP_ENV is another environment', () => {
      const result = check(keyed(), ['--story', '1-3', '--env', 'staging', '--values-file', envFile(`APP_ENV=production\nMAILER_API_KEY=${canary}\n`)]);
      expect(result.status).toBe(2);
      expect(result.output).toMatch(/APP_ENV is production but --env is staging/);
      expect(result.output).not.toContain(canary);
    });

    it('exits 2 for a file that does not exist, and never loads a file for production', () => {
      expect(check(keyed(), ['--story', '1-3', '--env', 'staging', '--values-file', join(scratch, 'missing.env')]).status).toBe(2);
      const production = check(keyed(), ['--story', '1-3', '--env', 'production', '--values-file', envFile(`MAILER_API_KEY=${canary}\n`)]);
      expect(production.status).toBe(2);
      expect(production.output).toContain('production');
      expect(production.output).not.toContain(canary);
    });

    it('loads .env.staging and .env.local by default and never reads a file for production', () => {
      // A copy of the scripts in a scratch tree, so the default file locations can hold test values.
      counter += 1;
      const tree = join(scratch, `tree-${counter}`);
      mkdirSync(join(tree, 'scripts'), {recursive: true});
      mkdirSync(join(tree, 'lib'));
      writeFileSync(join(tree, 'package.json'), '{"type": "module"}');
      for (const file of ['scripts/check-provisioning.mjs', 'lib/provisioning.ts', 'lib/environment.ts']) copyFileSync(resolve(root, file), join(tree, file));
      symlinkSync(resolve(root, 'node_modules'), join(tree, 'node_modules'), 'dir');
      writeFileSync(join(tree, '.env.staging'), `APP_ENV=staging\nMAILER_API_KEY=${canary}\n`);
      writeFileSync(join(tree, '.env.local'), 'MAILER_API_KEY=changeme\n');
      mkdirSync(join(tree, '.env.production')); // a directory: reading it for production would fail the run
      const {ledgerPath, sprintPath} = files(
        fixtureLedger([
          item({id: 'mailer-key', kind: 'secret-present', secrets: ['MAILER_API_KEY'], environments: ['local', 'staging'], due: '1-3'}),
          item({id: 'hosted-key', environments: ['production'], secrets: ['MAILER_API_KEY'], evidence: {production: goodEvidence()}, due: '1-3'}),
        ]),
      );
      const runTree = (args: string[]) => {
        const childEnv: Record<string, string | undefined> = {PATH: process.env.PATH};
        const result = spawnSync(process.execPath, [join(tree, 'scripts/check-provisioning.mjs'), ...args, '--ledger', ledgerPath, '--sprint-status', sprintPath], {env: childEnv as NodeJS.ProcessEnv, encoding: 'utf8'});
        return {status: result.status, output: `${result.stdout}${result.stderr}`};
      };
      const staging = runTree(['--story', '1-3', '--env', 'staging']);
      expect(staging.status).toBe(0);
      expect(staging.output).not.toContain(canary);
      const local = runTree(['--story', '1-3', '--env', 'local']);
      expect(local.status).toBe(1);
      expect(local.output).toContain('MAILER_API_KEY is a placeholder');
      expect(runTree(['--story', '1-3', '--env', 'production']).status).toBe(0);
    });

    it('rejects a ledger whose secret-present item covers production, before reading any value', () => {
      const bad = fixtureLedger([item({id: 'mailer-key', kind: 'secret-present', secrets: ['MAILER_API_KEY'], environments: ['staging', 'production'], due: '1-3'})]);
      const result = check(bad, ['--story', '1-3', '--env', 'staging'], {MAILER_API_KEY: canary});
      expect(result.status).toBe(2);
      expect(result.output).toContain('cannot cover production');
      expect(result.output).not.toContain(canary);
    });
  });

  it('says nothing is due, and exits 0, for a story that no item waits on', () => {
    const fixtureResult = check(fixtureLedger([item({id: 'later', due: '1-3'})]), ['--story', '1-1', '--env', 'staging']);
    expect(fixtureResult.status).toBe(0);
    expect(fixtureResult.stdout).toContain('Passed: nothing is due by 1-1 for staging.');
    const real = checkCommitted(['--story', '1-1', '--env', 'staging']);
    expect(real.status).toBe(0);
    expect(real.stdout).toContain('Passed: nothing is due by 1-1 for staging.');
  });

  it('reports a ledger item whose evidence key is omitted as missing, without crashing', () => {
    const bare = fixtureLedger([item({id: 'oauth-client', due: '1-3'})]);
    delete (bare.items[0] as Partial<FixtureItem>).evidence;
    expect(validateLedger(bare, fixtureOrder)).toEqual([]);
    const result = check(bare, ['--story', '1-3', '--env', 'staging']);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/MISSING\s+oauth-client/);
    expect(result.output).not.toMatch(/TypeError|at .*node:/);
    // The library tolerates the omission too, with or without readLedger normalizing it.
    const raw = JSON.parse(JSON.stringify(bare)).items[0] as LedgerItem;
    expect(checkItem(raw, 'staging', {}, today)).toMatchObject({status: 'missing'});
  });

  it('passes an attestation that names secrets when its evidence is valid, whether or not those variables are set', () => {
    const ledger = fixtureLedger([item({id: 'oauth-client', due: '1-3', secrets: ['SOME_CLIENT_SECRET', 'SOME_CLIENT_ID'], evidence: {staging: goodEvidence()}})]);
    const result = check(ledger, ['--story', '1-3', '--env', 'staging']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/present\s+oauth-client/);
    expect(result.output).not.toContain('SOME_CLIENT_SECRET');
  });

  it('words the pass message correctly for one item and for several', () => {
    const one = check(fixtureLedger([item({id: 'only-one', due: '1-3', evidence: {staging: goodEvidence()}})]), ['--story', '1-3', '--env', 'staging']);
    expect(one.stdout).toContain('Passed: 1 item due by 1-3 is present.');
    expect(one.stdout).not.toContain('all 1 items');
    const two = check(fixtureLedger([item({id: 'a', due: '1-3', evidence: {staging: goodEvidence()}}), item({id: 'b', due: '1-3', evidence: {staging: goodEvidence()}})]), ['--story', '1-3', '--env', 'staging']);
    expect(two.stdout).toContain('Passed: all 2 items due by 1-3 are present.');
    expect(two.stdout).toContain('(2 items due)');
    expect(one.stdout).toContain('(1 item due)');
  });

  it('a fresh ledger is entirely pending: every item is missing and the check fails', () => {
    const fresh = fixtureLedger([
      item({id: 'account', due: '1-3'}),
      item({id: 'plan', due: '1-4', environments: ['staging', 'production']}),
      item({id: 'api-key', kind: 'secret-present', secrets: ['SOME_API_KEY'], due: '1-4'}),
    ]);
    const result = check(fresh, ['--story', '1-4', '--env', 'staging']);
    expect(result.status).toBe(1);
    for (const id of ['account', 'plan', 'api-key']) expect(result.output).toMatch(new RegExp(`MISSING\\s+${id}\\s`));
    expect(result.output).toContain('Failed: 3 missing, 0 invalid, 0 present.');
  });

  it('exits 2 when sprint-status.yaml is unreadable or unusable', () => {
    const ledger = allSatisfied();
    expect(check(ledger, ['--story', '1-3', '--env', 'staging'], {}, null).status).toBe(2);
    expect(check(ledger, ['--story', '1-3', '--env', 'staging'], {}, 'development_status: [').status).toBe(2);
    expect(check(ledger, ['--story', '1-3', '--env', 'staging'], {}, 'project: x\n').status).toBe(2);
  });

  it('exits 2 for a ledger it cannot trust, and says why without echoing a value', () => {
    const bad = allSatisfied();
    (bad.items[0] as unknown as Record<string, unknown>).value = canary;
    const result = check(bad, ['--story', '1-3', '--env', 'staging']);
    expect(result.status).toBe(2);
    expect(result.output).toContain('unknown field value');
    expect(result.output).not.toContain(canary);
    expect(check('{not json', ['--story', '1-3', '--env', 'staging']).status).toBe(2);
  });

  it('prints item IDs, stories and variable names only, whatever the environment holds', () => {
    const env = {MAILER_API_KEY: canary, MAILER_OTHER_KEY: canary, APP_ENV: 'staging', SUPABASE_SERVICE_ROLE_KEY: `${canary}-service`};
    for (const ledger of [allSatisfied(), fixtureLedger([item({id: 'a', kind: 'secret-present', secrets: ['MAILER_API_KEY', 'MISSING_ONE_KEY']})])]) {
      const result = check(ledger, ['--story', '1-5', '--env', 'staging'], env);
      expect(result.output).not.toContain(canary);
    }
  });

  // The expected outcome comes from the ledger's own evidence, so recording real evidence does not break this.
  it('runs against the committed ledger and names exactly the items that are not yet satisfied, without values', () => {
    for (const [story, environment] of [['1-3', 'staging'], ['1-6', 'staging'], ['2-5', 'local'], ['8-9', 'production']]) {
      const due = itemsDueBy(committed, buildOrder, story, environment);
      const expectedUnsatisfied = due.filter((entry) => expectedStatus(entry, environment, {RESEND_API_KEY: canary}) !== 'present').map((entry) => entry.id);
      const result = checkCommitted(['--story', story, '--env', environment], {RESEND_API_KEY: canary});
      expect(result.status, `${story} ${environment}`).toBe(expectedUnsatisfied.length ? 1 : 0);
      const named = [...result.output.matchAll(/^\s+(?:MISSING|INVALID)\s+(\S+)/gm)].map((match) => match[1]);
      expect(named, `${story} ${environment}`).toEqual(expectedUnsatisfied);
      // Items due later than the story are never named.
      for (const entry of committed.items.filter((candidate) => !due.includes(candidate))) expect(result.output, entry.id).not.toMatch(new RegExp(`\\s${entry.id}\\s`));
      expect(result.output).not.toContain(canary);
    }
  });
});

// ------------------------------------------------------------------ the guide (AC-1)
describe('provisioning guide', () => {
  const guide = renderGuide(committed, buildOrder, today);
  const pendingFixture = readLedger(JSON.stringify(fixtureLedger([item({id: 'oauth-client', due: '1-3'}), item({id: 'api-key', kind: 'secret-present', secrets: ['SOME_API_KEY'], due: '1-4'})])), fixtureOrder).ledger as Ledger;

  it('is current: docs/provisioning.md is the rendered ledger', () => {
    expect(read('docs/provisioning.md')).toBe(guide);
    expect(run('render-provisioning.mjs', ['--check']).status).toBe(0);
  });

  it('renders deterministically, and the date matters only to whether a recorded date is still too far ahead', () => {
    expect(renderGuide(committed, buildOrder, today)).toBe(guide);
    expect(guide.endsWith('\n')).toBe(true);
    expect(renderGuide(pendingFixture, fixtureOrder, '2000-01-01')).toBe(renderGuide(pendingFixture, fixtureOrder, '2999-12-31'));
  });

  it('explains the check command with the env file, the production rule and the evidence rules', () => {
    expect(guide).toContain('node --env-file-if-exists=.env.staging scripts/check-provisioning.mjs --story <id> --env staging');
    expect(guide).toContain('npm run check:provisioning -- --story <id> --env <local|staging|production>');
    expect(guide).toMatch(/A production secret never sits in a local file/);
    expect(guide).toMatch(/If `APP_ENV` is set it must equal `--env`/);
    expect(guide).toMatch(/up to one day ahead of UTC/);
    expect(guide).toMatch(/filler such as `tbd`/);
  });

  it('shows every service, item, secret name, free-tier limit and how-to step', () => {
    for (const service of committed.services) {
      expect(guide).toContain(`### ${service.name}`);
      for (const limit of service.limits) expect(guide).toContain(limit.upgradeTrigger);
    }
    for (const entry of committed.items) {
      expect(guide).toContain(`#### \`${entry.id}\``);
      for (const name of entry.secrets) expect(guide).toContain(`\`${name}\``);
      for (const step of entry.howto) expect(guide).toContain(step);
    }
  });

  it('orders tasks by the build order of their due story, so 8-9 comes before 8-4', () => {
    const at = (id: string) => guide.indexOf(`#### \`${id}\``);
    expect(at('google-oauth-client')).toBeLessThan(at('supabase-organization-plan'));
    expect(at('resend-account')).toBeLessThan(at('upstash-account'));
    expect(at('brave-terms-review')).toBeLessThan(at('stripe-account'));
    expect(at('vapid-keys')).toBeLessThan(at('backblaze-buckets'));
    expect(at('backblaze-buckets')).toBeLessThan(at('supabase-restore-project-permission'));
  });

  it('states that nothing is created and shows pending status for an unrecorded attestation', () => {
    expect(guide).toContain('Nothing in this repository creates an account');
    const text = renderGuide(pendingFixture, fixtureOrder, today);
    expect(text).toMatch(/- Status: staging: pending/);
    expect(text).toMatch(/- Status: staging: checked from the process environment/);
  });

  it('shows a valid evidence entry by date and reference name', () => {
    const recorded = JSON.parse(JSON.stringify(pendingFixture)) as Ledger;
    recorded.items[0].evidence = {staging: {date: '2026-10-09', ref: 'console-export-one'}};
    expect(renderGuide(recorded, fixtureOrder, '2026-10-10')).toContain('staging: recorded 2026-10-09, export console-export-one');
  });

  // Patch 9: one verdict for the checker and the guide, so an invalid entry is never shown as recorded.
  it.each([
    ['a malformed date', {date: 'yesterday', ref: 'console-export-one'}],
    ['an impossible date', {date: '2026-02-30', ref: 'console-export-one'}],
    ['a date more than a day ahead', {date: '2026-10-12', ref: 'console-export-one'}],
    ['no reference name', {date: '2026-10-09'}],
    ['a filler reference', {date: '2026-10-09', ref: 'tbd'}],
    ['a URL reference', {date: '2026-10-09', ref: 'https://example.com/export'}],
    ['an extra field', {date: '2026-10-09', ref: 'console-export-one', value: 'x'}],
  ])('does not render %s as recorded, and agrees with the checker', (_name, entry) => {
    const ledger = JSON.parse(JSON.stringify(pendingFixture)) as Ledger;
    ledger.items[0].evidence = {staging: entry};
    const text = renderGuide(ledger, fixtureOrder, '2026-10-10');
    expect(text).toContain('staging: invalid (');
    expect(text).not.toContain('staging: recorded');
    expect(checkItem(ledger.items[0], 'staging', {}, '2026-10-10').status).toBe('invalid');
    expect(text).not.toContain('https://example.com');
  });

  it('renders an entry as recorded exactly when the checker passes it', () => {
    const entries = [{date: '2026-10-09', ref: 'console-export-one'}, {date: '2026-10-11', ref: 'console-export-one'}, {date: '2026-10-12', ref: 'console-export-one'}, {date: '2026-10-09', ref: 'none'}];
    for (const entry of entries) {
      const ledger = JSON.parse(JSON.stringify(pendingFixture)) as Ledger;
      ledger.items[0].evidence = {staging: entry};
      const recorded = renderGuide(ledger, fixtureOrder, '2026-10-10').includes('staging: recorded');
      expect(recorded, JSON.stringify(entry)).toBe(checkItem(ledger.items[0], 'staging', {}, '2026-10-10').status === 'present');
    }
  });

  it('renders a ledger item with the evidence key omitted as pending', () => {
    const raw = JSON.parse(JSON.stringify(pendingFixture)) as Ledger;
    delete (raw.items[0] as Partial<LedgerItem>).evidence;
    expect(renderGuide(raw, fixtureOrder, today)).toMatch(/- Status: staging: pending/);
  });

  describe('render-provisioning.mjs', () => {
    const fixture = fixtureLedger([item({id: 'oauth-client', due: '1-3'})]);

    it('writes the guide, then --check passes; a stale or missing guide fails with exit 1', () => {
      const {ledgerPath, sprintPath, prefix} = files(fixture);
      const out = `${prefix}-guide.md`;
      const options = ['--ledger', ledgerPath, '--sprint-status', sprintPath, '--out', out];
      expect(run('render-provisioning.mjs', ['--check', ...options]).status).toBe(1); // no guide yet
      expect(run('render-provisioning.mjs', options).status).toBe(0);
      expect(readFileSync(out, 'utf8')).toContain('#### `oauth-client`');
      expect(run('render-provisioning.mjs', ['--check', ...options]).status).toBe(0);
      writeFileSync(ledgerPath, JSON.stringify(fixtureLedger([item({id: 'oauth-client', due: '1-4'})])));
      expect(run('render-provisioning.mjs', ['--check', ...options]).status).toBe(1); // ledger changed, guide not re-rendered
      expect(run('render-provisioning.mjs', options).status).toBe(0);
      writeFileSync(out, `${readFileSync(out, 'utf8')}hand edit\n`);
      expect(run('render-provisioning.mjs', ['--check', ...options]).status).toBe(1); // hand-edited guide
    });

    it('renders and re-checks a ledger whose items omit the evidence key', () => {
      const bare = fixtureLedger([item({id: 'oauth-client', due: '1-3'})]);
      delete (bare.items[0] as Partial<FixtureItem>).evidence;
      const {ledgerPath, sprintPath, prefix} = files(bare);
      const options = ['--ledger', ledgerPath, '--sprint-status', sprintPath, '--out', `${prefix}-guide.md`];
      const rendered = run('render-provisioning.mjs', options);
      expect(rendered.status).toBe(0);
      expect(run('render-provisioning.mjs', ['--check', ...options]).status).toBe(0);
      expect(rendered.output).not.toMatch(/TypeError|node:internal/);
      expect(readFileSync(`${prefix}-guide.md`, 'utf8')).toMatch(/- Status: staging: pending/);
    });

    it('fails with a one-line message, not a stack trace, when the guide cannot be written or read', () => {
      const {ledgerPath, sprintPath, prefix} = files(fixture);
      const directory = `${prefix}-a-directory`;
      mkdirSync(directory);
      const options = ['--ledger', ledgerPath, '--sprint-status', sprintPath];
      for (const [args, message] of [
        [[...options, '--out', directory], /Cannot write the provisioning guide \(EISDIR\)/],
        [[...options, '--out', join(directory, 'missing-parent', 'guide.md')], /Cannot write the provisioning guide \(ENOENT\)/],
        [['--check', ...options, '--out', directory], /Cannot read the provisioning guide \(EISDIR\)/],
      ] as Array<[string[], RegExp]>) {
        const result = run('render-provisioning.mjs', args);
        expect(result.status, String(message)).toBe(2);
        expect(result.output.trim().split('\n'), String(message)).toHaveLength(1);
        expect(result.output).toMatch(message);
        expect(result.output).not.toMatch(/\n\s+at |node:internal|Error:/);
      }
    });

    it('does not echo an unknown option, which may be a pasted secret', () => {
      const secret = `${'sk'}_${'live'}_${'a1'.repeat(12)}`;
      for (const argument of [secret, `--${secret}`, `--token=${secret}`, `--Token=${secret}`]) {
        const result = run('render-provisioning.mjs', [argument]);
        expect(result.status, argument).toBe(2);
        expect(result.output, argument).not.toContain(secret);
        expect(result.output, argument).toContain('Unknown option');
      }
      expect(run('render-provisioning.mjs', [secret]).output).toContain('(unprintable)');
      expect(run('render-provisioning.mjs', ['--nope']).output).toContain('--nope');
    });

    it('exits 2 for an unreadable build order, an invalid ledger or an unknown option', () => {
      const {ledgerPath, sprintPath, prefix} = files(fixture);
      const out = `${prefix}-guide.md`;
      expect(run('render-provisioning.mjs', ['--check', '--ledger', ledgerPath, '--sprint-status', `${sprintPath}.missing`, '--out', out]).status).toBe(2);
      writeFileSync(ledgerPath, '{}');
      expect(run('render-provisioning.mjs', ['--check', '--ledger', ledgerPath, '--sprint-status', sprintPath, '--out', out]).status).toBe(2);
      expect(run('render-provisioning.mjs', ['--nope']).status).toBe(2);
    });
  });
});

// ------------------------------------------------------------------ the internal-secrets register (AC-4)
describe('internal secrets register (docs/secrets.md)', () => {
  const text = read('docs/secrets.md');
  const [, ...rawSections] = text.split(/^### /m);
  const entries = rawSections.map((section) => {
    const body = section.replace(/\n## [\s\S]*$/, '');
    const name = body.split('\n', 1)[0].trim();
    const field = (label: string) => new RegExp(`^- \\*\\*${label}:\\*\\* (.+)$`, 'm').exec(body)?.[1]?.trim() ?? '';
    return {name, owner: field('Owner'), generation: field('Generation'), location: field('Location'), rotation: field('Rotation'), cadence: field('Cadence')};
  });
  const notSecret = new Set([...(text.split('## Names that are not secrets')[1] ?? '').matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((match) => match[1]));

  it('gives every internal secret an owner, generation method, per-environment location, rotation procedure and cadence', () => {
    expect(entries.length).toBeGreaterThanOrEqual(20);
    for (const entry of entries) {
      expect(entry.name, 'heading').toMatch(/^[A-Z][A-Z0-9_]+$/);
      for (const key of ['owner', 'generation', 'location', 'rotation', 'cadence'] as const) expect(entry[key], `${entry.name} ${key}`).not.toBe('');
      for (const environment of ['local', 'staging', 'production']) expect(entry.location, `${entry.name} location`).toContain(environment);
      expect(entry.cadence.toLowerCase(), `${entry.name} cadence`).toMatch(/yearly.*suspected compromise/);
      expect(entry.owner, `${entry.name} owner`).toContain('Administrator');
    }
    expect(new Set(entries.map((entry) => entry.name)).size).toBe(entries.length);
  });

  it('registers every secret the story names', () => {
    const names = entries.map((entry) => entry.name);
    for (const name of [
      'RATE_LIMIT_HASH_KEY',
      'INVITATION_HASH_KEY',
      'RECOVERY_HASH_KEY',
      'SERVICE_SIGNING_KEY_APPLICATION',
      'SERVICE_SIGNING_KEY_GATEWAY',
      'SERVICE_SIGNING_KEY_CAD_WORKER',
      'SERVICE_SIGNING_KEY_ENGINE_WORKER',
      'SERVICE_SIGNING_KEY_BACKUP_SERVICE',
      'SERVICE_SIGNING_KEY_HEARTBEAT',
      'BACKUP_AGE_PUBLIC_KEY',
      'BACKUP_AGE_PRIVATE_KEY',
      'GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY',
      'BACKUP_STORAGE_S3_SECRET_ACCESS_KEY',
      'RESEND_API_KEY',
      'ANTHROPIC_API_KEY',
      'BRAVE_SEARCH_API_KEY',
      'STRIPE_RESTRICTED_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'QSTASH_TOKEN',
      'VAPID_PRIVATE_KEY',
    ]) {
      expect(names, name).toContain(name);
    }
    expect(text).toMatch(/signs transfer tickets/i);
  });

  it('keeps the age private key out of every environment, with one pair and one password-manager entry for each environment', () => {
    const entry = entries.find((candidate) => candidate.name === 'BACKUP_AGE_PRIVATE_KEY')!;
    expect(entry.location).toMatch(/password manager/);
    expect(entry.location).not.toMatch(/Vercel variables|Railway service|GitHub environment/);
    expect(entry.location).toMatch(/staging's own entry/);
    expect(entry.location).toMatch(/production's own separate entry/);
    expect(entry.generation).toMatch(/once for each environment and never reused/);
    const publicKey = entries.find((candidate) => candidate.name === 'BACKUP_AGE_PUBLIC_KEY')!;
    expect(publicKey.generation).toMatch(/environment's own pair/);
    expect(text).toMatch(/Each environment has its own age pair/);
  });

  it('agrees with the ledger about where the Backblaze read-only keys are held', () => {
    const where = (name: string) => entries.find((candidate) => candidate.name === name)!.location;
    // The application reads the newest manifest; the application and the backup service both read the ledger.
    expect(where('B2_MANIFEST_READ_APPLICATION_KEY')).toMatch(/Vercel/);
    expect(where('B2_MANIFEST_READ_APPLICATION_KEY')).not.toMatch(/Railway/);
    expect(where('B2_LEDGER_READ_APPLICATION_KEY')).toMatch(/Vercel/);
    expect(where('B2_LEDGER_READ_APPLICATION_KEY')).toMatch(/Railway backup service/);
    for (const id of ['backblaze-read-only-keys', 'backblaze-read-only-keys-production']) {
      const steps = committed.items.find((entry) => entry.id === id)!.howto.join(' ');
      expect(steps, id).toMatch(/manifest key ID and application key in the (?:staging|production) Vercel project's/);
      expect(steps, id).toMatch(/ledger key ID and application key there and also in the (?:Railway|production Railway) backup service's variables/);
    }
  });

  it('does not state as settled that the ledger bucket or its key is append-only', () => {
    const entry = entries.find((candidate) => candidate.name === 'B2_LEDGER_APPEND_APPLICATION_KEY')!;
    const claims = `${text}\n${committed.items.flatMap((candidate) => candidate.howto).join('\n')}`;
    expect(`${entry.generation} ${text}`).toMatch(/intended to create files but not delete or hide them/);
    expect(entry.generation).toMatch(/intended/);
    expect(entry.generation).toMatch(/Story 8\.9 and gate G-9/);
    expect(claims).not.toMatch(/cannot delete or hide|no delete capability|it is append-only|bucket is append-only/i);
    expect(committed.items.find((candidate) => candidate.id === 'backblaze-buckets')!.howto.join(' ')).toMatch(/intended to be append-only, which Story 8\.9 and gate G-9 confirm/);
  });

  it('keeps production secrets in hosted stores only', () => {
    expect(text).toMatch(/Production values live only in those hosted stores, never in a local file or the repository/);
    for (const entry of entries) expect(entry.location, entry.name).not.toMatch(/production:[^;]*\.env\./);
  });

  it('covers every name the provisioning ledger lists, as a secret or as a stated non-secret', () => {
    const registered = new Set(entries.map((entry) => entry.name));
    for (const name of new Set(committed.items.flatMap((entry) => entry.secrets))) {
      expect(registered.has(name) || notSecret.has(name), name).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ no secret value in tracked files (AC-4)
const secretPatterns: Array<[string, RegExp]> = [
  ['private key block', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/],
  ['age secret key', /AGE-SECRET-KEY-1[A-Z0-9]{20,}/],
  ['Stripe key', /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{16,}/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['Resend key', /\bre_[A-Za-z0-9]{20,}/],
  ['Brave Search key', /\bBSA[A-Za-z0-9_-]{20,}/],
  ['sk- style API key', /\bsk-[A-Za-z0-9_-]{20,}/],
  // QStash tokens are base64 of {"UserID"...} and its signing keys start with sig_. Upstash Redis REST tokens
  // have no distinctive prefix, so they are caught only by the NAME=value check below.
  ['QStash token', /\beyJVc2VySUQi[A-Za-z0-9+/=_-]{20,}/],
  ['QStash signing key', /\bsig_[A-Za-z0-9]{20,}/],
  ['Supabase token or secret key', /\b(?:sbp_[0-9a-f]{40}|sb_secret_[A-Za-z0-9_-]{20,})/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google client secret or API key', /\b(?:GOCSPX-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})/],
  ['Backblaze application key', /\bK00[0-9A-Za-z]{28,}\b/],
];

/** NAME=value lines for secret-named variables whose value is neither a placeholder nor a reference. */
function realAssignments(text: string) {
  const found: string[] = [];
  for (const match of text.matchAll(/^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=(\S*)/gm)) {
    const value = match[2].replace(/^["']|["']$/g, '');
    if (!value || isPlaceholder(value) || /^[$`]|^[{(]/.test(value)) continue;
    found.push(match[1]);
  }
  return found;
}

function trackedAndNewFiles() {
  const listing = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (listing.status !== 0) throw new Error('git ls-files failed, so tracked files cannot be scanned');
  return listing.stdout.split('\0').filter((path) => path && path !== 'package-lock.json');
}

/** A file that holds credentials by its name: any .env file that is not an example, and key or certificate stores. */
function isCredentialFile(path: string) {
  const name = path.split('/').pop() ?? '';
  if (/^\.env(?:\..+)?$/.test(name)) return !name.endsWith('.example');
  return /^(?:id_rsa|id_ecdsa|id_ed25519|key\.txt)$/.test(name) || /\.(?:pem|key|p12|pfx|jks)$/i.test(name);
}

// The scan never skips a file. A binary file (it contains a NUL byte) is scanned as Latin-1 text, but only
// the paths below may be binary; a larger file than the limit fails unless it is listed. Both lists are short
// on purpose: adding a path is a decision to look at.
const sizeLimit = 4_000_000;
const oversizeAllowlist: RegExp[] = [];
const binaryAllowlist: RegExp[] = [/^_bmad-output\/implementation-artifacts\/qualification-2026-09-14\//];

describe('secret scan of tracked files (AC-4)', () => {
  it('detects each secret shape, built at run time so this file holds none', () => {
    const samples: Record<string, string> = {
      'private key block': `-----BEGIN ${'OPENSSH'} PRIVATE KEY-----`,
      'age secret key': `AGE-SECRET-KEY-1${'Q'.repeat(30)}`,
      'Stripe key': `${'sk'}_${'live'}_${'a1'.repeat(12)}`,
      'Stripe webhook secret': `${'whsec'}_${'a1'.repeat(12)}`,
      'GitHub token': `${'ghp'}_${'a1'.repeat(20)}`,
      'Anthropic key': `${'sk-ant'}-${'a1'.repeat(15)}`,
      'Resend key': `${'re'}_${'a1'.repeat(15)}`,
      'Brave Search key': `${'BSA'}${'a1'.repeat(15)}`,
      'sk- style API key': `${'sk'}-${'a1'.repeat(15)}`,
      'QStash token': `${'eyJVc2VySUQi'}${'a1'.repeat(15)}`,
      'QStash signing key': `${'sig'}_${'a1'.repeat(15)}`,
      'Supabase token or secret key': `${'sbp'}_${'0a'.repeat(20)}`,
      'JSON Web Token': `${'eyJ'}${'a'.repeat(12)}.${'eyJ'}${'b'.repeat(12)}.${'c'.repeat(12)}`,
      'AWS access key': `${'AKIA'}${'ABCDEFGH12345678'}`,
      'Slack token': `${'xoxb'}-${'1234567890'}-abc`,
      'Google client secret or API key': `${'GOCSPX'}-${'a1'.repeat(15)}`,
      'Backblaze application key': `${'K00'}${'a1'.repeat(15)}`,
    };
    expect(Object.keys(samples).sort()).toEqual(secretPatterns.map(([name]) => name).sort());
    for (const [name, pattern] of secretPatterns) expect(pattern.test(samples[name]), name).toBe(true);
    const assignment = (value: string) => realAssignments(`SOME_API_KEY=${value}`);
    expect(assignment('x'.repeat(20))).toEqual(['SOME_API_KEY']);
    for (const value of ['replace-with-the-key', '<some-api-key>', '$SOME_OTHER', '', 'changeme']) expect(assignment(value), value).toEqual([]);
  });

  it('finds no key, token, password or private key in any tracked file, and skips nothing outside the allowlists', () => {
    const files = trackedAndNewFiles();
    expect(files.length).toBeGreaterThan(100);
    const findings: string[] = [];
    let scanned = 0;
    for (const path of files) {
      let buffer: Buffer;
      try {
        buffer = readFileSync(resolve(root, path));
      } catch {
        continue; // tracked but deleted in the working tree
      }
      if (buffer.length > sizeLimit && !oversizeAllowlist.some((allowed) => allowed.test(path))) {
        findings.push(`${path}: larger than the scan limit and not on the allowlist`);
        continue;
      }
      const binary = buffer.includes(0);
      if (binary && !binaryAllowlist.some((allowed) => allowed.test(path))) findings.push(`${path}: binary file not on the allowlist`);
      const content = buffer.toString(binary ? 'latin1' : 'utf8');
      scanned += 1;
      for (const [name, pattern] of secretPatterns) if (pattern.test(content)) findings.push(`${path}: ${name}`);
      for (const variable of realAssignments(content)) findings.push(`${path}: ${variable} is assigned a value`);
    }
    // File names and kinds only, never the matching text.
    expect(findings).toEqual([]);
    expect(scanned).toBeGreaterThan(100);
  });

  it('recognizes credential files by name', () => {
    for (const path of ['.env', '.env.local', '.env.staging', '.env.production', 'apps/web/.env.test', 'keys/server.pem', 'a/b/tls.key', 'store.p12', 'store.PFX', 'release.jks', 'id_rsa', 'id_ecdsa', 'id_ed25519', 'key.txt']) {
      expect(isCredentialFile(path), path).toBe(true);
    }
    for (const path of ['.env.example', '.env.staging.example', '.env.production.example', 'docs/environment.md', 'lib/environment.ts', 'scripts/setup-env.mjs', 'keyboard.ts']) {
      expect(isCredentialFile(path), path).toBe(false);
    }
  });

  it('would not add an env file, key store or age identity file to the repository', () => {
    expect(trackedAndNewFiles().filter(isCredentialFile)).toEqual([]);
  });
});

// ------------------------------------------------------------------ wiring
describe('wiring', () => {
  it('adds the provisioning scripts and a CI step that checks the guide is current', () => {
    expect(pkg.scripts['check:provisioning']).toBe('node scripts/check-provisioning.mjs');
    expect(pkg.scripts['render:provisioning']).toBe('node scripts/render-provisioning.mjs');
    const workflow = parse(read('.github/workflows/ci.yml')) as {jobs: Record<string, {steps?: Array<{run?: string}>}>};
    const commands = (workflow.jobs.baseline.steps ?? []).map((step) => step.run ?? '');
    expect(commands.some((command) => command.includes('render:provisioning -- --check'))).toBe(true);
    // The checker fails by design until each account exists, so CI must not run it for a story.
    expect(commands.some((command) => command.includes('check-provisioning') || command.includes('check:provisioning'))).toBe(false);
  });

  it('link-checks the new docs and points to them from the README and the deployment guide', () => {
    expect(read('scripts/ci/check-repository.mjs')).toContain("'docs/provisioning.md'");
    expect(read('scripts/ci/check-repository.mjs')).toContain("'docs/secrets.md'");
    expect(read('scripts/ci/check-repository.mjs')).toContain("'docs/deployment-setup.md'");
    expect(read('README.md')).toContain('(docs/provisioning.md)');
    expect(read('README.md')).toContain('(docs/secrets.md)');
    expect(read('docs/deployment-setup.md')).toContain('(provisioning.md)');
    expect(read('docs/deployment-setup.md')).toContain('(secrets.md)');
  });

  it('shows the check command with the env file in the README, the deployment guide, the guide and the script help', () => {
    const command = 'node --env-file-if-exists=.env.staging scripts/check-provisioning.mjs --story <id> --env staging';
    expect(read('README.md')).toContain(command);
    expect(read('docs/deployment-setup.md')).toContain(command);
    expect(read('docs/provisioning.md')).toContain(command);
    expect(read('README.md')).toContain('npm run check:provisioning -- --story <id> --env staging');
    expect(read('scripts/check-provisioning.mjs')).toContain('.env.staging');
  });

  it('shares the placeholder detection of the environment checks', () => {
    for (const value of ['replace-with-x', '<name>', 'changeme', 'TODO']) expect(isPlaceholder(value), value).toBe(true);
    for (const value of ['todos@example.com', 'a-real-looking-value', '', undefined]) expect(isPlaceholder(value), String(value)).toBe(false);
  });
});
