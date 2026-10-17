import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {listWorkers} from '../../scripts/ci/list-workers.mjs';

// Story 1.9. scripts/ci/list-workers.mjs finds each workers/<name>/Dockerfile; .github/workflows/workers.yml builds one image for each and
// skips its image job when there is none (the first worker is the file gateway of Story 1.12; the others arrive with Story 2.7).
const root = resolve(import.meta.dirname, '../..');
const script = resolve(root, 'scripts/ci/list-workers.mjs');
const temp = mkdtempSync(join(tmpdir(), 'nova3d-workers-'));
afterAll(() => rmSync(temp, {recursive: true, force: true}));

/** A repository layout with the given worker directories; a name ending in `/` has no Dockerfile. */
function layout(name: string, workers: string[]) {
  const dir = join(temp, name);
  mkdirSync(dir, {recursive: true});
  for (const worker of workers) {
    mkdirSync(join(dir, 'workers', worker.replace(/\/$/, '')), {recursive: true});
    if (!worker.endsWith('/')) writeFileSync(join(dir, 'workers', worker, 'Dockerfile'), 'FROM scratch\n');
  }
  return dir;
}

describe('listWorkers', () => {
  it('finds the one worker this repository has: the file gateway (Story 1.12)', () => {
    expect(listWorkers(root)).toEqual(['files']);
  });

  it('finds nothing when there is no workers directory, or an empty one', () => {
    expect(listWorkers(layout('none', []))).toEqual([]);
    const empty = layout('empty', []);
    mkdirSync(join(empty, 'workers'));
    expect(listWorkers(empty)).toEqual([]);
  });

  it('lists each directory with a Dockerfile, sorted, and skips one without', () => {
    expect(listWorkers(layout('some', ['gateway', 'cad-worker', 'docs-only/', 'engine-2']))).toEqual(['cad-worker', 'engine-2', 'gateway']);
  });

  it('ignores a file under workers/ and a Dockerfile that is nested deeper', () => {
    const dir = layout('odd', ['real']);
    writeFileSync(join(dir, 'workers', 'README.md'), 'x');
    mkdirSync(join(dir, 'workers', 'outer', 'inner'), {recursive: true});
    writeFileSync(join(dir, 'workers', 'outer', 'inner', 'Dockerfile'), 'FROM scratch\n');
    expect(listWorkers(dir)).toEqual(['real']);
  });

  it('refuses a name that could not be an image name, instead of leaving the image unbuilt', () => {
    for (const bad of ['Upper', 'with_underscore', 'has space', '-leading', '.hidden']) {
      expect(() => listWorkers(layout(`bad-${bad}`.replace(/[^a-z0-9-]/gi, '_'), [bad])), bad).toThrow(/lower-case letters, digits and hyphens/);
    }
  });
});

describe('the command', () => {
  const run = (args: string[], env: Record<string, string | undefined> = {}) => spawnSync(process.execPath, [script, ...args], {encoding: 'utf8', env: {PATH: process.env.PATH, ...env} as unknown as NodeJS.ProcessEnv});

  it('prints the JSON list on its first line', () => {
    expect(run([layout('cli-some', ['b', 'a'])]).stdout.split('\n')[0]).toBe('["a","b"]');
    expect(run([layout('cli-none', [])]).stdout.trim()).toBe('[]');
    // With no argument it reads this repository, which has the file gateway (Story 1.12).
    expect(run([]).stdout.trim()).toBe('["files"]');
  });

  it('runs through a symlink too: the entry check compares real paths, so a link does not turn the command into a silent no-op that leaves the workflow with no output', () => {
    const link = join(temp, 'link-to-list-workers.mjs');
    symlinkSync(script, link);
    const output = join(temp, 'github-output-linked');
    writeFileSync(output, '');
    const result = spawnSync(process.execPath, [link, layout('linked', ['gateway'])], {encoding: 'utf8', env: {PATH: process.env.PATH, GITHUB_OUTPUT: output} as unknown as NodeJS.ProcessEnv});
    expect(result.status).toBe(0);
    expect(result.stdout.split('\n')[0]).toBe('["gateway"]');
    expect(readFileSync(output, 'utf8')).toBe('matrix=["gateway"]\nany=true\n');
  });

  it('appends matrix= and any= to GITHUB_OUTPUT, so the workflow can skip its image job', () => {
    const output = join(temp, 'github-output');
    writeFileSync(output, '');
    expect(run([layout('out-none', [])], {GITHUB_OUTPUT: output}).status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('matrix=[]\nany=false\n');
    writeFileSync(output, '');
    expect(run([layout('out-some', ['gateway'])], {GITHUB_OUTPUT: output}).status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('matrix=["gateway"]\nany=true\n');
  });

  it('exits 1 with the reason for a name that is not an image name, and writes no output', () => {
    const output = join(temp, 'github-output-bad');
    writeFileSync(output, '');
    const result = run([layout('cli-bad', ['Bad_Name'])], {GITHUB_OUTPUT: output});
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/workers\/Bad_Name: a worker directory must be named/);
    expect(readFileSync(output, 'utf8')).toBe('');
  });
});
