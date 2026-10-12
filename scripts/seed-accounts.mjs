#!/usr/bin/env node
// Story 1.3: the audited seed command for pre-authorizations and invitation codes.
//
//   node scripts/seed-accounts.mjs preauthorize
//       Records a pre-authorization for ADMINISTRATOR_EMAIL (role administrator) and for every address
//       in SEED_ACCOUNT_EMAILS (role member). Run it twice and nothing changes. Each address is
//       activated by its first verified Google sign-in, which pins its Google subject. An address that
//       already owns an Account is refused, and a second Administrator address draws a warning.
//   node scripts/seed-accounts.mjs unauthorize --email <address>
//       Withdraws a pre-authorization that no sign-in has consumed yet.
//   node scripts/seed-accounts.mjs issue --name <label>
//       Issues a named single-use code for one invitee.
//   node scripts/seed-accounts.mjs issue --general [--replace]
//       Issues the current general code. --replace revokes the current one first.
//   node scripts/seed-accounts.mjs list
//       Lists the invitations (ID, kind, state, creation time, label). Never a code or a hash.
//   node scripts/seed-accounts.mjs revoke --id <invitation-id>
//   node scripts/seed-accounts.mjs revoke --code-stdin
//       Revokes an unused code, by the ID printed when it was issued (or shown by `list`) or by the code
//       itself read from standard input (never from the command line, where it would reach shell history).
//       Exits non-zero when nothing was revoked because the code was already redeemed or does not exist.
//
// A code is generated here, shown once on standard output and never stored: the database keeps only its
// HMAC under INVITATION_HASH_KEY. Every command is written to identity.audit_events with the actor
// `seed:<APP_ENV>:<operating-system user>`.
//
// Usage: npm run seed:accounts -- <command>   (loads .env.local), or
//        node --env-file=.env.staging scripts/seed-accounts.mjs <command> --confirm staging
//
// The command first checks that APP_ENV and INSTANCE_ID match the database it is about to write, and
// outside local it refuses to run without --confirm <APP_ENV>. It never prints a key, a hash or a UUID
// other than an invitation ID.
//
// Exit codes: 0 done, 1 refused or failed, 2 wrong usage.
import {userInfo} from 'node:os';
import {parseArgs} from 'node:util';
import {
  AccountsConfigError,
  AccountsUnavailableError,
  issueInvitation,
  listInvitations,
  revokeInvitation,
  seedPreauthorization,
  withdrawPreauthorization,
} from '../lib/accounts.ts';
import {isPreview, parseEmailList, verifyInstanceIdentity} from '../lib/environment.ts';

const usage = `Usage:
  seed-accounts.mjs preauthorize
  seed-accounts.mjs unauthorize --email <address>
  seed-accounts.mjs issue --name <label> | --general [--replace]
  seed-accounts.mjs list
  seed-accounts.mjs revoke --id <invitation-id> | --code-stdin
Outside APP_ENV=local add: --confirm <APP_ENV>`;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      name: {type: 'string'},
      general: {type: 'boolean'},
      replace: {type: 'boolean'},
      id: {type: 'string'},
      email: {type: 'string'},
      'code-stdin': {type: 'boolean'},
      confirm: {type: 'string'},
    },
  });
} catch (error) {
  fail(`${error.message}\n${usage}`, 2);
}
const {values, positionals} = parsed;
const [command, ...extra] = positionals;
const used = (...names) => names.some((name) => values[name] !== undefined && values[name] !== false);
if (!['preauthorize', 'unauthorize', 'issue', 'list', 'revoke'].includes(command) || extra.length) fail(usage, 2);

if (command === 'preauthorize' && used('name', 'general', 'replace', 'id', 'email', 'code-stdin')) fail(usage, 2);
if (command === 'unauthorize' && (used('name', 'general', 'replace', 'id', 'code-stdin') || !values.email)) fail(usage, 2);
if (command === 'list' && used('name', 'general', 'replace', 'id', 'email', 'code-stdin')) fail(usage, 2);
if (command === 'issue' && (used('id', 'email', 'code-stdin') || Boolean(values.name) === Boolean(values.general) || (values.replace && !values.general))) fail(usage, 2);
if (command === 'revoke' && (used('name', 'general', 'replace', 'email') || Boolean(values.id) === Boolean(values['code-stdin']))) fail(usage, 2);
// A code typed at a terminal prompt would be echoed; it has to be piped in.
if (command === 'revoke' && values['code-stdin'] && process.stdin.isTTY) fail('--code-stdin reads the code from a pipe, not from a terminal. Example: printf %s "$CODE" | seed-accounts.mjs revoke --code-stdin', 2);

const environment = process.env.APP_ENV;
if (isPreview(process.env)) fail('Refusing to run in a Vercel preview or development deployment.');

