import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

// Story 1.3 Part B (AC-9): the interim email-list gate is gone from the repository. The names are built
// from pieces so this file does not contain them either. The repository is what git lists (tracked files, and
// untracked ones that are not ignored); where git is not available the file system is walked instead,
// skipping what git would ignore. A developer's own env files are not the repository, and the planning
// folders are history, as in the spec's grep.
const root = resolve(import.meta.dirname, '../..');
const removed = [['AUTH', 'ALLOWED', 'EMAILS'].join('_'), ['allowed', 'Email'].join(''), ['auth', 'Allowed', 'Emails'].join('')];
const history = /^(?:_bmad|_bmad-output)\//;
const skippedDirectories = new Set(['node_modules', '.git', '.next', '.vercel', '.playwright-mcp', 'playwright-report', 'test-results', '.uv-cache', '__pycache__', '_bmad', '_bmad-output']);
// Real env files and backups are git-ignored; the *.example templates are the repository's.
const ignoredFile = /^(?:\.env(?:\.(?:local|staging|production))?|\.env\.[a-z]+\.local|\.env\.local\.bak.*|state\.lock|.*\.tsbuildinfo)$/;

/** Files git lists, relative to the root, or null when git cannot answer. */
function filesFromGit(directory: string): string[] | null {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: directory, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (listed.error || listed.status !== 0) return null;
  return listed.stdout.split('\0').filter(Boolean);
}

/** Every file under the directory except what git would ignore, relative to it. */
function filesFromDisk(directory: string): string[] {
  const walk = (current: string): string[] =>
    readdirSync(current).flatMap((name) => {
      const path = join(current, name);
      if (statSync(path).isDirectory()) return skippedDirectories.has(name) ? [] : walk(path);
      return ignoredFile.test(name) ? [] : [relative(directory, path)];
    });
  return walk(directory);
}

const repositoryFiles = () => filesFromGit(root) ?? filesFromDisk(root);
const readable = (file: string) => {
  try {
    const text = readFileSync(resolve(root, file), 'latin1');
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
};

describe('the removed allowlist (AC-9)', () => {
  const files = repositoryFiles().filter((file) => !history.test(file));

  it('looks at the whole repository', () => {
    expect(files.length).toBeGreaterThan(100);
    for (const expected of ['proxy.ts', 'lib/environment.ts', '.env.example', 'docs/auth-setup.md', 'scripts/check-env.mjs']) expect(files).toContain(expected);
  });

  it('appears nowhere: not as a variable, not as a helper, not in the docs, the templates or the tests', () => {
    const found: string[] = [];
    for (const file of files) {
      const text = readable(file);
      if (text === null) continue;
      for (const name of removed) if (text.includes(name)) found.push(`${file}: ${name}`);
    }
    expect(found).toEqual([]);
  });

  it('finds the same repository without git, by walking the file system', () => {
    const walked = filesFromDisk(root).filter((file) => !history.test(file));
    expect(walked.length).toBeGreaterThan(100);
    for (const expected of ['proxy.ts', 'lib/environment.ts', '.env.example', 'docs/auth-setup.md', 'tests/unit/allowlist-removal.test.ts']) expect(walked).toContain(expected);
    // Everything git lists is on disk too (git may also skip files the walk keeps, such as an untracked editor file).
    const listed = filesFromGit(root);
    if (listed) for (const file of listed.filter((entry) => !history.test(entry))) expect(walked, file).toContain(file);
  });
});

describe('the file-system walk', () => {
  it('skips dependencies, build output, history and a developer’s own env files, and keeps the templates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova3d-walk-'));
    try {
      const write = (file: string) => {
        mkdirSync(join(directory, file, '..'), {recursive: true});
        writeFileSync(join(directory, file), 'x');
      };
      for (const file of ['a.ts', 'lib/b.ts', 'node_modules/p/index.js', '.git/config', '.next/server.js', '_bmad/x.md', '_bmad-output/y.md', '.env.local', '.env.staging', '.env.example', '.env.staging.example', 'deep/er/c.md']) write(file);
      expect(filesFromDisk(directory).sort()).toEqual(['.env.example', '.env.staging.example', 'a.ts', 'deep/er/c.md', 'lib/b.ts']);
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });

  it('falls back to the walk when git cannot answer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova3d-nogit-'));
    try {
      writeFileSync(join(directory, 'a.ts'), 'x');
      // Not a git repository (and no repository above the system temp directory): git has nothing to list.
      expect(filesFromGit(directory)).toBeNull();
      expect(filesFromDisk(directory)).toEqual(['a.ts']);
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });
});
