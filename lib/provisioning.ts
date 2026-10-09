// Provisioning ledger logic (Story 1.10): types, validation, build-order loader, due-by selection,
// item checks and the guide renderer. Pure functions only: no file, network or process access.
//
// scripts/check-provisioning.mjs and scripts/render-provisioning.mjs run this file directly through
// Node type stripping, so erasable TypeScript only and relative imports with a .ts extension.
// `yaml` is a dev dependency; nothing in the application imports this file.
//
// The ledger holds names, dates and evidence references, never a secret value. Nothing here may
// return or log a value from the process environment: results carry item IDs, variable names and
// fixed reason text only.
import {isMap, isScalar, parseDocument} from 'yaml';
import {appEnvironments, isPlaceholder, type Env} from './environment.ts';

export const verificationKinds = ['secret-present', 'attestation'] as const;
export type VerificationKind = (typeof verificationKinds)[number];

export type FreeTierLimit = {relied: string; upgradeTrigger: string};

export type LedgerService = {
  id: string;
  name: string;
  owner: string;
  plan: string;
  region: string;
  spendBackstop: string;
  /** The earliest story (in build order) of any item for this service. Validated, not trusted. */
  firstNeeded: string;
  limits: FreeTierLimit[];
};

export type LedgerItem = {
  id: string;
  service: string;
  title: string;
  kind: VerificationKind;
  /** Story ID such as "1-3". The item is required for that story and every story built after it. */
  due: string;
  environments: string[];
  /** Variable names only. For `secret-present` these are read from the process environment. */
  secrets: string[];
  howto: string[];
  /** Per environment: {date: "YYYY-MM-DD", ref: "name of an export kept outside the repository"}. */
  evidence: Record<string, unknown>;
};

export type Ledger = {
  version: 1;
  notice?: string;
  environments: string[];
  services: LedgerService[];
  items: LedgerItem[];
};

export type ItemStatus = 'present' | 'missing' | 'invalid';
export type ItemResult = {id: string; due: string; kind: VerificationKind; status: ItemStatus; details: string[]};
export type CheckInput = {story: string; env: string; processEnv: Env; today: string};
export type CheckOutcome = {usageErrors: string[]; results: ItemResult[]; ok: boolean};
export type EvidenceVerdict = {valid: true} | {valid: false; missing: boolean; reason: string};

export const storyIdPattern = /^\d+-\d+$/;
const storyKeyPattern = /^(\d+-\d+)-/;
const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const secretNamePattern = /^[A-Z][A-Z0-9_]{2,63}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
// An export is referenced by a plain name: Unicode letters and digits, a few separators and the narrow
// no-break space that macOS puts in screenshot names; no path separator, no URL, no query.
const referencePattern = /^[\p{L}\p{N}][\p{L}\p{N} ._(),'&+\-\u202F]{2,119}$/u;
// Words that satisfy the pattern but name nothing, compared case-insensitively.
const fillerReference = /^(?:tbd|tba|tbc|none|nil|null|undefined|na|pending|todo|test|testing|example|export|exports|sample|placeholder|dummy|foo|bar|baz|screenshot|file|name|ref|reference|[x*._\- ]+)$/i;
// Values that are not a real secret, for secret-present variables. lib/environment.ts isPlaceholder
// covers replace-with-..., <name>, changeme and todo; this adds the other things people leave behind.
const placeholderSecret = /^(?:undefined|null|nil|none|n\/a|na|tbd|tba|todo|empty|dummy|sample|example|test|secret|password|your[-_ ].*|insert[-_ ].*|put[-_ ].*|enter[-_ ].*|[x*._-]{3,}|\$\{[^}]*\}|\$[A-Z_][A-Z0-9_]*|\[[^\]]*\])$/i;
const lineBreak = /[\r\n\u0085\u2028\u2029]/;

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

