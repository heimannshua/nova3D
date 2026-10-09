import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parse} from 'yaml';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

type Step = {name?: string; id?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>};
const workflow = parse(read('.github/workflows/ci.yml')) as {
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean};
  jobs: Record<string, {steps?: Step[]}>;
};
// Parsed, so a commented-out step cannot satisfy an assertion.
const steps: Step[] = workflow.jobs.baseline.steps ?? [];
const commands = steps.map((step) => step.run ?? '').join('\n');
const indexOfRun = (needle: string) => steps.findIndex((step) => step.run?.includes(needle));

describe('pinned runtime contract (AR-1)', () => {
  it('allows Node 24 only and pins the qualified stack', () => {
    expect(pkg.engines.node).toBe('>=24 <25');
    expect(pkg.dependencies).toMatchObject({
      next: '16.3.5',
      react: '19.3.0',
      'react-dom': '19.3.0',
      '@supabase/supabase-js': '2.116.0',
      '@supabase/ssr': '0.12.7',
    });
    expect(pkg.devDependencies).toMatchObject({typescript: '5.9.3', tailwindcss: '4.3.3'});
  });

  it('enforces the engines range on install and names the Node version for nvm', () => {
    expect(read('.npmrc')).toMatch(/^engine-strict=true$/m);
    expect(read('.nvmrc').trim()).toBe('24.21.0');
  });

  it('keeps build-only tooling out of the runtime dependencies', () => {
    expect(pkg.dependencies).not.toHaveProperty('bmad-method');
    expect(pkg.devDependencies).toHaveProperty('bmad-method');
  });

  it('pins the test runners exactly and records them in the lockfile', () => {
    for (const name of ['vitest', '@playwright/test', 'yaml']) {
      const version = pkg.devDependencies[name];
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(lock.packages[`node_modules/${name}`].version, name).toBe(version);
    }
  });

  it('records the runtime dependency set in the lockfile root', () => {
    expect(lock.packages[''].dependencies).not.toHaveProperty('bmad-method');
    expect(lock.packages['node_modules/bmad-method'].dev).toBe(true);
  });

  it('only allows syntax that Node can strip, because scripts import .ts files directly', () => {
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.erasableSyntaxOnly).toBe(true);
  });
});

describe('CI contract', () => {
  it('pins Node 24.21.0 in a setup-node step', () => {
    const setup = steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
    expect(String(setup?.with?.['node-version'])).toBe('24.21.0');
  });

  it('builds credential-free before the stack starts, then runs every suite against the stack', () => {
    const start = indexOfRun('supabase start');
    const build = indexOfRun('npm run build');
    expect(build).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(build);
    expect(steps[build].run).not.toMatch(/APP_ENV|SUPABASE/);
    expect(steps[build]).not.toHaveProperty('env');
    for (const command of ['npm test', 'npm run test:env', 'npm run test:health', 'npm run test:e2e', 'check:env -- --live']) {
      expect(indexOfRun(command), command).toBeGreaterThan(-1);
    }
    for (const command of ['npm test', 'npm run test:health', 'npm run test:e2e', 'check:env -- --live']) {
      expect(indexOfRun(command), command).toBeGreaterThan(start);
    }
    expect(commands).toContain('node scripts/setup-env.mjs local');
  });

  it('stops the stack only when the start step ran, and always then', () => {
    const start = steps.find((step) => step.run?.includes('supabase start'));
    expect(start?.id).toBeTruthy();
    const stop = steps.find((step) => step.run?.includes('supabase stop'));
    expect(stop?.if).toContain('always()');
    expect(stop?.if).toContain(`steps.${start?.id}.conclusion != 'skipped'`);
  });

  it('cancels superseded runs of the same ref', () => {
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(true);
    expect(workflow.concurrency?.group).toContain('github.ref');
  });
});

describe('deployment contract (AR-26)', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const skips = (ref: string | undefined) => {
    const env: Record<string, string | undefined> = {PATH: process.env.PATH, ...(ref === undefined ? {} : {VERCEL_GIT_COMMIT_REF: ref})};
    return spawnSync('sh', ['-c', vercel.ignoreCommand], {env: env as NodeJS.ProcessEnv}).status;
  };

  // Vercel skips the build when the ignore command exits 0 and proceeds when it exits 1.
  it('builds the staging branch only', () => {
    expect(skips('staging')).toBe(1);
    expect(skips('main')).toBe(0);
    expect(skips('feature/anything')).toBe(0);
    expect(skips('staging-two')).toBe(0);
    expect(skips('')).toBe(0);
    expect(skips(undefined)).toBe(0);
  });

  it('does not deploy main from Git', () => {
    expect(vercel.git.deploymentEnabled.main).toBe(false);
  });

  it('pins the build command so a dashboard override cannot skip prebuild', () => {
    expect(vercel.buildCommand).toBe('npm run build');
    expect(pkg.scripts.build).toContain('next build');
  });

  it('runs the deployment identity check before every build', () => {
    expect(pkg.scripts.prebuild).toBe('node scripts/check-env.mjs --deployment');
  });
});
