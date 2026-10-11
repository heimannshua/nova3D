import {spawn} from 'node:child_process';
import {chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

// The part of scripts/fake-google-stack.mjs that decides what the swapped Auth container is: the docker command
// that recreates it and the environment it gets. Nothing here runs docker.
type Inspected = {
  Config: {Image: string; Cmd: string[] | null; Entrypoint: string[] | null; User: string; WorkingDir: string; Labels: Record<string, string>; Env: string[]; Healthcheck?: {Test: string[]; Interval: number; Timeout: number; Retries: number}};
  HostConfig: {NetworkMode: string; ExtraHosts: string[] | null; RestartPolicy: {Name: string; MaximumRetryCount: number}};
  NetworkSettings: {Networks: Record<string, {Aliases: string[] | null}>};
};
type Stack = {up(): Promise<void>; down(options?: {quiet?: boolean}): Promise<void>; status(): Promise<boolean>; containerName: string; stateRoot: string};
type Module = {
  createFakeGoogleStack(options: Record<string, unknown>): Stack;
  createArguments(container: Inspected, options: {name: string; envFile: string}): string[];
  swappedEnvironment(env: string[], options: {clientId: string; clientSecret: string; tunnelPort: number; callbacks: string[]}): string[];
  applicationCallbacks(env?: Record<string, string | undefined>): string[];
  isSwapped(container: {Config?: {Env?: string[]}} | null): boolean;
};
const load = async () => (await import(pathToFileURL(resolve(import.meta.dirname, '../../scripts/fake-google-stack.mjs')).href)) as Module;

const original: Inspected = {
  Config: {
    Image: 'public.ecr.aws/supabase/gotrue:v2.197.0',
    Cmd: ['auth'],
    Entrypoint: null,
    User: 'supabase',
    WorkingDir: '/',
    Labels: {'com.supabase.cli.project': 'nova3d-local', 'com.docker.compose.project': 'nova3d-local'},
    Env: [
      'GOTRUE_API_PORT=9999',
      'GOTRUE_EXTERNAL_GOOGLE_ENABLED=true',
      'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)',
      'GOTRUE_EXTERNAL_GOOGLE_SECRET=hash:abc',
      'GOTRUE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long',
      'GOTRUE_URI_ALLOW_LIST=http://127.0.0.1:3000/auth/callback,http://localhost:3000/auth/callback',
    ],
    Healthcheck: {Test: ['CMD-SHELL', 'wget --spider http://127.0.0.1:9999/health'], Interval: 10_000_000_000, Timeout: 2_000_000_000, Retries: 3},
  },
  HostConfig: {NetworkMode: 'supabase_network_nova3d-local', ExtraHosts: ['host.docker.internal:host-gateway'], RestartPolicy: {Name: 'unless-stopped', MaximumRetryCount: 0}},
  NetworkSettings: {Networks: {'supabase_network_nova3d-local': {Aliases: ['auth']}}},
};
const options = {clientId: 'fake-client.apps.googleusercontent.com', clientSecret: 'a-random-secret-value', tunnelPort: 9101, callbacks: ['http://127.0.0.1:4173/auth/callback', 'http://127.0.0.1:4174/auth/callback']};

describe('the swapped Auth container', () => {
  it('is the same container: image, command, user, labels, network, aliases, hosts, restart policy and health check', async () => {
    const { createArguments } = await load();
    const args = createArguments(original, {name: 'supabase_auth_nova3d-local', envFile: '/private/auth.env'});
    expect(args.slice(0, 2)).toEqual(['create', '--name']);
    expect(args).toEqual(expect.arrayContaining(['supabase_auth_nova3d-local', '--network', 'supabase_network_nova3d-local', '--network-alias', 'auth', '--add-host', 'host.docker.internal:host-gateway', '--restart', 'unless-stopped', '--user', 'supabase', '--workdir', '/']));
    // Labels are what `supabase stop` finds the container by.
    expect(args).toEqual(expect.arrayContaining(['--label', 'com.supabase.cli.project=nova3d-local', 'com.docker.compose.project=nova3d-local']));
    expect(args).toEqual(expect.arrayContaining(['--health-cmd', 'wget --spider http://127.0.0.1:9999/health', '--health-interval', '10s', '--health-timeout', '2s', '--health-retries', '3']));
    // The image and its command come last.
    expect(args.slice(-2)).toEqual(['public.ecr.aws/supabase/gotrue:v2.197.0', 'auth']);
  });

  it('hands its environment over in a private file, never on the command line (where a process list would show a secret)', async () => {
    const { createArguments, swappedEnvironment } = await load();
    const args = createArguments(original, {name: 'x', envFile: '/private/auth.env'});
    expect(args).toEqual(expect.arrayContaining(['--env-file', '/private/auth.env']));
    expect(args).not.toContain('-e');
    const text = args.join(' ');
    const secrets = [...original.Config.Env, ...swappedEnvironment(original.Config.Env, options)].filter((entry) => /SECRET|KEY/.test(entry.split('=')[0]));
    expect(secrets.length).toBeGreaterThanOrEqual(3);
    for (const entry of secrets) expect(text).not.toContain(entry.slice(entry.indexOf('=') + 1));
  });

  it('keeps every variable of the original and changes exactly the Google client, the proxy and its trust, and the callbacks', async () => {
    const { swappedEnvironment } = await load();
    const swapped = swappedEnvironment(original.Config.Env, options);
    const asMap = (entries: string[]) => new Map(entries.map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]));
    const before = asMap(original.Config.Env);
    const after = asMap(swapped);
    const changed = [...after].filter(([key, value]) => before.get(key) !== value).map(([key]) => key).sort();
    expect(changed).toEqual(['GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID', 'GOTRUE_EXTERNAL_GOOGLE_SECRET', 'GOTRUE_URI_ALLOW_LIST', 'HTTPS_PROXY', 'NOVA3D_FAKE_GOOGLE', 'NO_PROXY', 'SSL_CERT_FILE'].sort());
    for (const key of before.keys()) expect(after.has(key), key).toBe(true);
    expect(after.get('GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID')).toBe(options.clientId);
    expect(after.get('GOTRUE_EXTERNAL_GOOGLE_SECRET')).toBe(options.clientSecret);
    expect(after.get('HTTPS_PROXY')).toBe('http://host.docker.internal:9101');
    expect(after.get('SSL_CERT_FILE')).toBe('/fake-google-ca.pem');
    expect(after.get('NOVA3D_FAKE_GOOGLE')).toBe('1');
    // The stack's own callbacks stay, the application under test's are added, nothing is duplicated.
    expect(after.get('GOTRUE_URI_ALLOW_LIST')!.split(',')).toEqual([
      'http://127.0.0.1:3000/auth/callback',
      'http://localhost:3000/auth/callback',
      'http://127.0.0.1:4173/auth/callback',
      'http://127.0.0.1:4174/auth/callback',
    ]);
  });

  it('recognises itself by its marker, and the original by the lack of it', async () => {
    const { isSwapped, swappedEnvironment } = await load();
    expect(isSwapped(null)).toBe(false);
    expect(isSwapped({Config: {Env: original.Config.Env}})).toBe(false);
    expect(isSwapped({Config: {Env: swappedEnvironment(original.Config.Env, options)}})).toBe(true);
  });

  it('allows the callbacks of the servers the browser tests start: PORT and PORT + 1, 4173 and 4174 by default', async () => {
    const { applicationCallbacks } = await load();
    expect(applicationCallbacks({})).toEqual(['http://127.0.0.1:4173/auth/callback', 'http://127.0.0.1:4174/auth/callback']);
    expect(applicationCallbacks({PORT: '5000'})).toEqual(['http://127.0.0.1:5000/auth/callback', 'http://127.0.0.1:5001/auth/callback']);
    // Checked the way playwright.config.ts checks it: an integer, and PORT + 1 must be a port too. Never a quiet default.
    expect(applicationCallbacks({PORT: '65534'})).toEqual(['http://127.0.0.1:65534/auth/callback', 'http://127.0.0.1:65535/auth/callback']);
    for (const bad of ['nonsense', '0', '-1', '65535', '65536', '1.5', '4173abc', ' ', 'NaN']) expect(() => applicationCallbacks({PORT: bad}), bad).toThrow(/PORT must be an integer from 1 to 65534/);
  });
});