/** Required, non-blank text on one line, so generated Markdown cannot be broken. */
function requireLine(value: unknown, label: string, where: string, errors: string[]) {
  if (!isText(value)) errors.push(`${where}: ${label} is required`);
  else if (lineBreak.test(value)) errors.push(`${where}: ${label} must be a single line`);
}

/** A secret-present value that is empty or only stands in for one. Never returns or logs the value. */
export function isPlaceholderSecret(value: string | undefined) {
  const bare = (value ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  return !bare || isPlaceholder(bare) || placeholderSecret.test(bare);
}

// ---------------------------------------------------------------- build order

/**
 * The build order: story IDs in the key order of `development_status` in sprint-status.yaml.
 * Epic and retrospective keys are skipped. Throws a message-only Error when the file cannot be used.
 */
export function parseBuildOrder(yamlText: string): string[] {
  const document = parseDocument(yamlText);
  if (document.errors.length) throw new Error('sprint-status.yaml is not valid YAML');
  const status = document.get('development_status', true);
  if (!isMap(status)) throw new Error('sprint-status.yaml has no development_status map');

  const order: string[] = [];
  for (const pair of status.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const id = storyKeyPattern.exec(key)?.[1];
    if (!id) continue;
    if (order.includes(id)) throw new Error(`sprint-status.yaml lists story ${id} twice`);
    order.push(id);
  }
  if (!order.length) throw new Error('sprint-status.yaml lists no stories');
  return order;
}

/** "1-3" becomes "Story 1.3". */
export function storyLabel(id: string) {
  return `Story ${id.replace('-', '.')}`;
}

// ---------------------------------------------------------------- validation

function printable(value: string, fallback: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) ? value : fallback;
}

/** An environment label is echoed only when it is one of the three; any other value may be a pasted secret. */
function envLabel(value: string) {
  return (appEnvironments as readonly string[]).includes(value) ? value : '(unrecognized)';
}

function unknownFields(record: Json, allowed: string[], where: string, errors: string[]) {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    errors.push(`${where}: unknown field ${unknown.map((key) => printable(key, '(unprintable)')).join(', ')} (the ledger holds names, dates and evidence references only)`);
  }
}

