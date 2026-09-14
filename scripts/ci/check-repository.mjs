#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const markdownFiles = ['README.md', 'tools/qualification/README.md', 'tools/qualification/devices/README.md', 'tools/qualification/stack/README.md'];

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const failures = [];
for (const relative of markdownFiles) {
  const file = resolve(root, relative);
  if (!(await exists(file))) { failures.push(`${relative}: file does not exist`); continue; }
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#', 1)[0].trim();
    if (!target || /^(?:https?:|mailto:|data:)/i.test(target)) continue;
    const clean = target.split('?', 1)[0];
    const candidate = resolve(file, '..', clean);
    if (!(await exists(candidate))) failures.push(`${relative}: broken link ${target}`);
  }
}

const required = [
  'package.json', 'package-lock.json',
  'tools/qualification/recovery/probe.py',
  'tools/qualification/stack/verify-stack.sh',
  'scripts/restore-supabase.mjs',
];
for (const relative of required) if (!(await exists(resolve(root, relative)))) failures.push(`missing required file: ${relative}`);

if (failures.length) {
  console.error('Repository checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Repository checks passed (${markdownFiles.length} Markdown files, ${required.length} required files).`);
