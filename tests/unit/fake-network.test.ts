import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

// The fake network (tests/support/fake-network.mjs) can make the accounts API fail for one user. It must be
// impossible to load by accident, and it must do exactly what the browser tests rely on and nothing else.
const preload = resolve(import.meta.dirname, '../support/fake-network.mjs');
const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER = '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99';
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nova3d-fake-network-test-'));
});
afterEach(() => {
  rmSync(directory, {recursive: true, force: true});
});

/** Runs a script in a fresh Node with the preload and the given environment; the script prints one JSON line. */
function run(script: string, env: Record<string, string | undefined>) {
  const child = spawnSync(process.execPath, ['--import', `file://${preload}`, '--input-type=module', '-e', script], {
    env: {PATH: process.env.PATH, ...env} as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 20_000,
  });
  return {status: child.status, stdout: child.stdout.trim(), stderr: child.stderr};
}

const allowed = () => ({NOVA3D_FAKE_NETWORK: 'playwright', NOVA3D_FAKE_NETWORK_DIR: directory});

describe('loading', () => {
  it('refuses to load without the flag the Playwright config sets, so a stray NODE_OPTIONS cannot make a real server flaky', () => {
    const result = run('console.log("loaded")', {NOVA3D_FAKE_NETWORK_DIR: directory});
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('loaded');
    expect(result.stderr).toContain('NOVA3D_FAKE_NETWORK=playwright');
  });

  it.each(['', 'true', '1', 'yes', 'Playwright'])('refuses to load for the flag value %j: only `playwright` will do', (value) => {
    const result = run('console.log("loaded")', {NOVA3D_FAKE_NETWORK: value, NOVA3D_FAKE_NETWORK_DIR: directory});
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('loaded');
  });

  it('refuses to load without the private control directory, and does not invent a predictable one', () => {
    const result = run('console.log("loaded")', {NOVA3D_FAKE_NETWORK: 'playwright'});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('NOVA3D_FAKE_NETWORK_DIR');
    expect(readFileSync(preload, 'utf8')).not.toMatch(/tmpdir|nova3d-fake-network['"`]/);
  });

  it('loads with both, and leaves fetch working for anything that is not the accounts API', () => {
    const result = run('console.log(JSON.stringify({loaded: true, fetch: typeof fetch}))', allowed());
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({loaded: true, fetch: 'function'});
  });
});

describe('what it does to a call', () => {
  // A local server stands in for the accounts API, so the script can tell a call that went through from one that did not.
  const script = (user: string, rpc: string, body = `{p_user_id: '${user}'}`) => `
    import {createServer} from 'node:http';
    const seen = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => { seen.push(request.url); response.writeHead(200, {'content-type': 'application/json'}).end('{"ok":true}'); });
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const base = 'http://127.0.0.1:' + server.address().port;
    let outcome;
    try {
      const response = await fetch(base + '/rest/v1/rpc/${rpc}', {method: 'POST', body: JSON.stringify(${body})});
      outcome = String(response.status);
    } catch (error) {
      outcome = error.name + ':' + error.message;
    }
    server.close();
    console.log(JSON.stringify({outcome, reached: seen.length}));
  `;
  const call = (user: string, rpc = 'authorize_session') => JSON.parse(run(script(user, rpc), allowed()).stdout) as {outcome: string; reached: number};

  it('lets a call through when nothing is switched on', () => {
    expect(call(USER)).toEqual({outcome: '200', reached: 1});
  });

  it('fails every accounts API call for the named user, as a dropped connection, and only for that user', () => {
    writeFileSync(join(directory, USER), '');
    expect(call(USER)).toEqual({outcome: 'TypeError:fetch failed', reached: 0});
    expect(call(OTHER)).toEqual({outcome: '200', reached: 1});
  });

  it('can be narrowed to some functions, and can answer 503 instead', () => {
    writeFileSync(join(directory, USER), JSON.stringify({rpc: ['revoke_grants']}));
    expect(call(USER, 'authorize_session')).toEqual({outcome: '200', reached: 1});
    expect(call(USER, 'revoke_grants')).toEqual({outcome: 'TypeError:fetch failed', reached: 0});
    writeFileSync(join(directory, USER), JSON.stringify({mode: 'error'}));
    expect(call(USER)).toEqual({outcome: '503', reached: 0});
  });

  it('attributes a revocation to the user by the actor of the call too, since a revocation by Account names no user ID', () => {
    writeFileSync(join(directory, USER), '');
    const byActor = (actor: string) => JSON.parse(run(script(USER, 'revoke_grants', `{p_actor: '${actor}', p_account_id: 'an-account'}`), allowed()).stdout) as {outcome: string; reached: number};
    expect(byActor(`user:${USER}`)).toEqual({outcome: 'TypeError:fetch failed', reached: 0});
    expect(byActor(`user:${OTHER}`)).toEqual({outcome: '200', reached: 1});
    expect(byActor('system:authorization')).toEqual({outcome: '200', reached: 1});
  });

  it('counts the calls it sees, by function name, for the user the call names', () => {
    call(USER, 'authorize_session');
    call(USER, 'issue_grant');
    call(OTHER, 'authorize_session');
    expect(readFileSync(join(directory, `${USER}.calls`), 'utf8')).toBe('authorize_session\nissue_grant\n');
    expect(readFileSync(join(directory, `${OTHER}.calls`), 'utf8')).toBe('authorize_session\n');
  });

  it('touches nothing that is not a call to the accounts API: no file is written for Auth or any other path', () => {
    const result = run(
      `import {createServer} from 'node:http'; const server = createServer((_q, r) => r.end('ok')); await new Promise((d) => server.listen(0, '127.0.0.1', d)); const base = 'http://127.0.0.1:' + server.address().port; await fetch(base + '/auth/v1/user', {method: 'POST', body: JSON.stringify({p_user_id: '${USER}'})}); await fetch(base + '/rest/v1/other', {method: 'POST', body: JSON.stringify({p_user_id: '${USER}'})}); server.close(); console.log('done')`,
      allowed(),
    );
    expect(result.stdout).toBe('done');
    expect(() => readFileSync(join(directory, `${USER}.calls`), 'utf8')).toThrow();
  });
});
