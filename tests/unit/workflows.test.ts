import {readdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parse} from 'yaml';
import {describe, expect, it} from 'vitest';

// Story 1.9 (AC-5, AC-7). The pipelines are workflows, and a workflow cannot be run here, so what can be proved is proved from their text:
// what triggers each one, which environment's secrets it may read, that nothing in it is a value, that only the two named workflows
// migrate anything, and that production can be reached only from the dispatched one. The first real run is the hosted check
// (provisioning items hosted-pipeline-check and hosted-schedules-check).
const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

type Step = {name?: string; id?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string>};
type Job = {name?: string; 'runs-on'?: string; environment?: string; env?: Record<string, string>; needs?: string; if?: string; permissions?: unknown; strategy?: {matrix?: Record<string, unknown>; 'fail-fast'?: boolean}; steps?: Step[]; outputs?: Record<string, string>};
type Workflow = {name?: string; on: Record<string, unknown>; permissions?: Record<string, string>; concurrency?: {group?: string; 'cancel-in-progress'?: boolean}; jobs: Record<string, Job>};

const directory = resolve(root, '.github/workflows');
const files = readdirSync(directory).filter((name) => name.endsWith('.yml')).sort();
const text = Object.fromEntries(files.map((name) => [name, read(`.github/workflows/${name}`)]));
const workflows = Object.fromEntries(files.map((name) => [name, parse(text[name]) as Workflow])) as Record<string, Workflow>;

const staging = workflows['staging.yml'];
const production = workflows['production-migrate.yml'];
const workers = workflows['workers.yml'];
const stepsOf = (workflow: Workflow) => Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
const runs = (workflow: Workflow) => stepsOf(workflow).map((step) => step.run ?? '');
const indexOfRun = (steps: Step[], needle: string) => steps.findIndex((step) => step.run?.includes(needle));
const secretNames = (source: string) => [...new Set([...source.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1]))].sort();

describe('the workflows that exist', () => {
  it('includes CI, the staging pipeline, the production migration and the worker images', () => {
    expect(files).toEqual(expect.arrayContaining(['ci.yml', 'production-migrate.yml', 'staging.yml', 'workers.yml']));
  });

  it('parses every workflow, each with a name, a trigger and at least one job', () => {
    for (const name of files) {
      const workflow = workflows[name];
      expect(workflow.name, name).toBeTruthy();
      expect(Object.keys(workflow.on ?? {}).length, name).toBeGreaterThan(0);
      expect(Object.keys(workflow.jobs).length, name).toBeGreaterThan(0);
    }
  });

  it('gives every workflow read-only repository access at the top, and no job asks for more', () => {
    for (const name of files) {
      expect(workflows[name].permissions, name).toEqual({contents: 'read'});
      for (const [id, job] of Object.entries(workflows[name].jobs)) expect(job.permissions, `${name} ${id}`).toBeUndefined();
    }
  });
});