/** Structural checks only. Evidence content is judged per environment at check time, never here. */
export function validateLedger(value: unknown, order: string[]): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['ledger must be a JSON object'];
  unknownFields(value, ['version', 'notice', 'environments', 'services', 'items'], 'ledger', errors);
  if (value.version !== 1) errors.push('ledger.version must be 1');
  if (value.notice !== undefined) requireLine(value.notice, 'notice', 'ledger', errors);

  const environments = value.environments;
  const knownEnvironments: string[] = [];
  if (!isTextList(environments) || !environments.length) {
    errors.push('ledger.environments must list at least one environment');
  } else {
    for (const name of environments) {
      if (!(appEnvironments as readonly string[]).includes(name)) errors.push(`ledger.environments: "${printable(name, '(unprintable)')}" is not local, staging or production`);
      else if (knownEnvironments.includes(name)) errors.push(`ledger.environments: ${name} is listed twice`);
      else knownEnvironments.push(name);
    }
  }

  const serviceIds: string[] = [];
  const services: Json[] = [];
  if (!Array.isArray(value.services) || !value.services.length) {
    errors.push('ledger.services must list at least one service');
  } else {
    value.services.forEach((raw, index) => {
      if (!isRecord(raw)) return void errors.push(`services[${index}] must be an object`);
      const id = typeof raw.id === 'string' ? raw.id : '';
      const where = idPattern.test(id) ? `service ${id}` : `services[${index}]`;
      unknownFields(raw, ['id', 'name', 'owner', 'plan', 'region', 'spendBackstop', 'firstNeeded', 'limits'], where, errors);
      if (!idPattern.test(id)) errors.push(`${where}: id must be lowercase words joined by hyphens`);
      else if (serviceIds.includes(id)) errors.push(`${where}: duplicate service id`);
      else serviceIds.push(id);
      for (const field of ['name', 'owner', 'plan', 'region', 'spendBackstop']) requireLine(raw[field], field, where, errors);
      if (typeof raw.firstNeeded !== 'string' || !order.includes(raw.firstNeeded)) errors.push(`${where}: firstNeeded must be a story in the build order`);
      if (!Array.isArray(raw.limits)) {
        errors.push(`${where}: limits must be a list (empty when no free-tier limit is relied on)`);
      } else {
        raw.limits.forEach((limit, position) => {
          if (!isRecord(limit)) {
            errors.push(`${where}: limits[${position}] needs "relied" and "upgradeTrigger" text`);
          } else {
            requireLine(limit.relied, `limits[${position}].relied`, where, errors);
            requireLine(limit.upgradeTrigger, `limits[${position}].upgradeTrigger`, where, errors);
            unknownFields(limit, ['relied', 'upgradeTrigger'], `${where} limits[${position}]`, errors);
          }
        });
      }
      services.push(raw);
    });
  }

  const itemIds: string[] = [];
  const earliest = new Map<string, number>();
  if (!Array.isArray(value.items) || !value.items.length) {
    errors.push('ledger.items must list at least one item');
  } else {
    value.items.forEach((raw, index) => {
      if (!isRecord(raw)) return void errors.push(`items[${index}] must be an object`);
      const id = typeof raw.id === 'string' ? raw.id : '';
      const where = idPattern.test(id) ? `item ${id}` : `items[${index}]`;
      unknownFields(raw, ['id', 'service', 'title', 'kind', 'due', 'environments', 'secrets', 'howto', 'evidence'], where, errors);
      if (!idPattern.test(id)) errors.push(`${where}: id must be lowercase words joined by hyphens`);
      else if (itemIds.includes(id)) errors.push(`${where}: duplicate item id`);
      else itemIds.push(id);

      if (typeof raw.service !== 'string' || !serviceIds.includes(raw.service)) errors.push(`${where}: service must be one of the ledger's services`);
      requireLine(raw.title, 'title', where, errors);
      if (!(verificationKinds as readonly string[]).includes(raw.kind as string)) errors.push(`${where}: kind must be secret-present or attestation`);

      const dueAt = typeof raw.due === 'string' ? order.indexOf(raw.due) : -1;
      if (dueAt === -1) errors.push(`${where}: due must be a story in the build order`);
      else if (typeof raw.service === 'string') earliest.set(raw.service, Math.min(earliest.get(raw.service) ?? Infinity, dueAt));

      const itemEnvironments = isTextList(raw.environments) ? raw.environments : [];
      if (!itemEnvironments.length) errors.push(`${where}: environments must list at least one environment`);
      for (const name of itemEnvironments) {
        if (!knownEnvironments.includes(name)) errors.push(`${where}: environment ${printable(name, '(unprintable)')} is not in ledger.environments`);
      }
      if (new Set(itemEnvironments).size !== itemEnvironments.length) errors.push(`${where}: an environment is listed twice`);
      // A production secret lives in Vercel, Railway or GitHub and never in a local file the check could read.
      if (raw.kind === 'secret-present' && itemEnvironments.includes('production')) {
        errors.push(`${where}: a secret-present item cannot cover production (production values never sit in a local file; use an attestation)`);
      }

      const secrets = isTextList(raw.secrets) ? raw.secrets : null;
      if (!secrets) errors.push(`${where}: secrets must be a list of variable names`);
      else {
        for (const name of secrets) {
          if (!secretNamePattern.test(name)) errors.push(`${where}: secrets must be variable names in capitals and underscores, never values`);
        }
        if (new Set(secrets).size !== secrets.length) errors.push(`${where}: a secret name is listed twice`);
        if (raw.kind === 'secret-present' && !secrets.length) errors.push(`${where}: a secret-present item must name at least one variable`);
      }

      if (!Array.isArray(raw.howto) || !raw.howto.length) errors.push(`${where}: howto must list at least one step`);
      else raw.howto.forEach((step, position) => requireLine(step, `howto step ${position + 1}`, where, errors));

      if (raw.evidence !== undefined && !isRecord(raw.evidence)) {
        errors.push(`${where}: evidence must be an object keyed by environment`);
      } else if (isRecord(raw.evidence)) {
        const keys = Object.keys(raw.evidence);
        if (keys.some((key) => !itemEnvironments.includes(key))) errors.push(`${where}: evidence is recorded for an environment the item does not list`);
        if (raw.kind === 'secret-present' && keys.length) errors.push(`${where}: a secret-present item is checked from the environment and holds no evidence`);
      }
    });
  }

  for (const service of services) {
    const id = typeof service.id === 'string' ? service.id : '';
    if (!serviceIds.includes(id)) continue;
    const first = earliest.get(id);
    if (first === undefined) errors.push(`service ${id}: has no items`);
    else if (service.firstNeeded !== order[first]) errors.push(`service ${id}: firstNeeded must be ${order[first]}, the earliest due of its items`);
  }
  return errors;
}