// ---------------------------------------------------------------------------------------------------
// up, down and status, with Docker, the fake process and the network faked. The processes the fake stands for are
// REAL (small Node programs whose command line names fake-google.mjs, or does not), because what the script does
// with a recorded process ID is the point.

const NETWORK = 'supabase_network_nova3d-local';
const NAME = 'supabase_auth_nova3d-local';
const API = 'http://127.0.0.1:54321';

type Box = {inspected: Inspected; running: boolean; health: string; copied: Record<string, string>};

/** Docker as far as the script uses it: containers, one network, and the few verbs it calls. */
class FakeDocker {
  containers = new Map<string, Box>();
  networks = new Set<string>([NETWORK]);
  calls: string[][] = [];
  /** Makes a verb fail, to test what the script does then: `(args) => boolean`. */
  failWhen: ((args: string[]) => boolean) | null = null;

  constructor() {
    this.containers.set(NAME, {inspected: structuredClone(original), running: true, health: 'healthy', copied: {}});
    this.containers.get(NAME)!.inspected.NetworkSettings.Networks = {[NETWORK]: {Aliases: ['auth']}};
    this.containers.get(NAME)!.inspected.HostConfig.NetworkMode = NETWORK;
  }

  get auth() {
    return this.containers.get(NAME);
  }

