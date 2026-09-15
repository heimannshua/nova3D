#!/usr/bin/env node
const environment = process.env.APP_ENV;
const preview = process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development';
const required = ['APP_ENV', 'NEXT_PUBLIC_APP_ENV', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'AUTH_ALLOWED_EMAILS', 'PAID_ADAPTERS_ENABLED', 'SYNTHETIC_DATA_ENABLED'];
const missing = required.filter((name) => !process.env[name]);
const forbiddenPlaceholder = /^(?:replace-with-|<[^>]+>|changeme|todo)/i;
const placeholders = required.filter((name) => forbiddenPlaceholder.test(process.env[name] || ''));
const errors = [];
if (!['local', 'staging', 'production'].includes(environment)) errors.push('APP_ENV must be local, staging, or production');
if (missing.length) errors.push(`missing required variables: ${missing.join(', ')}`);
if (placeholders.length) errors.push(`placeholder values are not allowed: ${placeholders.join(', ')}`);
if (process.env.NEXT_PUBLIC_APP_ENV !== environment) errors.push('APP_ENV and NEXT_PUBLIC_APP_ENV must match');
if (!process.env.AUTH_ALLOWED_EMAILS?.split(',').map((value) => value.trim()).filter(Boolean).length) errors.push('AUTH_ALLOWED_EMAILS must contain at least one email address');
try { if (process.env.NEXT_PUBLIC_SUPABASE_URL) new URL(process.env.NEXT_PUBLIC_SUPABASE_URL); } catch { errors.push('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'); }
for (const name of ['PAID_ADAPTERS_ENABLED', 'SYNTHETIC_DATA_ENABLED']) if (process.env[name] && !['true', 'false'].includes(process.env[name])) errors.push(`${name} must be true or false`);
if (preview && environment !== 'staging') errors.push('Vercel preview/development deployments must use APP_ENV=staging');
if (preview && process.env.SYNTHETIC_DATA_ENABLED !== 'true') errors.push('preview/development requires SYNTHETIC_DATA_ENABLED=true');
if (preview && process.env.PAID_ADAPTERS_ENABLED !== 'false') errors.push('preview/development requires PAID_ADAPTERS_ENABLED=false');
if (process.env.VERCEL_ENV === 'production' && environment !== 'production') errors.push('Vercel production deployments must use APP_ENV=production');
if (environment === 'production' && process.env.SYNTHETIC_DATA_ENABLED === 'true') errors.push('production cannot enable synthetic data');
if (errors.length) { console.error(`Environment validation failed for ${environment || 'unset'}:`); for (const error of errors) console.error(`- ${error}`); process.exit(1); }
console.log(`Environment validation passed for ${environment}.`);
