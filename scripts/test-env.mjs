#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const base = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', PAID_ADAPTERS_ENABLED: 'false', SYNTHETIC_DATA_ENABLED: 'true' };
const run = (env) => spawnSync(process.execPath, ['scripts/check-env.mjs'], { env: { ...process.env, ...env }, encoding: 'utf8' });
const pass = run({ ...base, APP_ENV: 'staging', NEXT_PUBLIC_APP_ENV: 'staging', VERCEL_ENV: 'preview' });
if (pass.status !== 0) throw new Error(pass.stderr);
const fail = run({ ...base, APP_ENV: 'production', NEXT_PUBLIC_APP_ENV: 'production', VERCEL_ENV: 'preview' });
if (fail.status === 0 || !fail.stderr.includes('must use APP_ENV=staging')) throw new Error('preview mixing was not rejected');
const placeholder = run({ ...base, APP_ENV: 'local', NEXT_PUBLIC_APP_ENV: 'local', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'replace-with-local-anon-key' });
if (placeholder.status === 0 || !placeholder.stderr.includes('placeholder values are not allowed')) throw new Error('placeholder credentials were not rejected');
const productionSynthetic = run({ ...base, APP_ENV: 'production', NEXT_PUBLIC_APP_ENV: 'production', SYNTHETIC_DATA_ENABLED: 'true' });
if (productionSynthetic.status === 0 || !productionSynthetic.stderr.includes('production cannot enable synthetic data')) throw new Error('production synthetic mode was not rejected');
const unsafePreview = run({ ...base, APP_ENV: 'staging', NEXT_PUBLIC_APP_ENV: 'staging', VERCEL_ENV: 'preview', PAID_ADAPTERS_ENABLED: 'true' });
if (unsafePreview.status === 0 || !unsafePreview.stderr.includes('PAID_ADAPTERS_ENABLED=false')) throw new Error('paid preview adapters were not rejected');
const invalid = run({ ...base, APP_ENV: 'qa', NEXT_PUBLIC_APP_ENV: 'qa', NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' });
if (invalid.status === 0 || !invalid.stderr.includes('APP_ENV must be local')) throw new Error('invalid environment was not rejected');
console.log('Environment validation tests passed.');
