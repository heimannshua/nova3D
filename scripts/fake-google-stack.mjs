#!/usr/bin/env node
// Usage: node scripts/fake-google-stack.mjs up | down | status
//
// Test support for Story 1.4b, local stack only. `up` starts the fake Google (tests/support/fake-google.mjs) and
// swaps ONLY the Supabase CLI stack's Auth container for a copy of itself (same image, command, labels, network,
// aliases and environment) with these changes, so that Auth's Google sign-in reaches the fake and nothing else:
//
//   GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID / _SECRET   random values made here; the stack has none of its own
//   HTTPS_PROXY                                   a tunnel to the fake that serves accounts.google.com and
//                                                 refuses every other host
//   NO_PROXY                                      OVERWRITTEN (not extended) with localhost, 127.0.0.1 and
//                                                 host.docker.internal
//   SSL_CERT_FILE                                 the fake's throwaway CA, copied into the container. Go reads
//                                                 it INSTEAD of the system roots, so while the swap is in place
//                                                 Auth trusts that CA alone and no real HTTPS server
//   GOTRUE_URI_ALLOW_LIST                         the stack's own entries plus the application origins the
//                                                 browser tests use (http://127.0.0.1:4173 and :4174, or PORT and
//                                                 PORT + 1 when PORT is set), so Auth returns the browser to the
//                                                 application under test instead of the stack's site URL
//
// Then it proves the swap works: Auth must answer an authorize request with a redirect to the fake's chooser,
// having fetched the fake's discovery document. If that cannot be shown, the original container is put back and
// the script fails; a swap that did not work is never reported as active.
//
// `down` restores the original container and stops the fake. `supabase stop` removes the swapped container too
// (it keeps the stack's labels), and `supabase start` makes a normal one again. The restore is a rebuild from
// `docker inspect` of the original (image, command, user, labels, network and aliases, hosts, restart policy, a
// CMD-SHELL health check, environment): it does not carry bind mounts, port bindings, resource limits or other
// health check kinds, and the Supabase CLI's Auth container has none of those today. If it ever misbehaves, the
// documented recovery is `supabase stop` then `supabase start`.
//
// It never touches a hosted project: it only talks to local Docker containers and refuses to run unless the
// stack's Auth container exists on this machine. Its state (a pointer to the running fake, the saved original
// container and the fake's run directory) lives in a directory that is created 0700 and trusted only while it is
// a real directory, owned by this user, with no group or other access. A recorded process ID is signalled only
// if /proc says that process is still a fake-google.mjs.
//
// The pure pieces are exported and the effects (docker, the fake process, the network, the clock) are injected, so
// the whole `up` / `down` / `status` logic runs in tests/unit/fake-google-stack.test.ts without Docker.
import {execFileSync, spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const defaultRoot = resolve(import.meta.dirname, '..');
const marker = 'NOVA3D_FAKE_GOOGLE';
const fakeProgram = 'fake-google.mjs';

export const isSwapped = (container) => (container?.Config?.Env ?? []).some((entry) => entry === `${marker}=1`);

/** `docker create` arguments that recreate a container from its inspection, with the given environment. */
export function createArguments(container, {name, envFile}) {
  const config_ = container.Config;
  const host = container.HostConfig;
  const network = host.NetworkMode;
  const args = ['create', '--name', name, '--network', network];
  for (const alias of container.NetworkSettings.Networks?.[network]?.Aliases ?? []) args.push('--network-alias', alias);
  for (const [key, value] of Object.entries(config_.Labels ?? {})) args.push('--label', `${key}=${value}`);
  for (const entry of host.ExtraHosts ?? []) args.push('--add-host', entry);
  const policy = host.RestartPolicy;
  if (policy?.Name && policy.Name !== 'no') args.push('--restart', policy.Name === 'on-failure' ? `on-failure:${policy.MaximumRetryCount}` : policy.Name);
  if (config_.User) args.push('--user', config_.User);
  if (config_.WorkingDir) args.push('--workdir', config_.WorkingDir);
  const health = config_.Healthcheck;
  if (health?.Test?.[0] === 'CMD-SHELL') {
    args.push('--health-cmd', health.Test[1]);
    if (health.Interval) args.push('--health-interval', `${health.Interval / 1e9}s`);
    if (health.Timeout) args.push('--health-timeout', `${health.Timeout / 1e9}s`);
    if (health.Retries) args.push('--health-retries', String(health.Retries));
  }
  args.push('--env-file', envFile);
  if (config_.Entrypoint?.length) args.push('--entrypoint', config_.Entrypoint[0]);
  args.push(config_.Image, ...(config_.Entrypoint?.length ? config_.Entrypoint.slice(1) : []), ...(config_.Cmd ?? []));
  return args;
}

/**
 * The application origins Auth is told it may return the browser to, beyond the stack's own: the two servers the
 * browser tests start (PORT and PORT + 1, 4173 and 4174 by default), as 127.0.0.1 addresses. PORT is checked the
 * way playwright.config.ts checks it (an integer, and PORT + 1 must be a port too) and anything else is an error,
 * not a quiet fallback to the default.
 */
export function applicationCallbacks(environment = process.env) {
  const raw = environment.PORT;
  const base = raw === undefined || raw === '' ? 4173 : Number(raw);
  if (!Number.isInteger(base) || base < 1 || base > 65534) {
    throw new Error(`PORT must be an integer from 1 to 65534 (received "${raw}").`);
  }
  return [`http://127.0.0.1:${base}/auth/callback`, `http://127.0.0.1:${base + 1}/auth/callback`];
}

/**
 * The swapped container's environment: the original, with the changes this script makes (and a marker to
 * recognise it by). Returns KEY=value entries.
 */
export function swappedEnvironment(originalEnv, {clientId, clientSecret, tunnelPort, callbacks}) {
  const env = new Map(originalEnv.map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]));
  const allow = [...new Set([...(env.get('GOTRUE_URI_ALLOW_LIST') ?? '').split(',').filter(Boolean), ...callbacks])];
  env.set('GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID', clientId);
  env.set('GOTRUE_EXTERNAL_GOOGLE_SECRET', clientSecret);
  env.set('GOTRUE_URI_ALLOW_LIST', allow.join(','));
  env.set('HTTPS_PROXY', `http://host.docker.internal:${tunnelPort}`);
  env.set('NO_PROXY', 'localhost,127.0.0.1,host.docker.internal');
  env.set('SSL_CERT_FILE', '/fake-google-ca.pem');
  env.set(marker, '1');
  return [...env].map(([key, value]) => `${key}=${value}`);
}