/** Parses ledger JSON and validates it. `ledger` is set only when there are no errors. */
export function readLedger(jsonText: string, order: string[]): {ledger?: Ledger; errors: string[]} {
  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch {
    return {errors: ['ledger is not valid JSON']};
  }
  const errors = validateLedger(value, order);
  if (errors.length) return {errors};
  const parsed = value as Ledger;
  const items = parsed.items.map((item) => ({...item, evidence: item.evidence ?? {}}));
  return {ledger: {...parsed, items}, errors: []};
}

// ---------------------------------------------------------------- selection and checks

/**
 * Items for one environment that are due by `story` in build order, the story itself included, in
 * build order (ledger order within a story). Numeric story order plays no part: with the order
 * 1-1, 1-10, 1-2, 1-3, 1-4, checking 1-3 includes an item due 1-10 and ignores one due 1-4.
 */
export function itemsDueBy(ledger: Ledger, order: string[], story: string, env: string): LedgerItem[] {
  const limit = order.indexOf(story);
  if (limit === -1) return [];
  return ledger.items
    .map((item, index) => ({item, index, at: order.indexOf(item.due)}))
    .filter(({item, at}) => at !== -1 && at <= limit && item.environments.includes(env))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({item}) => item);
}

/** Every item in build order of its due story, ledger order within a story. */
export function itemsInBuildOrder(ledger: Ledger, order: string[]): LedgerItem[] {
  return ledger.items
    .map((item, index) => ({item, index, at: order.indexOf(item.due)}))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({item}) => item);
}

export function isCalendarDate(value: string) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nextDay(date: string) {
  return isCalendarDate(date) ? new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : date;
}

/**
 * `today` is the UTC date, YYYY-MM-DD. A date more than one day ahead of it is invalid; the one day of
 * slack keeps a correct local date from being rejected in a time zone ahead of UTC. Reasons are fixed
 * text and never echo the entry.
 */
export function evaluateEvidence(raw: unknown, today: string): EvidenceVerdict {
  const invalid = (reason: string): EvidenceVerdict => ({valid: false, missing: false, reason});
  if (raw === undefined || raw === null) return {valid: false, missing: true, reason: 'no dated evidence'};
  if (!isRecord(raw)) return invalid('evidence entry is malformed');
  if (Object.keys(raw).some((key) => key !== 'date' && key !== 'ref')) return invalid('evidence entry has fields other than date and ref');
  if (typeof raw.date !== 'string' || !isCalendarDate(raw.date)) return invalid('evidence date is malformed (use YYYY-MM-DD)');
  if (raw.date > nextDay(today)) return invalid('evidence date is in the future');
  if (typeof raw.ref !== 'string' || !raw.ref.trim()) return invalid('evidence reference name is missing');
  if (!referencePattern.test(raw.ref) || isPlaceholder(raw.ref)) return invalid('evidence reference name is malformed (a plain export name, no path or URL)');
  if (fillerReference.test(raw.ref.trim())) return invalid('evidence reference name is a filler word, not the name of an export');
  return {valid: true};
}

