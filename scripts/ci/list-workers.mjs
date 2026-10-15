#!/usr/bin/env node
// Story 1.9. Lists the worker images CI builds: one for each `workers/<name>/Dockerfile`.
//
//   node scripts/ci/list-workers.mjs [<repository root>]
//
// Prints the JSON array of worker names (sorted) on the first line of standard output. When GITHUB_OUTPUT is set (a workflow step) it also
// appends `matrix=<that JSON>` and `any=true|false` to it, so .github/workflows/workers.yml can fan out over the workers and skip its image
// job when there are none (none exists yet: the first arrives with Story 2.7). A name must be lower-case letters, digits and hyphens: it
// becomes part of an image name in GitHub Container Registry. Anything else stops with a message, because an image that could not be
// named would otherwise be silently left unbuilt.
//
// Plain ESM, no dependency. `listWorkers` is exported for tests/unit/list-workers.test.ts; the command-line entry runs only when this
// file is the program.
import {appendFileSync, existsSync, readdirSync, realpathSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const namePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The sorted names of the directories under `<root>/workers` that hold a Dockerfile. Throws on a name that cannot be an image name. */
export function listWorkers(root) {
  const workersDir = resolve(root, 'workers');
  if (!existsSync(workersDir) || !statSync(workersDir).isDirectory()) return [];
  const names = [];
  for (const entry of readdirSync(workersDir, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    if (!existsSync(resolve(workersDir, entry.name, 'Dockerfile'))) continue;
    if (!namePattern.test(entry.name)) throw new Error(`workers/${entry.name}: a worker directory must be named with lower-case letters, digits and hyphens (it becomes an image name)`);
    names.push(entry.name);
  }
  return names.sort();
}

/** Whether this file is the program being run, by REAL path on both sides: through a symlink the path as typed is not the module's own URL. */
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    const names = listWorkers(resolve(process.argv[2] ?? resolve(import.meta.dirname, '../..')));
    const json = JSON.stringify(names);
    console.log(json);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${json}\nany=${names.length > 0}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'could not list the workers');
    process.exit(1);
  }
}