// Defaults for the effects --------------------------------------------------------------------------------

const defaultDocker = (args) => execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const defaultSleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const defaultCommandLine = (pid) => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
  } catch {
    return null;
  }
};
const defaultIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};
const defaultSpawnFake = ({root, stateDir, clientId, port, logFile}) => {
  const logFd = openSync(logFile, 'a');
  const child = spawn(process.execPath, [join(root, 'tests/support', fakeProgram), '--state-dir', join(stateDir, 'fake'), '--client-id', clientId, '--port', String(port)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  return {pid: child.pid, hasExited: () => exited};
};

function readProject(root) {
  const config = readFileSync(join(root, 'supabase/config.toml'), 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!projectId) throw new Error('supabase/config.toml has no project_id.');
  const lines = config.split('\n');
  const start = lines.findIndex((line) => line.trim() === '[api]');
  let apiPort = '54321';
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (/^\s*\[/.test(line)) break;
      const match = /^\s*port\s*=\s*(\d+)\s*$/.exec(line);
      if (match) apiPort = match[1];
    }
  }
  return {projectId, apiBase: `http://127.0.0.1:${apiPort}`};
}

/**
 * The whole of `up`, `down` and `status`, with its effects injected: `docker(args)` (returns stdout, throws on a
 * failure), `fetchImpl`, `spawnFake({root, stateDir, clientId, port, logFile})` (returns `{pid, hasExited()}`),
 * `commandLine(pid)` (what /proc says the process is, or null), `isAlive(pid)`, `signal(pid, name)`, `sleep(ms)`.
 */
export function createFakeGoogleStack(options = {}) {
  const root = options.root ?? defaultRoot;
  const port = options.port ?? 9099;
  const uid = 'uid' in options ? options.uid : process.getuid?.();
  const stateRoot = options.stateRoot ?? join(tmpdir(), `nova3d-fake-google-${uid ?? 'user'}`);
  const docker = options.docker ?? defaultDocker;
  const fetchImpl = options.fetchImpl ?? fetch;
  const spawnFake = options.spawnFake ?? defaultSpawnFake;
  const commandLine = options.commandLine ?? defaultCommandLine;
  const isAlive = options.isAlive ?? defaultIsAlive;
  const signal = options.signal ?? ((pid, name) => process.kill(pid, name));
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((message) => console.log(message));
  const errorLog = options.errorLog ?? ((message) => console.error(message));
  const readyTimeoutMs = options.readyTimeoutMs ?? 20_000;
  const healthyTimeoutS = options.healthyTimeoutS ?? 90;
  const stopWaitMs = options.stopWaitMs ?? 5000;
  const environment = options.env ?? process.env;
  const project = options.projectId && options.apiBase ? {projectId: options.projectId, apiBase: options.apiBase} : readProject(root);
  const containerName = `supabase_auth_${project.projectId}`;
  const apiBase = project.apiBase;
  const swappedName = `${containerName}-swapped`;
  const savedPath = join(stateRoot, 'original-auth.json');
  const activePath = join(stateRoot, 'active.json');

  const dockerQuiet = (args) => {
    try {
      return docker(args);
    } catch {
      return null;
    }
  };
  /** Whether a docker command succeeds (its output may be empty). */
  const succeeds = (args) => dockerQuiet(args) !== null;
  const inspect = (name) => {
    const out = dockerQuiet(['inspect', name]);
    return out ? JSON.parse(out)[0] : null;
  };

  // The state directory ---------------------------------------------------------------------------------

  /** Creates the state directory 0700 if it is missing; refuses one that is not a real directory of ours that only we can use. */
  function ensureStateRoot() {
    mkdirSync(stateRoot, {recursive: true, mode: 0o700});
    const info = lstatSync(stateRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${stateRoot} is not a real directory; remove it and run this again.`);
    if (uid !== undefined && info.uid !== uid) throw new Error(`${stateRoot} is owned by another user; refusing to use it.`);
    if ((info.mode & 0o077) !== 0) throw new Error(`${stateRoot} is accessible to other users (mode ${(info.mode & 0o777).toString(8)}); remove it or run chmod 700 on it.`);
  }

  /** A file of ours in the state directory, or null: it must be a regular file we own that only we can use. */
  function readTrusted(path) {
    let info;
    try {
      info = lstatSync(path);
    } catch {
      return null;
    }
    if (!info.isFile() || (uid !== undefined && info.uid !== uid) || (info.mode & 0o077) !== 0) return null;
    return readFileSync(path, 'utf8');
  }

  const inside = (path) => typeof path === 'string' && resolve(path).startsWith(`${stateRoot}${sep}`);

  /** The pointer to the running fake, with every field checked: a pid is a number, a directory is one of ours. */
  function readActive() {
    const text = readTrusted(activePath);
    if (!text) return null;
    try {
      const record = JSON.parse(text);
      return {
        pid: Number.isInteger(record?.pid) && record.pid > 1 ? record.pid : undefined,
        stateDir: inside(record?.stateDir) ? record.stateDir : undefined,
        browserBase: typeof record?.browserBase === 'string' ? record.browserBase : undefined,
        clientId: typeof record?.clientId === 'string' ? record.clientId : undefined,
      };
    } catch {
      return null;
    }
  }

  /** Writes an env file (mode 0600) from a list of KEY=value entries. */
  function writeEnvFile(directory, entries) {
    const file = join(directory, 'auth.env');
    writeFileSync(file, `${entries.join('\n')}\n`, {mode: 0o600});
    return file;
  }

  // The fake process --------------------------------------------------------------------------------------

  /**
   * Stops the fake a record names, but only if that process ID is still a fake-google.mjs: a recycled ID is
   * somebody else's process and is left alone. Waits for it to end, so its ports are free when this returns.
   */
  async function stopRecordedFake(pid) {
    if (!Number.isInteger(pid)) return;
    const mine = () => commandLine(pid)?.includes(fakeProgram) === true;
    if (!mine()) {
      if (isAlive(pid)) log(`Process ${pid} is not a fake Google any more; leaving it alone and dropping the stale record.`);
      return;
    }
    try {
      signal(pid, 'SIGTERM');
    } catch {
      return;
    }
    for (let waited = 0; waited < stopWaitMs && isAlive(pid) && mine(); waited += 100) await sleep(100);
    if (isAlive(pid) && mine()) {
      try {
        signal(pid, 'SIGKILL');
      } catch {
        // Gone in between.
      }
      await sleep(100);
    }
  }

  // The Auth container ------------------------------------------------------------------------------------

  async function waitHealthy(name) {
    for (let waited = 0; waited < healthyTimeoutS * 1000; waited += 1000) {
      const state = dockerQuiet(['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', name]);
      if (state === 'healthy' || state === 'running') return;
      await sleep(1000);
    }
    throw new Error(`${name} did not become healthy within ${healthyTimeoutS} s.`);
  }

  /** Recreates the Auth container from the saved copy of the original and waits until it is healthy. */
  async function restoreOriginal() {
    const text = readTrusted(savedPath);
    if (!text) throw new Error(`The original ${containerName} configuration was not saved (${savedPath} is missing or not ours). Run \`supabase stop\` and \`supabase start\` to get a normal stack back.`);
    const original = JSON.parse(text);
    const directory = mkdtempSync(join(stateRoot, 'restore-'));
    try {
      const envFile = writeEnvFile(directory, original.Config.Env);
      dockerQuiet(['rm', '-f', containerName]);
      dockerQuiet(['rm', '-f', swappedName]);
      try {
        docker(createArguments(original, {name: containerName, envFile}));
        docker(['start', containerName]);
      } catch (error) {
        // A container that was made and not started would look like a stack's own stopped container to the next
        // `down`, which would leave it; remove it so the saved original is tried again.
        dockerQuiet(['rm', '-f', containerName]);
        throw error;
      }
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
    await waitHealthy(containerName);
  }

  async function controlHealth(base) {
    try {
      const response = await fetchImpl(`${base}/__control/health`, {signal: AbortSignal.timeout(2000)});
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  /** Whether Auth answers an authorize request with a redirect to this fake's chooser (and for this client). */
  async function authRedirectsToFake(browserBase, clientId, redirectTo) {
    try {
      const url = new URL(`${apiBase}/auth/v1/authorize`);
      url.searchParams.set('provider', 'google');
      url.searchParams.set('redirect_to', redirectTo);
      url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
      url.searchParams.set('code_challenge_method', 's256');
      const response = await fetchImpl(url, {redirect: 'manual', signal: AbortSignal.timeout(5000)});
      const location = response.headers.get('location') ?? '';
      if (response.status !== 302 || !location.startsWith(`${browserBase}/o/oauth2/v2/auth`)) return null;
      if (clientId && new URL(location).searchParams.get('client_id') !== clientId) return null;
      return location;
    } catch {
      return null;
    }
  }

  // up ------------------------------------------------------------------------------------------------------

  async function up() {
    ensureStateRoot();
    const callbacks = applicationCallbacks(environment);
    // Whatever an earlier run left behind goes first: a fake that outlived a restarted stack still holds the ports,
    // and an Auth container that is already swapped is put back before it is swapped again.
    await down({quiet: true});
    ensureStateRoot();

    const current = inspect(containerName);
    if (!current) throw new Error(`The container ${containerName} is not running. Start the local stack first (\`supabase start\`).`);
    if (isSwapped(current)) throw new Error(`${containerName} is still swapped after putting the original back. Run \`supabase stop\` and \`supabase start\`.`);
    writeFileSync(savedPath, JSON.stringify(current), {mode: 0o600});

    const stateDir = mkdtempSync(join(stateRoot, 'run-'));
    const clientId = `nova3d-fake-${randomBytes(6).toString('hex')}.apps.googleusercontent.com`;
    const clientSecret = randomBytes(24).toString('base64url');
    const logFile = join(stateDir, 'fake.log');
    const fake = spawnFake({root, stateDir, clientId, port, logFile});
    let pointer = {pid: fake.pid, stateDir};

    // The fake must be up before anything else is touched; if it is not, it is stopped and its directory removed.
    const readyPath = join(stateDir, 'fake', 'ready.json');
    try {
      for (let waited = 0; !existsSync(readyPath); waited += 100) {
        if (fake.hasExited() || waited > readyTimeoutMs) {
          const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').slice(-8).join('\n') : '';
          throw new Error(`The fake Google did not start:\n${tail}`);
        }
        await sleep(100);
      }
    } catch (error) {
      await stopRecordedFake(fake.pid);
      rmSync(stateDir, {recursive: true, force: true});
      rmSync(savedPath, {force: true});
      throw error;
    }
    const ready = JSON.parse(readFileSync(readyPath, 'utf8'));
    pointer = {pid: ready.pid ?? fake.pid, stateDir, browserBase: ready.browserBase, clientId, containerName, originalPath: savedPath};

    const failed = async (error) => {
      errorLog(`The swap failed (${error instanceof Error ? error.message : error}); putting the original container back.`);
      await stopRecordedFake(pointer.pid);
      dockerQuiet(['rm', '-f', swappedName]);
      try {
        const now = inspect(containerName);
        if (now && !isSwapped(now)) {
          // The original was never replaced (the swap failed before that, or after only stopping it): start it if it
          // is stopped (a no-op if it runs) instead of rebuilding a container that is intact.
          dockerQuiet(['start', containerName]);
          await waitHealthy(containerName);
        } else {
          await restoreOriginal();
        }
        rmSync(savedPath, {force: true});
      } catch (restoreError) {
        errorLog(restoreError instanceof Error ? restoreError.message : restoreError);
      }
      rmSync(stateDir, {recursive: true, force: true});
    };

    try {
      const swappedEnv = swappedEnvironment(current.Config.Env, {clientId, clientSecret, tunnelPort: ready.ports.tunnel, callbacks});
      const envDirectory = mkdtempSync(join(stateRoot, 'env-'));
      try {
        const envFile = writeEnvFile(envDirectory, swappedEnv);
        dockerQuiet(['rm', '-f', swappedName]);
        docker(createArguments(current, {name: swappedName, envFile}));
      } finally {
        rmSync(envDirectory, {recursive: true, force: true});
      }
      docker(['cp', ready.caPath, `${swappedName}:/fake-google-ca.pem`]);
      docker(['stop', containerName]);
      docker(['rm', containerName]);
      docker(['rename', swappedName, containerName]);
      docker(['start', containerName]);
      await waitHealthy(containerName);

      // Prove it: Auth answers an authorize request with a redirect to the fake's chooser, after fetching the
      // fake's discovery document over the tunnel. The gateway behind it may need a moment to find the new container.
      let proven = null;
      for (let attempt = 0; attempt < 40 && !proven; attempt += 1) {
        proven = await authRedirectsToFake(ready.browserBase, clientId, callbacks[0]);
        if (!proven) await sleep(500);
      }
      if (!proven) throw new Error(`Auth did not redirect to the fake Google at ${ready.browserBase}`);
      const health = await controlHealth(ready.browserBase);
      if (!health || health.discoveryFetches < 1) throw new Error('Auth redirected, but never fetched the fake discovery document through the tunnel');
    } catch (error) {
      await failed(error);
      throw error;
    }

    ensureStateRoot();
    writeFileSync(activePath, JSON.stringify(pointer), {mode: 0o600});
    log(`Fake Google is active: chooser ${ready.browserBase}, Auth container ${containerName} swapped (restore with \`node scripts/fake-google-stack.mjs down\` or \`supabase stop\`).`);
  }

  // down ----------------------------------------------------------------------------------------------------

  async function down({quiet = false} = {}) {
    ensureStateRoot();
    const active = readActive();
    if (active) await stopRecordedFake(active.pid);

    const current = inspect(containerName);
    if (current && isSwapped(current)) {
      await restoreOriginal();
    } else if (!current && readTrusted(savedPath)) {
      // The Auth container is gone but its saved original is not: an interrupted swap, or a stopped stack. Put the
      // original back if the stack's network is still there; if the whole stack is gone there is nothing to repair.
      const original = JSON.parse(readTrusted(savedPath));
      if (succeeds(['network', 'inspect', original.HostConfig.NetworkMode])) await restoreOriginal();
      else log(`The stack's network is gone, so the stack is stopped; start it with \`supabase start\`.`);
    }

    if (active?.stateDir) rmSync(active.stateDir, {recursive: true, force: true});
    rmSync(activePath, {force: true});

    // The saved copy of the original container is deleted only once a healthy original is running (or once the
    // whole stack is gone and there is nothing left to repair); otherwise it stays, for the next `down`.
    const saved = readTrusted(savedPath);
    if (saved) {
      const now = inspect(containerName);
      const state = now ? dockerQuiet(['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', containerName]) : null;
      const healthyOriginal = now && !isSwapped(now) && (state === 'healthy' || state === 'running');
      const stackGone = !now && !succeeds(['network', 'inspect', JSON.parse(saved).HostConfig.NetworkMode]);
      if (healthyOriginal || stackGone) rmSync(savedPath, {force: true});
    }
    try {
      rmdirSync(stateRoot);
    } catch {
      // Not empty (another run's files) or already gone.
    }
    if (!quiet) log('Fake Google stopped; the original Auth container is back.');
  }

  // status --------------------------------------------------------------------------------------------------

  /** Whether the fake runs AND Auth is swapped AND Auth really answers with the fake's chooser. */
  async function status() {
    ensureStateRoot();
    const container = inspect(containerName);
    const active = readActive();
    const browserBase = active?.browserBase ?? `http://127.0.0.1:${port}`;
    const health = await controlHealth(browserBase);
    const swapped = isSwapped(container);
    const redirects = swapped && Boolean(health) ? Boolean(await authRedirectsToFake(browserBase, active?.clientId, applicationCallbacks(environment)[0])) : false;
    log(JSON.stringify({container: containerName, running: Boolean(container), swapped, fake: Boolean(health), authUsesFake: redirects}));
    return swapped && Boolean(health) && redirects;
  }

  return {up, down, status, containerName, stateRoot};
}

// Run as a program.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  try {
    const stack = createFakeGoogleStack();
    if (command === 'up') await stack.up();
    else if (command === 'down') await stack.down();
    else if (command === 'status') process.exit((await stack.status()) ? 0 : 1);
    else {
      console.error('Usage: node scripts/fake-google-stack.mjs up | down | status');
      process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