export function checkItem(item: LedgerItem, env: string, processEnv: Env, today: string): ItemResult {
  const base = {id: item.id, due: item.due, kind: item.kind};
  if (item.kind === 'secret-present') {
    const details: string[] = [];
    for (const name of item.secrets) {
      const value = (processEnv[name] ?? '').trim();
      if (!value) details.push(`${name} is unset`);
      else if (isPlaceholderSecret(value)) details.push(`${name} is a placeholder`);
    }
    return {...base, status: details.length ? 'missing' : 'present', details};
  }
  const verdict = evaluateEvidence((item.evidence ?? {})[env], today);
  if (verdict.valid) return {...base, status: 'present', details: []};
  return {...base, status: verdict.missing ? 'missing' : 'invalid', details: [verdict.missing ? `no dated evidence for ${env}` : verdict.reason]};
}

/** Never treats a pending item as passed: `ok` needs every due item present. */
export function checkProvisioning(ledger: Ledger, order: string[], input: CheckInput): CheckOutcome {
  const usageErrors: string[] = [];
  if (!order.includes(input.story)) usageErrors.push(`unknown story: ${storyIdPattern.test(input.story) ? input.story : 'that value'} is not in the build order of sprint-status.yaml`);
  if (!ledger.environments.includes(input.env)) usageErrors.push(`unknown environment: use one of ${ledger.environments.join(', ')}`);
  // The values must belong to the environment being checked: a staging check run with local values would pass for the wrong reason.
  const appEnv = (input.processEnv.APP_ENV ?? '').trim();
  if (appEnv && appEnv !== input.env) {
    usageErrors.push(`APP_ENV is ${envLabel(appEnv)} but --env is ${envLabel(input.env)}: load that environment's own file, or fix the label`);
  }
  if (usageErrors.length) return {usageErrors, results: [], ok: false};
  const results = itemsDueBy(ledger, order, input.story, input.env).map((item) => checkItem(item, input.env, input.processEnv, input.today));
  return {usageErrors, results, ok: results.every((result) => result.status === 'present')};
}

/** Report lines: item IDs, stories and variable names only. */
export function formatReport(outcome: CheckOutcome, input: Pick<CheckInput, 'story' | 'env'>): string[] {
  const due = outcome.results.length;
  const lines = [`Provisioning check for ${input.env}, through ${storyLabel(input.story)} (${due} ${due === 1 ? 'item' : 'items'} due)`];
  for (const result of outcome.results) {
    const label = result.status === 'present' ? 'present' : result.status === 'missing' ? 'MISSING' : 'INVALID';
    const detail = result.details.length ? `  ${result.details.join('; ')}` : '';
    lines.push(`  ${label.padEnd(7)}  ${result.id}  (${result.kind}, due ${result.due})${detail}`);
  }
  const count = (status: ItemStatus) => outcome.results.filter((result) => result.status === status).length;
  if (outcome.ok) {
    const total = outcome.results.length;
    lines.push(total ? `Passed: ${total === 1 ? '1 item' : `all ${total} items`} due by ${input.story} ${total === 1 ? 'is' : 'are'} present.` : `Passed: nothing is due by ${input.story} for ${input.env}.`);
  } else {
    lines.push(`Failed: ${count('missing')} missing, ${count('invalid')} invalid, ${count('present')} present.`);
    lines.push('Create the account or key, then for an attestation save an export outside the repository and record its dated evidence in provisioning/ledger.json (docs/provisioning.md).');
  }
  return lines;
}