describe('nothing in a workflow is a value (NFR-2)', () => {
  // A workflow reads a secret as `${{ secrets.NAME }}` and a variable of the run as `${{ inputs.x }}`; it never holds one.
  it('puts every secret-shaped environment value behind secrets.NAME', () => {
    for (const name of ['staging.yml', 'production-migrate.yml', 'workers.yml']) {
      const envs: Array<[string, string]> = [];
      for (const job of Object.values(workflows[name].jobs)) {
        for (const [key, value] of Object.entries(job.env ?? {})) envs.push([key, String(value)]);
        for (const step of job.steps ?? []) for (const [key, value] of Object.entries(step.env ?? {})) envs.push([key, String(value)]);
      }
      for (const [key, value] of envs.filter(([key]) => /TOKEN|PASSWORD|SECRET|KEY|HOOK|SITE_URL|PROJECT_REF|CLIENT_ID/.test(key))) {
        expect(value, `${name} ${key}`).toMatch(/^\$\{\{ secrets\.[A-Z][A-Z0-9_]+ \}\}$/);
        expect(value, `${name} ${key}`).toContain(`secrets.${key}`);
      }
    }
  });

  it('holds no URL, token, key, password or hook address, and no hosted hostname', () => {
    for (const name of ['staging.yml', 'production-migrate.yml', 'workers.yml']) {
      const source = text[name];
      expect(source, name).not.toMatch(/https?:\/\//);
      expect(source, name).not.toMatch(/api\.vercel\.com|vercel\.app|supabase\.co|backboard\.railway|upstash\.io/i);
      expect(source, name).not.toMatch(/\b(?:sbp_|sb_secret_|sb_publishable_|eyJ|ghp_|github_pat_|sig_|whsec_)[A-Za-z0-9_-]{6,}/);
      // No NAME=value assignment of a secret-named variable in a script.
      expect(source, name).not.toMatch(/^[ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|HOOK)[A-Z0-9_]*=\S/m);
    }
  });

  it('reads only the secrets the register knows, and each is registered in docs/secrets.md', () => {
    const used = secretNames(['staging.yml', 'production-migrate.yml', 'workers.yml'].map((name) => text[name]).join('\n'));
    expect(used).toEqual([
      'GHCR_TOKEN',
      'STAGING_SITE_URL',
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID',
      'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET',
      'SUPABASE_DB_PASSWORD',
      'SUPABASE_PROJECT_REF',
      'VERCEL_STAGING_DEPLOY_HOOK',
    ]);
    const register = read('docs/secrets.md');
    for (const name of used) expect(register, name).toMatch(new RegExp(`^### ${name}$|\`${name}\``, 'm'));
  });

  it('never interpolates an expression into a script: inputs and secrets reach a script only through the environment', () => {
    for (const name of ['staging.yml', 'production-migrate.yml', 'workers.yml']) {
      for (const script of runs(workflows[name])) expect(script, name).not.toContain('${{');
    }
  });

  it('never prints the deploy hook', () => {
    const hook = runs(staging).filter((script) => script.includes('VERCEL_STAGING_DEPLOY_HOOK'));
    expect(hook).toHaveLength(1);
    // Its VALUE (the expansion of the variable) is used by the check for "not set" and by curl, and by nothing that prints it. (The
    // message that names the variable names it, without expanding it.)
    for (const line of hook[0].split('\n')) {
      if (!/\$\{?VERCEL_STAGING_DEPLOY_HOOK/.test(line)) continue;
      expect(line, line).not.toMatch(/\becho\b|\bprintf\b|\bset -x\b|--verbose|(?:^|\s)-v\b|--trace|--include|-i\b/);
    }
    expect(hook[0]).toContain('--silent --show-error');
    expect(hook[0]).toContain('--output /dev/null');
    expect(text['staging.yml']).not.toMatch(/set -x|ACTIONS_STEP_DEBUG/);
  });
});

describe('staging.yml: a push to staging migrates, checks the settings and deploys', () => {
  const job = staging.jobs[Object.keys(staging.jobs)[0]];
  const steps = job.steps ?? [];

  it('runs on a push to the staging branch and on nothing else', () => {
    expect(staging.on).toEqual({push: {branches: ['staging']}});
  });

  it('has one job, in the staging environment, without cancelling a run that is migrating', () => {
    expect(Object.keys(staging.jobs)).toHaveLength(1);
    expect(job.environment).toBe('staging');
    expect(staging.concurrency?.['cancel-in-progress']).toBe(false);
    expect(staging.concurrency?.group).toBe('staging');
    expect(staging.permissions).toEqual({contents: 'read'});
  });

  it('uses the CLI version CI pins', () => {
    const setup = steps.find((step) => step.uses?.startsWith('supabase/setup-cli@'));
    expect(String(setup?.with?.version)).toBe('2.120.0');
    expect(String(parse(text['ci.yml']).jobs.baseline.steps.find((step: Step) => step.uses?.startsWith('supabase/setup-cli@')).with.version)).toBe('2.120.0');
  });

  it('links, migrates, writes the scratch config, diffs it with --exit-code, and only then asks for a deployment, in that order', () => {
    const order = [
      indexOfRun(steps, 'supabase link --project-ref "$SUPABASE_PROJECT_REF"'),
      indexOfRun(steps, 'supabase db push --linked'),
      indexOfRun(steps, 'node scripts/staging-config.mjs "$RUNNER_TEMP/staging-config"'),
      indexOfRun(steps, 'supabase config diff --workdir "$RUNNER_TEMP/staging-config" --project-ref "$SUPABASE_PROJECT_REF" --exit-code'),
      indexOfRun(steps, '"$VERCEL_STAGING_DEPLOY_HOOK"'),
    ];
    expect(order.every((index) => index >= 0), order.join()).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('migrates with the migrations alone: no seed, no roles, no reset, no repair, no prompt override', () => {
    const script = runs(staging).join('\n');
    expect(script).not.toMatch(/db reset|--include-seed|--include-roles|migration repair|--yes|\bdb remote\b|supabase config push|seed-accounts/);
    expect(script.match(/supabase db push/g)).toHaveLength(1);
  });

  it('does not diff the committed loopback file: the diff runs on the scratch copy only', () => {
    const diff = steps.find((step) => step.run?.includes('supabase config diff'))!;
    expect(diff.run).toContain('--workdir');
    expect(diff.run).toContain('--exit-code');
    expect(diff.run).not.toMatch(/--workdir\s+\.\s|--workdir\s+"?\$GITHUB_WORKSPACE/);
    const scratch = steps.find((step) => step.run?.includes('staging-config.mjs'))!;
    expect(scratch.run?.trim()).toBe('node scripts/staging-config.mjs "$RUNNER_TEMP/staging-config"');
  });

  it('asks Vercel with a POST that fails the step on an error, whenever the migration succeeded, even if the settings check failed', () => {
    const deploy = steps.find((step) => step.run?.includes('"$VERCEL_STAGING_DEPLOY_HOOK"'))!;
    expect(deploy.run).toMatch(/curl --fail\b/);
    expect(deploy.run).toMatch(/--request POST/);
    expect(deploy.if).toContain('steps.migrate.conclusion');
    expect(deploy.if).toContain("'success'");
    expect(deploy.if).toContain('!cancelled()');
    const migrate = steps.find((step) => step.id === 'migrate')!;
    expect(migrate.run).toContain('supabase db push --linked');
    expect(deploy.env).toEqual({VERCEL_STAGING_DEPLOY_HOOK: '${{ secrets.VERCEL_STAGING_DEPLOY_HOOK }}'});
    // It stops with a clear message when the hook is not set.
    expect(deploy.run).toMatch(/-z "\$VERCEL_STAGING_DEPLOY_HOOK"/);
    expect(deploy.run).toContain('exit 1');
  });

  it('reads the Supabase and Google settings from the environment of the job, as secrets', () => {
    expect(job.env).toEqual({
      SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
      SUPABASE_DB_PASSWORD: '${{ secrets.SUPABASE_DB_PASSWORD }}',
      SUPABASE_PROJECT_REF: '${{ secrets.SUPABASE_PROJECT_REF }}',
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: '${{ secrets.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID }}',
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET: '${{ secrets.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET }}',
      STAGING_SITE_URL: '${{ secrets.STAGING_SITE_URL }}',
    });
  });

  it('names no production project, environment or deployment', () => {
    expect(JSON.stringify(staging)).not.toMatch(/production/i);
    expect(text['staging.yml'].replace(/production-migrate\.yml/g, '')).not.toMatch(/environment:\s*production/);
  });
});

describe('production-migrate.yml: the only way a migration reaches production, and only by hand', () => {
  const job = production.jobs[Object.keys(production.jobs)[0]];
  const steps = job.steps ?? [];

  it('has workflow_dispatch as its only trigger, with a required typed instance ID', () => {
    expect(Object.keys(production.on)).toEqual(['workflow_dispatch']);
    const inputs = (production.on.workflow_dispatch as {inputs: Record<string, {required?: boolean; type?: string; description?: string}>}).inputs;
    expect(Object.keys(inputs)).toEqual(['instance_id']);
    expect(inputs.instance_id.required).toBe(true);
    expect(inputs.instance_id.type).toBe('string');
    expect(inputs.instance_id.description).toMatch(/INSTANCE_ID/);
  });

  it('runs in the production environment, one at a time, with read-only repository access', () => {
    expect(Object.keys(production.jobs)).toHaveLength(1);
    expect(job.environment).toBe('production');
    expect(production.concurrency?.['cancel-in-progress']).toBe(false);
    expect(production.permissions).toEqual({contents: 'read'});
  });

  it('stops at its first step, with a clear message, when the project is not provisioned or the instance ID is not a UUID', () => {
    const first = steps[0];
    expect(first.uses).toBeUndefined();
    expect(first.run).toContain('[ -z "$SUPABASE_PROJECT_REF" ]');
    expect(first.run).toContain('[ -z "$SUPABASE_ACCESS_TOKEN" ]');
    expect(first.run).toContain('[ -z "$SUPABASE_DB_PASSWORD" ]');
    expect(first.run).toMatch(/::error::The production project is not provisioned/);
    expect(first.run).toContain('Nothing was changed.');
    expect(first.run).toMatch(/\[0-9a-fA-F\]\{8\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{12\}/);
    expect(first.run?.match(/exit 1/g)).toHaveLength(2);
    expect(job.env?.TYPED_INSTANCE_ID).toBe('${{ inputs.instance_id }}');
    // Nothing that changes anything comes before it.
    expect(steps.findIndex((step) => step.uses?.startsWith('supabase/setup-cli@'))).toBeGreaterThan(0);
    expect(steps.findIndex((step) => step.run?.includes('supabase db push'))).toBeGreaterThan(0);
  });

  it('links, lists what is pending, then applies the migrations: no seed, no settings, no deployment', () => {
    const order = [indexOfRun(steps, 'supabase link'), indexOfRun(steps, 'supabase db push --linked --dry-run'), indexOfRun(steps, 'supabase db push --linked\n') >= 0 ? indexOfRun(steps, 'supabase db push --linked\n') : steps.findIndex((step) => step.run?.trim() === 'supabase db push --linked')];
    expect(order.every((index) => index >= 0), order.join()).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const script = runs(production).join('\n');
    expect(script).not.toMatch(/db reset|--include-seed|--include-roles|migration repair|--yes|supabase config|seed-accounts|curl|VERCEL|deploy/i);
  });

  it('reads only the Supabase secrets', () => {
    expect(secretNames(text['production-migrate.yml'])).toEqual(['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_REF']);
  });
});

describe('only these two workflows change a database, and only one can reach production', () => {
  it('runs `supabase link` and `supabase db push` in staging.yml and production-migrate.yml only', () => {
    for (const name of files) {
      const script = runs(workflows[name]).join('\n');
      if (name === 'staging.yml' || name === 'production-migrate.yml') {
        expect(script, name).toContain('supabase db push');
        continue;
      }
      expect(script, name).not.toMatch(/supabase (?:db push|link|config push|config diff|db reset --linked|migration)/);
    }
  });

  it('names the production environment in production-migrate.yml only', () => {
    for (const name of files) {
      const environments = Object.values(workflows[name].jobs).map((job) => job.environment);
      if (name === 'production-migrate.yml') expect(environments, name).toEqual(['production']);
      else expect(environments.filter((environment) => environment === 'production'), name).toEqual([]);
      // Not even as text, outside a comment.
      const code = text[name].split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
      if (name !== 'production-migrate.yml') expect(code, name).not.toMatch(/environment:\s*['"]?production/);
    }
  });

  it('has no other workflow with a way to be started by hand into a deployment or migration', () => {
    for (const name of files.filter((file) => file !== 'production-migrate.yml')) {
      expect(Object.keys(workflows[name].on), name).not.toContain('workflow_dispatch');
      expect(Object.keys(workflows[name].on), name).not.toContain('schedule');
    }
  });

  it('keeps CI (every push) free of secrets, hosted projects and the new commands', () => {
    const ci = text['ci.yml'];
    expect(secretNames(ci)).toEqual([]);
    expect(ci).not.toMatch(/environment:|supabase (?:link|db push|config)|staging-config|schedules\.mjs|list-workers|--project-ref|curl /);
    // CI runs the static check of the Auth declarations through the step that is already there, and gained no step for the story.
    const steps = (workflows['ci.yml'].jobs.baseline.steps ?? []).map((step) => step.run ?? '').join('\n');
    expect(steps).toContain('node scripts/ci/check-repository.mjs');
  });

  it('calls no Railway or QStash API from any workflow: the Railway deploy is a documented manual step', () => {
    for (const name of files) {
      const code = text[name].split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
      expect(code, name).not.toMatch(/backboard\.railway|graphql|RAILWAY_TOKEN|@railway\/cli|\brailway (?:up|redeploy|deploy|link|login|run)\b|qstash\.upstash|QSTASH_/);
    }
  });
});

describe('workers.yml: an image for each worker, pushed by digest', () => {
  const list = workers.jobs.list;
  const image = workers.jobs.image;

  it('runs on a push to staging that changes anything under workers/, and on nothing else', () => {
    expect(workers.on).toEqual({push: {branches: ['staging'], paths: ['workers/**']}});
    expect(workers.permissions).toEqual({contents: 'read'});
    expect(workers.concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('lists the workers with scripts/ci/list-workers.mjs and skips the image job when there are none', () => {
    expect(list.steps?.find((step) => step.id === 'workers')?.run?.trim()).toBe('node scripts/ci/list-workers.mjs');
    expect(list.outputs).toEqual({matrix: '${{ steps.workers.outputs.matrix }}', any: '${{ steps.workers.outputs.any }}'});
    expect(image.needs).toBe('list');
    expect(image.if).toBe("${{ needs.list.outputs.any == 'true' }}");
    expect(image.strategy?.matrix).toEqual({worker: '${{ fromJSON(needs.list.outputs.matrix) }}'});
    expect(image.strategy?.['fail-fast']).toBe(false);
  });

  it('builds each worker from its own Dockerfile and pushes it to GitHub Container Registry with the registry token', () => {
    expect(image.environment).toBe('staging');
    const login = image.steps?.find((step) => step.uses?.startsWith('docker/login-action@'));
    expect(login?.with).toEqual({registry: 'ghcr.io', username: '${{ github.repository_owner }}', password: '${{ secrets.GHCR_TOKEN }}'});
    const build = image.steps?.find((step) => step.uses?.startsWith('docker/build-push-action@'));
    expect(build?.id).toBe('push');
    expect(build?.with?.context).toBe('workers/${{ matrix.worker }}');
    expect(build?.with?.file).toBe('workers/${{ matrix.worker }}/Dockerfile');
    expect(build?.with?.push).toBe(true);
    expect(String(build?.with?.tags)).toBe('${{ steps.image.outputs.name }}:${{ github.sha }}');
    expect(String(build?.with?.tags)).not.toMatch(/latest/);
    // The image name is lower case, as GitHub Container Registry needs.
    expect(image.steps?.find((step) => step.id === 'image')?.run).toContain('${GITHUB_REPOSITORY,,}');
  });

  it('records the digest, not a tag, as what is deployed, and says the Railway step is manual', () => {
    const record = image.steps?.find((step) => step.name === 'Record the digest');
    expect(record?.env).toMatchObject({IMAGE: '${{ steps.image.outputs.name }}', DIGEST: '${{ steps.push.outputs.digest }}'});
    expect(record?.run).toContain('$IMAGE@$DIGEST');
    expect(record?.run).toContain('$GITHUB_STEP_SUMMARY');
    expect(record?.run).toMatch(/Manual step/);
    expect(record?.run).toMatch(/set the \\`\$WORKER\\` service's image to the reference above/);
  });

  it('deploys nothing itself', () => {
    // (The summary's words about the manual step are echo lines; what is checked is every other command.)
    const commands = runs(workers).join('\n').split('\n').filter((line) => !/^\s*echo\b/.test(line)).join('\n');
    expect(commands).not.toMatch(/\bcurl\b|\bwget\b|\bnpx\b|\brailway\b|VERCEL/i);
  });
});
