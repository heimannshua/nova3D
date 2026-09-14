#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const target = process.argv[2] || 'local';
if (!['local', 'staging', 'production'].includes(target)) { console.error('Usage: node scripts/setup-env.mjs [local|staging|production]'); process.exit(2); }
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, target === 'local' ? '.env.example' : `.env.${target}.example`);
const destination = resolve(root, target === 'local' ? '.env.local' : `.env.${target}`);
if (existsSync(destination)) { console.log(`${destination} already exists; leaving it unchanged.`); process.exit(0); }
copyFileSync(source, destination);
chmodSync(destination, 0o600);
console.log(`Created ${destination} from ${source}. Replace placeholders locally; the file is ignored by git.`);