  run = (args: string[]): string => {
    this.calls.push(args);
    if (this.failWhen?.(args)) throw new Error(`docker ${args[0]} failed (injected)`);
    const [verb, ...rest] = args;
    switch (verb) {
      case 'inspect': {
        const formatAt = rest.indexOf('--format');
        const name = rest[rest.length - 1];
        const box = this.containers.get(name);
        if (!box) throw new Error(`No such object: ${name}`);
        if (formatAt >= 0) return box.running ? box.health : 'exited';
        return JSON.stringify([box.inspected]);
      }
      case 'network':
        if (!this.networks.has(rest[1])) throw new Error(`network ${rest[1]} not found`);
        return '';
      case 'create':
        return this.create(rest);
      case 'cp': {
        const [from, to] = rest;
        const [name, path] = to.split(':');
        const box = this.containers.get(name);
        if (!box) throw new Error(`No such container: ${name}`);
        box.copied[path] = readFileSync(from, 'utf8');
        return '';
      }
      case 'stop':
        this.must(rest[0]).running = false;
        return '';
      case 'start': {
        const box = this.must(rest[0]);
        box.running = true;
        box.health = 'healthy';
        return '';
      }
      case 'rm': {
        const force = rest.includes('-f');
        const name = rest[rest.length - 1];
        if (!this.containers.has(name)) {
          if (force) return '';
          throw new Error(`No such container: ${name}`);
        }
        this.containers.delete(name);
        return '';
      }
      case 'rename': {
        const [from, to] = rest;
        if (this.containers.has(to)) throw new Error(`Conflict. The container name "${to}" is already in use`);
        this.containers.set(to, this.must(from));
        this.containers.delete(from);
        return '';
      }
      default:
        throw new Error(`unexpected docker verb ${verb}`);
    }
  };

  private must(name: string) {
    const box = this.containers.get(name);
    if (!box) throw new Error(`No such container: ${name}`);
    return box;
  }

  private create(args: string[]) {
    const flags = new Map<string, string[]>();
    let i = 0;
    for (; i < args.length && args[i].startsWith('--'); i += 2) flags.set(args[i], [...(flags.get(args[i]) ?? []), args[i + 1]]);
    const [image, ...cmd] = args.slice(i);
    const name = flags.get('--name')![0];
    if (this.containers.has(name)) throw new Error(`Conflict. The container name "${name}" is already in use`);
    const network = flags.get('--network')![0];
    if (!this.networks.has(network)) throw new Error(`network ${network} not found`);
    const labels = Object.fromEntries((flags.get('--label') ?? []).map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]));
    const env = readFileSync(flags.get('--env-file')![0], 'utf8').split('\n').filter(Boolean);
    this.containers.set(name, {
      running: false,
      health: 'starting',
      copied: {},
      inspected: {
        Config: {Image: image, Cmd: cmd, Entrypoint: null, User: flags.get('--user')?.[0] ?? '', WorkingDir: flags.get('--workdir')?.[0] ?? '', Labels: labels, Env: env, Healthcheck: original.Config.Healthcheck},
        HostConfig: {NetworkMode: network, ExtraHosts: flags.get('--add-host') ?? [], RestartPolicy: {Name: flags.get('--restart')?.[0] ?? 'no', MaximumRetryCount: 0}},
        NetworkSettings: {Networks: {[network]: {Aliases: flags.get('--network-alias') ?? []}}},
      },
    });
    return name;
  }
}