// ---------------------------------------------------------------- guide

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Secret names for one service, per environment, in ledger order without duplicates. */
export function secretNamesByEnvironment(ledger: Ledger, serviceId: string): Record<string, string[]> {
  const names: Record<string, string[]> = {};
  for (const environment of ledger.environments) {
    const found = ledger.items
      .filter((item) => item.service === serviceId && item.environments.includes(environment))
      .flatMap((item) => item.secrets);
    if (found.length) names[environment] = [...new Set(found)];
  }
  return names;
}

/** "local, staging: `A`, `B`; production: `C`", merging environments that share the same names. */
function describeSecretNames(names: Record<string, string[]>) {
  const groups = new Map<string, string[]>();
  for (const [environment, list] of Object.entries(names)) {
    const key = list.map((name) => `\`${name}\``).join(', ');
    groups.set(key, [...(groups.get(key) ?? []), environment]);
  }
  return groups.size ? [...groups].map(([list, environments]) => `${environments.join(', ')}: ${list}`).join('; ') : 'none';
}

/** Status per environment, from the same verdict the checker uses: an invalid entry is never shown as recorded. */
function evidenceSummary(item: LedgerItem, today: string) {
  return item.environments.map((environment) => {
    if (item.kind === 'secret-present') return `${environment}: checked from the process environment`;
    const entry = (item.evidence ?? {})[environment];
    const verdict = evaluateEvidence(entry, today);
    if (verdict.valid) {
      const {date, ref} = entry as {date: string; ref: string};
      return `${environment}: recorded ${date}, export ${ref}`;
    }
    return verdict.missing ? `${environment}: pending` : `${environment}: invalid (${verdict.reason})`;
  });
}

/**
 * Deterministic Markdown for docs/provisioning.md. Depends on the ledger, the build order and `today`
 * (the UTC date, which only decides whether a recorded date is still too far ahead).
 */
