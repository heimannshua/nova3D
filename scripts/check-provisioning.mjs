#!/usr/bin/env node
// Usage: node scripts/check-provisioning.mjs --story <id> [--env <name>]
//   --story <id>   a story ID such as 1-6; every item due by that story in build order is checked,
//                  that story included (the build order is sprint-status.yaml, not numeric order)
//   --env <name>   local, staging or production; defaults to APP_ENV. If APP_ENV is set it must equal --env.
//   --values-file <path>  the file whose values secret-present items read. Defaults to .env.local for local
//                  and .env.staging for staging, when the file exists. Variables already set win.
//                  Never used for production: a production secret does not sit in a local file.
// Fixture options for tests: --ledger <path>, --sprint-status <path>.
//
// secret-present items (local and staging only) read the process environment plus that file; attestation
// items need a dated evidence entry in provisioning/ledger.json. Exit 0: every due item is present.
// Exit 1: some item is missing or invalid. Exit 2: usage error or unreadable input.
// Only item IDs, stories and variable names are printed, never a value.
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {checkProvisioning, formatReport, parseBuildOrder, readLedger} from '../lib/provisioning.ts';

const root = resolve(import.meta.dirname, '..');
const usage = 'Usage: node scripts/check-provisioning.mjs --story <id> [--env <local|staging|production>]';
const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};
// An option is echoed only when it looks like one; anything else may be a pasted value.
const shown = (flag) => (/^--[a-z-]+$/.test(flag) ? flag : '(unprintable)');

const options = {};
const known = ['--story', '--env', '--values-file', '--ledger', '--sprint-status'];
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const [flag, inline] = args[index].split(/=(.*)/s, 2);
  if (!known.includes(flag)) fail(`Unknown option: ${shown(flag)}. ${usage}`);
  if (flag in options) fail(`${flag} was given twice. ${usage}`);
  const value = inline ?? args[++index];
  if (!value || value.startsWith('--')) fail(`${flag} needs a value. ${usage}`);
  options[flag] = value;
}

const story = options['--story'];
if (!story) fail(`--story is required. ${usage}`);
const env = options['--env'] ?? process.env.APP_ENV;
if (!env) fail(`--env is required when APP_ENV is not set. ${usage}`);

const read = (path, label) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fail(`Cannot read ${label}. Run from a checkout that has it, or pass its path.`);
  }
};

// Values for secret-present items: the shell wins over the file, like node --env-file-if-exists. The option is
// not called --env-file because Node itself reads any --env-file argument, even after the script name.
let fileValues = {};
if (env === 'production') {
  if (options['--values-file']) fail('--values-file is not used for production: a production secret never sits in a local file.');
} else {
  const defaults = {local: '.env.local', staging: '.env.staging'};
  const path = options['--values-file'] ?? (defaults[env] ? resolve(root, defaults[env]) : null);
  if (path && (options['--values-file'] || existsSync(path))) {
    try {
      fileValues = parseEnv(read(path, 'the environment file'));
    } catch {
      fail('Cannot parse the environment file.');
    }
  }
}

let order;
try {
  order = parseBuildOrder(read(options['--sprint-status'] ?? resolve(root, '_bmad-output/implementation-artifacts/sprint-status.yaml'), 'the build order (_bmad-output/implementation-artifacts/sprint-status.yaml)'));
} catch (error) {
  fail(`Cannot use the build order: ${error.message}.`);
}

const {ledger, errors} = readLedger(read(options['--ledger'] ?? resolve(root, 'provisioning/ledger.json'), 'the ledger (provisioning/ledger.json)'), order);
if (!ledger) {
  console.error('The provisioning ledger is invalid:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(2);
}

const input = {story, env, processEnv: {...fileValues, ...process.env}, today: new Date().toISOString().slice(0, 10)};
const outcome = checkProvisioning(ledger, order, input);
if (outcome.usageErrors.length) fail(`${outcome.usageErrors.join('\n')}\n${usage}`);

const lines = formatReport(outcome, input);
if (outcome.ok) console.log(lines.join('\n'));
else {
  console.error(lines.join('\n'));
  process.exitCode = 1;
}