// Fails closed on a mixed-up environment: the label, the format of every variable and the database's own
// identity row must all agree before anything is written.
// Only the hashing keys this command uses are required: `issue` and `revoke --code-stdin` hash a code under
// INVITATION_HASH_KEY; `preauthorize`, `unauthorize`, `list` and `revoke --id` hash nothing. No command sends mail, so
// the mail variables of a hosted environment (RESEND_API_KEY, APP_ORIGIN; Story 1.6) are not asked for either.
const hashKeys = command === 'issue' || (command === 'revoke' && values['code-stdin']) ? ['INVITATION_HASH_KEY'] : [];
const problems = await verifyInstanceIdentity(process.env, undefined, {hashKeys, mail: false});
if (problems.length) {
  console.error(`Environment validation failed for ${environment || 'unset'}:`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
if (environment !== 'local' && values.confirm !== environment) {
  fail(`This writes to the ${environment} database. Run it again with --confirm ${environment} to proceed.`, 2);
}

// Who ran it, for the audit trail: the environment and the operating-system user, never a secret.
const operator = (() => {
  try {
    return userInfo().username.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown';
  } catch {
    return 'unknown';
  }
})();
const actor = `seed:${environment}:${operator}`;

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text.trim();
}

const hints = {
  22023: 'The database rejected the input as invalid.',
  N3001: 'That address already owns an Account, so a pre-authorization for it could never be used.',
  N3002: 'That address is already pre-authorized with another role.',
};
const unknownOutcome =
  'The outcome is unknown: the request may have reached the database before it failed. Run `list` and revoke by ID any invitation you do not recognise before issuing again.';

function describe(error) {
  if (error instanceof AccountsUnavailableError) {
    return `${error.message}${error.code && hints[error.code] ? ` ${hints[error.code]}` : ''}`;
  }
  return error.message;
}

try {
  if (command === 'preauthorize') {
    const administrator = process.env.ADMINISTRATOR_EMAIL.trim().toLowerCase();
    const members = parseEmailList(process.env.SEED_ACCOUNT_EMAILS).filter((email) => email !== administrator);
    let failures = 0;
    for (const [email, role] of [[administrator, 'administrator'], ...members.map((email) => [email, 'member'])]) {
      try {
        const receipt = await seedPreauthorization({email, role, actor});
        const state = receipt.created ? 'pre-authorized' : receipt.consumed ? 'already activated' : 'already pre-authorized';
        console.log(`${role.padEnd(13)} ${email}  ${state}`);
        if (role === 'administrator' && receipt.otherAdministrators > 0) {
          console.error(
            `Warning: ${receipt.otherAdministrators} other administrator pre-authorization(s) exist for different addresses. If ADMINISTRATOR_EMAIL changed, the old address can still become an Administrator; withdraw it with \`unauthorize --email\` if it has not signed in yet.`,
          );
        }
      } catch (error) {
        if (!(error instanceof AccountsUnavailableError) || error.outcomeUnknown) throw error;
        console.error(`${role.padEnd(13)} ${email}  refused: ${describe(error)}`);
        failures += 1;
      }
    }
    if (failures) process.exitCode = 1;
  } else if (command === 'unauthorize') {
    const receipt = await withdrawPreauthorization({email: values.email, actor});
    const messages = {
      withdrawn: 'Withdrawn.',
      consumed: 'Not withdrawn: this address already signed in and has an Account.',
      not_found: 'No such pre-authorization.',
    };
    console.log(messages[receipt.outcome]);
    if (receipt.outcome !== 'withdrawn') process.exitCode = 1;
  } else if (command === 'issue') {
    let issued;
    try {
      issued = values.general
        ? await issueInvitation({kind: 'general', actor, replace: Boolean(values.replace)})
        : await issueInvitation({kind: 'named', label: values.name, actor});
    } catch (error) {
      if (error instanceof AccountsUnavailableError && error.outcomeUnknown) fail(`Failed: ${describe(error)} ${unknownOutcome}`);
      throw error;
    }
    if (issued.outcome === 'exists') {
      fail(
        values.general
          ? 'A current general code already exists, so nothing was issued. Add --replace to revoke it and issue a new one, or run `list` to see it.'
          : 'That code already exists, so nothing was issued. Run the command again.',
      );
    }
    console.log(`${issued.kind === 'general' ? 'General' : `Named (${values.name})`} invitation code. It is shown once and cannot be recovered; only its hash is stored:\n`);
    console.log(`  ${issued.code}\n`);
    console.log(`Invitation ID: ${issued.invitationId} (keep it to revoke this code)`);
    if (issued.replacedInvitationId) console.log(`Revoked the previous general code: ${issued.replacedInvitationId}`);
  } else if (command === 'list') {
    const invitations = await listInvitations();
    if (invitations.length === 0) console.log('No invitations.');
    for (const item of invitations) {
      console.log(`${item.invitationId}  ${item.kind.padEnd(7)} ${item.state.padEnd(8)} ${item.createdAt}${item.label ? `  ${item.label}` : ''}`);
    }
  } else {
    const input = values.id ? {actor, invitationId: values.id} : {actor, code: await readStdin()};
    if (values['code-stdin'] && !input.code) fail('No code was given on standard input.', 2);
    const receipt = await revokeInvitation(input);
    const messages = {
      revoked: 'Revoked. Existing Accounts are not affected.',
      already_revoked: 'Already revoked.',
      redeemed: 'Not revoked: this code was already redeemed.',
      not_found: 'No such invitation.',
    };
    console.log(messages[receipt.outcome]);
    if (receipt.outcome === 'redeemed' || receipt.outcome === 'not_found') process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof AccountsConfigError || error instanceof AccountsUnavailableError || error instanceof TypeError) {
    fail(`Failed: ${describe(error)}`);
  }
  fail('Failed: unexpected error.');
}