export function renderGuide(ledger: Ledger, order: string[], today: string): string {
  const at = (story: string) => order.indexOf(story);
  const services = ledger.services
    .map((service, index) => ({service, index}))
    .sort((a, b) => at(a.service.firstNeeded) - at(b.service.firstNeeded) || a.index - b.index)
    .map(({service}) => service);
  const sortedItems = itemsInBuildOrder(ledger, order);
  const out: string[] = [];
  const line = (text = '') => void out.push(text);

  line('# External accounts, credentials and spend limits');
  line();
  line('<!-- Generated from provisioning/ledger.json by scripts/render-provisioning.mjs. Do not edit by hand: change the ledger, then run `npm run render:provisioning`. -->');
  line();
  line('This guide lists every external account, credential and spend limit that only the Administrator (Josh) can create, the story that first needs each, and how to record that it exists. It is rendered from the machine-readable [ledger](../provisioning/ledger.json), which holds names, dates and evidence references and never a secret value. Keys the application generates itself are in the [internal secrets register](secrets.md). Nothing in this repository creates an account or calls a provider.');
  line();
  line('## Record and check');
  line();
  line('Tasks are ordered by the build order in `_bmad-output/implementation-artifacts/sprint-status.yaml`, not by story number, and each is due by the story named: that story needs it, and so does every story built after it. Every item starts pending, and a pending item never counts as passed.');
  line();
  line('- A `secret-present` item passes when each variable it names is set to a real value in the process environment: not empty, and not a placeholder such as `replace-with-...`, `<...>`, `changeme`, `todo`, `none`, `null`, `xxx` or `your-key-here`. Only `local` and `staging` values are checked this way. A production secret never sits in a local file, so every production item is an attestation that its value is stored in Vercel, Railway or GitHub.');
  line('- An `attestation` item passes only with a dated evidence entry for the environment. Save a console export or screenshot **outside this repository** (a password manager or private drive), then add to the item in the ledger `"evidence": {"staging": {"date": "YYYY-MM-DD", "ref": "<export file name>"}}`: the date you captured it (a date up to one day ahead of UTC is accepted, so a local date in a UTC+ time zone is fine), and the export\'s file name, never its content, a URL or a path. The name may use letters, digits, spaces and `. _ ( ) , \' & + -`; a filler such as `tbd`, `none`, `test` or `export` is refused. A malformed or future date, or a bad reference name, is invalid and counts as missing.');
  line('- Check one environment through one story: `npm run check:provisioning -- --story <id> --env <local|staging|production>` (`--env` defaults to `APP_ENV`). For `local` and `staging` it loads `.env.local` or `.env.staging` itself when the file exists, without overriding variables already set; the direct equivalent is `node --env-file-if-exists=.env.staging scripts/check-provisioning.mjs --story <id> --env staging`. If `APP_ENV` is set it must equal `--env`, so values from another environment cannot satisfy the check. Exit 0: every item due by that story is present. Exit 1: some item is missing or invalid, and each is named with its story and variable names. Exit 2: unknown story or environment, a mismatched `APP_ENV`, or an unreadable input. It never prints a value.');
  line('- After you edit the ledger, run `npm run render:provisioning`. CI runs `npm run render:provisioning -- --check` and fails when this guide is out of date.');
  line('- Account-wide tasks are recorded once, under `staging`, the first environment that needs them. Tasks that differ per environment (clients, keys, buckets) list each environment. Production projects are created in Story 8.7 after the Story 8.4 drill, so a production check is expected to fail until then; the production-only Stripe tasks are due by Story 8.7 for that reason. See also [deployment setup](deployment-setup.md) and [authentication setup](auth-setup.md).');
  line();

  line('## Services');
  line();
  line('| Service | First needed | Spend backstop |');
  line('| --- | --- | --- |');
  for (const service of services) {
    line(`| ${cell(service.name)} | ${storyLabel(service.firstNeeded)} | ${cell(service.spendBackstop)} |`);
  }
  line();
  for (const service of services) {
    const own = sortedItems.filter((item) => item.service === service.id);
    const kinds = verificationKinds.map((kind) => ({kind, count: own.filter((item) => item.kind === kind).length})).filter((entry) => entry.count);
    const names = secretNamesByEnvironment(ledger, service.id);
    line(`### ${service.name}`);
    line();
    line(`- Owner: ${service.owner}`);
    line(`- Plan: ${service.plan}`);
    line(`- Region: ${service.region}`);
    line(`- Spend backstop: ${service.spendBackstop}`);
    line(`- First needed: ${storyLabel(service.firstNeeded)}`);
    line(`- Verification: ${kinds.map((entry) => `${entry.kind} (${entry.count})`).join(', ')}`);
    line(`- Secret names by environment: ${describeSecretNames(names)}`);
    if (service.limits.length) {
      line('- Free-tier limits relied on, with the trigger for upgrading:');
      for (const limit of service.limits) line(`  - ${limit.relied} Upgrade trigger: ${limit.upgradeTrigger}`);
    } else {
      line('- Free-tier limits relied on: none.');
    }
    line();
  }

  line('## Tasks by story');
  line();
  let current = '';
  for (const item of sortedItems) {
    if (item.due !== current) {
      current = item.due;
      line(`### Due by ${storyLabel(item.due)}`);
      line();
    }
    const service = ledger.services.find((entry) => entry.id === item.service);
    line(`#### \`${item.id}\`: ${item.title}`);
    line();
    line(`- Service: ${service?.name ?? item.service}`);
    line(`- Verification: ${item.kind}`);
    line(`- Environments: ${item.environments.join(', ')}`);
    line(`- Secret names: ${item.secrets.length ? item.secrets.map((name) => `\`${name}\``).join(', ') : 'none'}`);
    line(`- Status: ${evidenceSummary(item, today).join('; ')}`);
    line();
    item.howto.forEach((step, index) => line(`${index + 1}. ${step}`));
    line();
  }
  while (out[out.length - 1] === '') out.pop();
  return `${out.join('\n')}\n`;
}
