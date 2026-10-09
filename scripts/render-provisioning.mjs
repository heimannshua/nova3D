#!/usr/bin/env node
// Usage: node scripts/render-provisioning.mjs [--check]
//   (no flag)  renders provisioning/ledger.json to docs/provisioning.md
//   --check    changes nothing; exits 1 when docs/provisioning.md differs from the rendered ledger
// Fixture options for tests: --ledger <path>, --sprint-status <path>, --out <path>.
// Exit 2 on a usage error or an unreadable, unwritable or invalid input. The ledger holds no secret value.
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseBuildOrder, readLedger, renderGuide} from '../lib/provisioning.ts';

const root = resolve(import.meta.dirname, '..');
const usage = 'Usage: node scripts/render-provisioning.mjs [--check]';
const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};
// An option is echoed only when it looks like one; anything else may be a pasted value.
const shown = (flag) => (/^--[a-z-]+$/.test(flag) ? flag : '(unprintable)');
// Error codes such as EACCES or EISDIR are safe to print; messages carry paths.
const reason = (error) => (error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'error');

const check = process.argv.slice(2).includes('--check');
const options = {};
const known = ['--ledger', '--sprint-status', '--out'];
const args = process.argv.slice(2).filter((arg) => arg !== '--check');
for (let index = 0; index < args.length; index += 1) {
  const [flag, inline] = args[index].split(/=(.*)/s, 2);
  if (!known.includes(flag)) fail(`Unknown option: ${shown(flag)}. ${usage}`);
  if (flag in options) fail(`${flag} was given twice. ${usage}`);
  const value = inline ?? args[++index];
  if (!value || value.startsWith('--')) fail(`${flag} needs a value. ${usage}`);
  options[flag] = value;
}

const read = (path, label) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fail(`Cannot read ${label}.`);
  }
};

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

const guide = renderGuide(ledger, order, new Date().toISOString().slice(0, 10));
const out = options['--out'] ?? resolve(root, 'docs/provisioning.md');
if (check) {
  let current = null;
  try {
    current = readFileSync(out, 'utf8');
  } catch (error) {
    // A missing guide is drift; any other failure to read it is not.
    if (error?.code !== 'ENOENT') fail(`Cannot read the provisioning guide (${reason(error)}).`);
  }
  if (current !== guide) {
    console.error('docs/provisioning.md is out of date with provisioning/ledger.json. Run: npm run render:provisioning');
    process.exit(1);
  }
  console.log('docs/provisioning.md is current.');
} else {
  try {
    writeFileSync(out, guide);
  } catch (error) {
    fail(`Cannot write the provisioning guide (${reason(error)}).`);
  }
  console.log('Rendered docs/provisioning.md.');
}