/** A real process whose command line does (or does not) name the fake Google program. */
function dummyProcess(options: {named: boolean}) {
  const args = ['-e', 'setInterval(() => {}, 1000)', ...(options.named ? ['fake-google.mjs'] : ['something-else.mjs'])];
  const child = spawn(process.execPath, args, {stdio: 'ignore'});
  return child;
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitDead = async (pid: number) => {
  for (let waited = 0; waited < 5000 && alive(pid); waited += 20) await new Promise((r) => setTimeout(r, 20));
  return !alive(pid);
};

describe('up, down and status (Docker faked, the fake Google a real stand-in process)', () => {
  let work: string;
  let docker: FakeDocker;
  let children: ReturnType<typeof spawn>[];
  let authRedirect: 'fake' | 'google' | 'down';
  let fakeHealthy: boolean;
  let behaviour: {neverReady: boolean; exitEarly: boolean};
  let logs: string[];

  const baseOptions = (extra: Record<string, unknown> = {}) => ({
    root: resolve(import.meta.dirname, '../..'),
    projectId: 'nova3d-local',
    apiBase: API,
    port: 9099,
    stateRoot: join(work, 'state'),
    docker: docker.run,
    env: {},
    sleep: (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 4))),
    log: (message: string) => logs.push(message),
    errorLog: (message: string) => logs.push(message),
    readyTimeoutMs: 400,
    stopWaitMs: 3000,
    healthyTimeoutS: 3,
    // The stand-in for the fake process: a real process whose command line names fake-google.mjs, and the files the real one writes.
    spawnFake: ({stateDir, clientId}: {stateDir: string; clientId: string}) => {
      const child = dummyProcess({named: true});
      children.push(child);
      let exited = false;
      child.on('exit', () => {
        exited = true;
      });
      if (!behaviour.neverReady) {
        const fakeDir = join(stateDir, 'fake');
        mkdirSync(fakeDir, {recursive: true, mode: 0o700});
        writeFileSync(join(fakeDir, 'ca.pem'), '-----BEGIN CERTIFICATE-----\nstand-in\n-----END CERTIFICATE-----\n');
        writeFileSync(
          join(fakeDir, 'ready.json'),
          JSON.stringify({browserBase: 'http://127.0.0.1:9099', ports: {browser: 9099, token: 9100, tunnel: 9101, tls: 9102}, clientId, caPath: join(fakeDir, 'ca.pem'), pid: child.pid}),
          {mode: 0o600},
        );
      }
      if (behaviour.exitEarly) child.kill('SIGKILL');
      return {pid: child.pid!, hasExited: () => exited || behaviour.exitEarly};
    },
    fetchImpl: async (input: unknown) => {
      const url = new URL(String(input));
      if (url.pathname === '/__control/health') {
        if (!fakeHealthy || !children.some((child) => child.pid && alive(child.pid) && child.exitCode === null)) throw new TypeError('connection refused');
        return new Response(JSON.stringify({ok: true, discoveryFetches: 1}), {status: 200});
      }
      if (url.pathname === '/auth/v1/authorize') {
        const env = docker.auth?.inspected.Config.Env ?? [];
        const swapped = env.includes('NOVA3D_FAKE_GOOGLE=1') && docker.auth?.running;
        if (authRedirect === 'down' || !docker.auth?.running) throw new TypeError('connection refused');
        const clientId = env.find((entry) => entry.startsWith('GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID='))?.split('=')[1];
        const location = swapped && authRedirect === 'fake' ? `http://127.0.0.1:9099/o/oauth2/v2/auth?client_id=${clientId}` : 'https://accounts.google.com/o/oauth2/v2/auth?client_id=real';
        return new Response(null, {status: 302, headers: {location}});
      }
      throw new Error(`unexpected request to ${url.pathname}`);
    },
    ...extra,
  });
  const stack = async (extra: Record<string, unknown> = {}) => (await load()).createFakeGoogleStack(baseOptions(extra));
  const stateFiles = () => (existsSync(join(work, 'state')) ? readdirSync(join(work, 'state')).sort() : []);
  const activeRecord = () => JSON.parse(readFileSync(join(work, 'state', 'active.json'), 'utf8')) as {pid: number; stateDir: string; clientId: string};
  const clientIdOf = (box = docker.auth) => box?.inspected.Config.Env.find((entry) => entry.startsWith('GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID='))?.split('=')[1];

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'nova3d-fake-google-stack-test-'));
    docker = new FakeDocker();
    children = [];
    authRedirect = 'fake';
    fakeHealthy = true;
    behaviour = {neverReady: false, exitEarly: false};
    logs = [];
  });
  afterEach(() => {
    for (const child of children) if (child.pid && alive(child.pid)) child.kill('SIGKILL');
    rmSync(work, {recursive: true, force: true});
  });

  it('up swaps the Auth container, copies the CA in, proves Auth reaches the fake, and records what down needs', async () => {
    const s = await stack();
    await s.up();
    const box = docker.auth!;
    expect(box.running).toBe(true);
    expect(box.inspected.Config.Env).toContain('NOVA3D_FAKE_GOOGLE=1');
    expect(box.copied['/fake-google-ca.pem']).toContain('BEGIN CERTIFICATE');
    expect(box.inspected.Config.Labels).toEqual(original.Config.Labels);
    expect(docker.containers.has(`${NAME}-swapped`)).toBe(false);
    expect(stateFiles().map((name) => name.replace(/^run-.+$/, 'run-*'))).toEqual(['active.json', 'original-auth.json', 'run-*']);
    // The saved copy is the ORIGINAL (no marker), never the swapped container.
    expect(JSON.parse(readFileSync(join(work, 'state', 'original-auth.json'), 'utf8')).Config.Env).not.toContain('NOVA3D_FAKE_GOOGLE=1');
    expect(await s.status()).toBe(true);
    // The secret reaches Docker only through an env file, never an argument.
    expect(JSON.stringify(docker.calls)).not.toContain(box.inspected.Config.Env.find((entry) => entry.startsWith('GOTRUE_EXTERNAL_GOOGLE_SECRET='))!.split('=')[1]);
  });

  it('keeps its state directory private: created 0700, and only a directory of ours that only we can use is trusted', async () => {
    const s = await stack();
    await s.up();
    expect(lstatSync(join(work, 'state')).mode & 0o777).toBe(0o700);
    for (const file of ['active.json', 'original-auth.json']) expect(lstatSync(join(work, 'state', file)).mode & 0o777, file).toBe(0o600);
  });

  it('a second up while Auth is already swapped ends swapped again, with a new client and the old fake stopped (the re-entrant path)', async () => {
    const s = await stack();
    await s.up();
    const first = {client: clientIdOf(), pid: activeRecord().pid};
    await s.up();
    expect(docker.auth!.inspected.Config.Env).toContain('NOVA3D_FAKE_GOOGLE=1');
    expect(clientIdOf()).not.toBe(first.client);
    expect(await waitDead(first.pid)).toBe(true);
    expect(alive(activeRecord().pid)).toBe(true);
    expect(JSON.parse(readFileSync(join(work, 'state', 'original-auth.json'), 'utf8')).Config.Env).not.toContain('NOVA3D_FAKE_GOOGLE=1');
    expect(await s.status()).toBe(true);
    // And a third, to be sure it is not a one-off.
    await s.up();
    expect(await s.status()).toBe(true);
  });

  it('down puts the original back, stops the fake, and leaves no state behind', async () => {
    const s = await stack();
    await s.up();
    const { pid } = activeRecord();
    await s.down();
    expect(docker.auth!.inspected.Config.Env).not.toContain('NOVA3D_FAKE_GOOGLE=1');
    expect(docker.auth!.inspected.Config.Env).toEqual(original.Config.Env);
    expect(docker.auth!.running).toBe(true);
    expect(await waitDead(pid)).toBe(true);
    expect(stateFiles()).toEqual([]);
    expect(await s.status()).toBe(false);
    // Down with nothing to undo is not an error.
    await s.down();
  });

  it('up stops a fake that outlived a restarted stack (Auth no longer swapped), instead of failing to bind its ports', async () => {
    const s = await stack();
    await s.up();
    const { pid } = activeRecord();
    // `supabase stop` and `supabase start`: a plain Auth container again; the fake and its record are still there.
    docker.containers.clear();
    docker.containers.set(NAME, {inspected: structuredClone(original), running: true, health: 'healthy', copied: {}});
    docker.auth!.inspected.HostConfig.NetworkMode = NETWORK;
    docker.auth!.inspected.NetworkSettings.Networks = {[NETWORK]: {Aliases: ['auth']}};
    expect(alive(pid)).toBe(true);
    await s.up();
    expect(await waitDead(pid)).toBe(true);
    expect(await s.status()).toBe(true);
    expect(activeRecord().pid).not.toBe(pid);
  });

  it('does not signal a recorded process ID that is no longer a fake-google.mjs (the ID was recycled), and drops the stale record', async () => {
    const innocent = dummyProcess({named: false});
    children.push(innocent);
    mkdirSync(join(work, 'state'), {mode: 0o700});
    const run = join(work, 'state', 'run-old');
    mkdirSync(run, {mode: 0o700});
    writeFileSync(join(work, 'state', 'active.json'), JSON.stringify({pid: innocent.pid, stateDir: run, browserBase: 'http://127.0.0.1:9099', clientId: 'x'}), {mode: 0o600});
    const s = await stack();
    await s.up();
    expect(alive(innocent.pid!)).toBe(true);
    expect(innocent.exitCode).toBeNull();
    expect(innocent.signalCode).toBeNull();
    expect(existsSync(run)).toBe(false);
    expect(activeRecord().pid).not.toBe(innocent.pid);
    expect(logs.join('\n')).toMatch(/not a fake Google any more/);
  });

  it('ignores an active record that is not ours to trust: readable by others, pointing outside the state directory, or not a record at all', async () => {
    const decoy = dummyProcess({named: true});
    children.push(decoy);
    mkdirSync(join(work, 'state'), {mode: 0o700});
    const outside = mkdtempSync(join(work, 'outside-'));
    // Group-readable: not trusted, so the process it names is left alone.
    writeFileSync(join(work, 'state', 'active.json'), JSON.stringify({pid: decoy.pid, stateDir: join(work, 'state', 'run-x')}), {mode: 0o644});
    const s = await stack();
    await s.up();
    expect(alive(decoy.pid!)).toBe(true);
    await s.down();
    // Trusted file, but its directory is outside the state directory: the process is stopped, the directory is NOT removed.
    mkdirSync(join(work, 'state'), {mode: 0o700, recursive: true});
    writeFileSync(join(work, 'state', 'active.json'), JSON.stringify({pid: decoy.pid, stateDir: outside}), {mode: 0o600});
    await s.up();
    expect(existsSync(outside)).toBe(true);
    expect(await waitDead(decoy.pid!)).toBe(true);
    // Not JSON.
    await s.down();
    mkdirSync(join(work, 'state'), {mode: 0o700, recursive: true});
    writeFileSync(join(work, 'state', 'active.json'), 'not json', {mode: 0o600});
    await s.up();
    expect(await s.status()).toBe(true);
  });

  it('refuses a state directory that is not private, not a real directory, or not ours', async () => {
    mkdirSync(join(work, 'state'), {mode: 0o755});
    chmodSync(join(work, 'state'), 0o755);
    let s = await stack();
    await expect(s.up()).rejects.toThrow(/accessible to other users/);
    await expect(s.down()).rejects.toThrow(/accessible to other users/);
    expect(docker.calls).toEqual([]);
    rmSync(join(work, 'state'), {recursive: true});

    mkdirSync(join(work, 'elsewhere'));
    symlinkSync(join(work, 'elsewhere'), join(work, 'state'));
    s = await stack();
    await expect(s.up()).rejects.toThrow(/not a real directory/);
    rmSync(join(work, 'state'));

    mkdirSync(join(work, 'state'), {mode: 0o700});
    s = await stack({uid: (process.getuid?.() ?? 1000) + 1});
    await expect(s.up()).rejects.toThrow(/owned by another user/);
    expect(docker.calls).toEqual([]);
  });

  it('if the fake does not write ready.json in time, stops it and removes its directory before it throws, and swaps nothing', async () => {
    behaviour.neverReady = true;
    const s = await stack();
    await expect(s.up()).rejects.toThrow(/did not start/);
    expect(children).toHaveLength(1);
    expect(await waitDead(children[0].pid!)).toBe(true);
    expect(stateFiles()).toEqual([]);
    expect(docker.auth!.inspected.Config.Env).toEqual(original.Config.Env);
    expect(docker.calls.some((call) => call[0] === 'create' || call[0] === 'stop')).toBe(false);
  });

  it('if the fake dies while starting, says so with its log, stops nothing else and swaps nothing', async () => {
    behaviour.exitEarly = true;
    behaviour.neverReady = true;
    const s = await stack({
      spawnFake: ({stateDir}: {stateDir: string}) => {
        writeFileSync(join(stateDir, 'fake.log'), 'The fake Google could not start: openssl is missing\n');
        const child = dummyProcess({named: true});
        children.push(child);
        child.kill('SIGKILL');
        return {pid: child.pid!, hasExited: () => true};
      },
    });
    await expect(s.up()).rejects.toThrow(/openssl is missing/);
    expect(stateFiles()).toEqual([]);
    expect(docker.calls.some((call) => call[0] === 'create')).toBe(false);
  });

  it('a swap that does not take (Auth still goes to the real Google) puts the original back, removes the half-made container, and stops the fake', async () => {
    authRedirect = 'google';
    const s = await stack();
    await expect(s.up()).rejects.toThrow(/did not redirect to the fake Google/);
    expect(docker.auth!.inspected.Config.Env).toEqual(original.Config.Env);
    expect(docker.auth!.running).toBe(true);
    expect(docker.containers.has(`${NAME}-swapped`)).toBe(false);
    expect(await waitDead(children[0].pid!)).toBe(true);
    expect(stateFiles()).toEqual([]);
  });

  it('a swap that fails half way (the new container cannot start) also removes the container it made, and restores', async () => {
    docker.failWhen = (args) => args[0] === 'rename';
    const s = await stack();
    await expect(s.up()).rejects.toThrow(/rename failed/);
    // The original was stopped and removed before the rename; the failure path rebuilds it and removes the other.
    expect(docker.containers.has(`${NAME}-swapped`)).toBe(false);
    docker.failWhen = null;
    expect(docker.auth).toBeDefined();
    expect(docker.auth!.inspected.Config.Env).toEqual(original.Config.Env);
    expect(docker.auth!.running).toBe(true);
    expect(await waitDead(children[0].pid!)).toBe(true);
    expect(stateFiles()).toEqual([]);
  });

  it('a swap that fails before the original is touched removes the half-made container and leaves the original container exactly as it was (not rebuilt)', async () => {
    const before = docker.auth;
    docker.failWhen = (args) => args[0] === 'cp';
    const s = await stack();
    await expect(s.up()).rejects.toThrow(/cp failed/);
    expect(docker.containers.has(`${NAME}-swapped`)).toBe(false);
    expect(docker.auth).toBe(before);
    expect(docker.auth!.running).toBe(true);
    expect(docker.calls.some((call) => call[0] === 'create' && call[2] === NAME)).toBe(false);
    expect(await waitDead(children[0].pid!)).toBe(true);
    expect(stateFiles()).toEqual([]);
  });

  it('a swap that fails after only stopping the original starts it again, without rebuilding it, and removes the half-made container', async () => {
    const before = docker.auth;
    docker.failWhen = (args) => args[0] === 'rm' && !args.includes('-f') && args[1] === NAME;
    const s = await stack();
    await expect(s.up()).rejects.toThrow(/rm failed/);
    docker.failWhen = null;
    expect(docker.containers.has(`${NAME}-swapped`)).toBe(false);
    expect(docker.auth).toBe(before);
    expect(docker.auth!.running).toBe(true);
    expect(stateFiles()).toEqual([]);
  });

  it('keeps the saved original while the Auth container that is there is not healthy, and deletes it once it is', async () => {
    const s = await stack();
    await s.up();
    // The stack's own Auth container is back but unhealthy (and not swapped).
    docker.containers.set(NAME, {inspected: structuredClone(original), running: true, health: 'unhealthy', copied: {}});
    docker.auth!.inspected.HostConfig.NetworkMode = NETWORK;
    docker.auth!.inspected.NetworkSettings.Networks = {[NETWORK]: {Aliases: ['auth']}};
    await s.down();
    expect(existsSync(join(work, 'state', 'original-auth.json'))).toBe(true);
    docker.auth!.health = 'healthy';
    await s.down();
    expect(stateFiles()).toEqual([]);
  });

  it('down with no Auth container but a saved original (an interrupted swap) rebuilds it, and deletes the saved copy only once it is healthy', async () => {
    const s = await stack();
    await s.up();
    // The crash: the container is gone between `rm` and `rename`; the fake and the records remain.
    docker.containers.delete(NAME);
    await s.down();
    expect(docker.auth).toBeDefined();
    expect(docker.auth!.inspected.Config.Env).toEqual(original.Config.Env);
    expect(docker.auth!.running).toBe(true);
    expect(stateFiles()).toEqual([]);
  });

  it('keeps the saved original when the rebuild does not produce a healthy container', async () => {
    const s = await stack();
    await s.up();
    docker.containers.delete(NAME);
    docker.failWhen = (args) => args[0] === 'start';
    await expect(s.down()).rejects.toThrow(/start failed/);
    expect(existsSync(join(work, 'state', 'original-auth.json'))).toBe(true);
    // And the next down, with docker working again, finishes the job.
    docker.failWhen = null;
    await s.down();
    expect(docker.auth!.running).toBe(true);
    expect(stateFiles()).toEqual([]);
  });

  it('down with no Auth container because the whole stack is stopped has nothing to repair: it creates nothing and drops the saved copy', async () => {
    const s = await stack();
    await s.up();
    docker.containers.clear();
    docker.networks.clear();
    await s.down();
    expect(docker.containers.size).toBe(0);
    // The only container `create` was up's own swapped copy; down made none.
    expect(docker.calls.filter((call) => call[0] === 'create')).toHaveLength(1);
    expect(stateFiles()).toEqual([]);
  });

  it('refuses a PORT that playwright.config.ts would refuse, before it touches anything', async () => {
    for (const PORT of ['nope', '0', '65535', '70000']) {
      const s = await stack({env: {PORT}});
      await expect(s.up(), PORT).rejects.toThrow(/PORT must be an integer from 1 to 65534/);
    }
    expect(docker.calls).toEqual([]);
    expect(children).toHaveLength(0);
  });

  it('allows the callbacks of the servers a different PORT starts', async () => {
    const s = await stack({env: {PORT: '5000'}});
    await s.up();
    const allow = docker.auth!.inspected.Config.Env.find((entry) => entry.startsWith('GOTRUE_URI_ALLOW_LIST='))!;
    expect(allow).toContain('http://127.0.0.1:5000/auth/callback');
    expect(allow).toContain('http://127.0.0.1:5001/auth/callback');
    expect(allow).not.toContain('4173');
  });

  it('status is true only when the fake answers AND Auth is swapped AND Auth really sends Google sign-in to the fake', async () => {
    const s = await stack();
    expect(await s.status()).toBe(false);
    await s.up();
    expect(await s.status()).toBe(true);
    authRedirect = 'google';
    expect(await s.status()).toBe(false);
    authRedirect = 'fake';
    fakeHealthy = false;
    expect(await s.status()).toBe(false);
    fakeHealthy = true;
    docker.auth!.inspected.Config.Env = original.Config.Env;
    expect(await s.status()).toBe(false);
  });
});
