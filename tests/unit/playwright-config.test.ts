import {existsSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// How playwright.config.ts starts the second application server, the one with the fake network preloaded.
type Server = {command: string; url: string; env?: Record<string, string>; reuseExistingServer?: boolean};
let created: string[] = [];

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(name, undefined as unknown as string);
    else vi.stubEnv(name, value);
  }
  const before = process.env.NOVA3D_FAKE_NETWORK_DIR;
  const config = (await import('../../playwright.config')).default as {webServer: Server[]; globalTeardown?: string};
  if (process.env.NOVA3D_FAKE_NETWORK_DIR && process.env.NOVA3D_FAKE_NETWORK_DIR !== before) created.push(process.env.NOVA3D_FAKE_NETWORK_DIR);
  const [app, fake, gateway] = config.webServer;
  return {config, app, fake, gateway};
}

beforeEach(() => {
  delete process.env.NOVA3D_FAKE_NETWORK_DIR;
  vi.stubEnv('PORT', '4173');
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.NOVA3D_FAKE_NETWORK_DIR;
  for (const directory of created) rmSync(directory, {recursive: true, force: true});
  created = [];
});

describe('the second server, with the fake network', () => {
  it('is a different port from the first, the same build, and never an already-running server', async () => {
    const {app, fake} = await load();
    expect(app.url).toBe('http://127.0.0.1:4173/api/health');
    expect(fake.url).toBe('http://127.0.0.1:4174/api/health');
    expect(fake.command).toContain('--port 4174');
    expect(fake.reuseExistingServer).toBe(false);
    // The first server may be reused outside CI, as before.
    expect(app.reuseExistingServer).toBe(true);
  });

  it('gets the preload as a file URL, so no path with a space or a quote can come apart', async () => {
    const { fake } = await load();
    const options = fake.env!.NODE_OPTIONS;
    expect(options).toMatch(/^--import file:\/\/\/\S+\/tests\/support\/fake-network\.mjs$/);
    expect(options).not.toMatch(/["']/);
  });

  it('keeps a NODE_OPTIONS that is already set, and puts the preload after it', async () => {
    const {fake} = await load({NODE_OPTIONS: '--max-old-space-size=512 --trace-warnings'});
    expect(fake.env!.NODE_OPTIONS).toMatch(/^--max-old-space-size=512 --trace-warnings --import file:\/\/\//);
  });

  it('is told, in its own environment only, that the fake network is allowed, and where its private directory is', async () => {
    const {app, fake} = await load();
    expect(fake.env!.NOVA3D_FAKE_NETWORK).toBe('playwright');
    expect(fake.env!.NOVA3D_FAKE_NETWORK_DIR).toBe(process.env.NOVA3D_FAKE_NETWORK_DIR);
    expect(app.env?.NOVA3D_FAKE_NETWORK).toBeUndefined();
    expect(app.env?.NODE_OPTIONS ?? '').not.toContain('fake-network');
  });

  it('makes the control directory with mkdtemp: random name, mode 0700, under the temp directory', async () => {
    const {fake} = await load();
    const directory = fake.env!.NOVA3D_FAKE_NETWORK_DIR;
    expect(dirname(directory)).toBe(tmpdir());
    expect(basename(directory)).toMatch(/^nova3d-fake-network-[A-Za-z0-9]{6}$/);
    expect(existsSync(directory)).toBe(true);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    const second = await load();
    // A second load in the same process (Playwright loads the config in each worker) reuses it.
    expect(second.fake.env!.NOVA3D_FAKE_NETWORK_DIR).toBe(directory);
  });

  it('does not make a second directory when a worker inherits one', async () => {
    const {fake} = await load();
    const directory = fake.env!.NOVA3D_FAKE_NETWORK_DIR;
    process.env.NOVA3D_FAKE_NETWORK_DIR = directory;
    const again = await load();
    expect(again.fake.env!.NOVA3D_FAKE_NETWORK_DIR).toBe(directory);
  });

  it('cleans the directory up when the run ends', async () => {
    const {config, fake} = await load();
    expect(config.globalTeardown).toBe('./tests/support/fake-network-teardown.ts');
    const directory = fake.env!.NOVA3D_FAKE_NETWORK_DIR;
    const teardown = (await import('../support/fake-network-teardown')).default;
    teardown();
    expect(existsSync(directory)).toBe(false);
  });
});

describe('the third server, the file gateway (Story 1.12)', () => {
  it('is on the port after the second server\'s: another origin than the application\'s, so a browser reaches it across origins', async () => {
    const {app, gateway} = await load();
    expect(gateway.url).toBe('http://127.0.0.1:4175/healthz');
    expect(new URL(gateway.url).origin).not.toBe(new URL(app.url).origin);
    expect(gateway.env!.PORT).toBe('4175');
    expect(gateway.env!.APP_ORIGIN).toBe('http://127.0.0.1:4173');
  });

  it('runs the gateway the way its image does, reading .env.local when there is one, and is never an already-running server', async () => {
    const {gateway} = await load();
    expect(gateway.command).toBe('node --env-file-if-exists=.env.local workers/files/src/main.ts');
    expect(gateway.reuseExistingServer).toBe(false);
  });

  it('gives both application servers the signing key, the key set and the gateway\'s address, and the gateway the public key set ONLY', async () => {
    const {app, fake, gateway} = await load();
    for (const server of [app, fake]) {
      expect(server.env!.SERVICE_SIGNING_KEY_APPLICATION, server.url).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(JSON.parse(server.env!.SERVICE_KEYS_APPLICATION)).toMatchObject({issuer: 'application', retiring: null});
      expect(server.env!.FILE_GATEWAY_URL, server.url).toBe('http://127.0.0.1:4175');
    }
    expect(gateway.env!.SERVICE_KEYS_APPLICATION).toBe(app.env!.SERVICE_KEYS_APPLICATION);
    // The private half is the application's alone.
    expect(Object.keys(gateway.env!).filter((name) => /SIGNING_KEY|SECRET|PASSWORD|TOKEN/.test(name))).toEqual([]);
  });

  it('follows PORT for all three, and refuses a PORT whose third server would not be a port', async () => {
    vi.stubEnv('PORT', '5000');
    const {app, fake, gateway} = await load({PORT: '5000'});
    expect([app.url, fake.url, gateway.url]).toEqual(['http://127.0.0.1:5000/api/health', 'http://127.0.0.1:5001/api/health', 'http://127.0.0.1:5002/healthz']);
    expect(app.env!.FILE_GATEWAY_URL).toBe('http://127.0.0.1:5002');
    expect(gateway.env!.APP_ORIGIN).toBe('http://127.0.0.1:5000');
    await expect(load({PORT: '65534'})).rejects.toThrow(/PORT \+ 2/);
  });
});
