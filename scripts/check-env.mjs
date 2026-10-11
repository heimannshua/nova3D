#!/usr/bin/env node
// Usage: node scripts/check-env.mjs [--live | --deployment]
//   (no flag)     label and format checks only; reads no network
//   --live        also compares APP_ENV and INSTANCE_ID with the instance_identity row, and asks the
//                 accounts API (api.preflight, which reads the tables the gate depends on, Auth's sessions
//                 and identities included) for ok: the api schema must be exposed, the Story 1.3 and 1.4a
//                 migrations applied and the privileges in place. It cannot tell whether the accounts are
//                 seeded.
//   --deployment  the build step: does nothing unless VERCEL is set, then behaves like --live
// Previews never read the database. No secret is printed.
import {isPreview, validateEnvironment, verifyInstanceIdentity} from '../lib/environment.ts';

const flags = new Set(process.argv.slice(2));
const unknown = [...flags].filter((flag) => !['--live', '--deployment'].includes(flag));
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(' ')}. Usage: node scripts/check-env.mjs [--live | --deployment]`);
  process.exit(2);
}

const deployment = flags.has('--deployment');
if (deployment && !process.env.VERCEL) {
  console.log('Deployment environment check skipped: VERCEL is not set, so local and CI builds stay credential-free.');
  process.exit(0);
}

const live = deployment || flags.has('--live');
const environment = process.env.APP_ENV;
const errors = live ? await verifyInstanceIdentity(process.env, undefined, {accountsApi: true}) : validateEnvironment(process.env);

if (errors.length) {
  console.error(`Environment validation failed for ${environment || 'unset'}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const verified = live && !isPreview(process.env) ? ' Instance identity verified against the database; the accounts API answered.' : '';
console.log(`Environment validation passed for ${environment}.${verified}`);
