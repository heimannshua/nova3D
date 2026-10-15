import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {defineConfig, devices} from '@playwright/test';
import {testSigningKeys} from './tests/support/qstash-signature';
import {recoveryAdministratorEmail} from './tests/support/recovery-env';

const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be a positive integer up to 65535 (received "${process.env.PORT}").`);
}
// The second application server, for the flows that need the accounts database to fail for one user
// (tests/e2e/authorization.spec.ts). It is the same build, with a fake network preloaded into it.
const flakyPort = port + 1;
if (flakyPort > 65535) throw new Error('PORT + 1 must also be a valid port.');
// The step-up flows (Story 1.4b, tests/e2e/step-up.spec.ts) run a real second Google sign-in against a fake Google
// that `npm run fake-google:up` puts behind the stack's Auth container (scripts/fake-google-stack.mjs). Nothing
// here starts it: the swap changes the stack, not the application servers below, and the swap allows these two
// servers' callbacks (this port and the next one, 4173 and 4174 by default). The specs that need it skip when it
// is not running, and fail in CI, where it must be.
// The fake network is controlled through a private directory made here, once: Playwright loads this file in
// the process that starts the servers and again in each worker, and the workers inherit the variable the first
// load sets. The directory name is random (mkdtemp, mode 0700) and is removed when the run ends.
if (!process.env.NOVA3D_FAKE_NETWORK_DIR) process.env.NOVA3D_FAKE_NETWORK_DIR = mkdtempSync(join(tmpdir(), 'nova3d-fake-network-'));
// A file URL has no spaces or quotes to get wrong, and an existing NODE_OPTIONS is kept.
const fakeNetworkPreload = `--import ${pathToFileURL(resolve(import.meta.dirname, 'tests/support/fake-network.mjs')).href}`;
const nodeOptions = [process.env.NODE_OPTIONS, fakeNetworkPreload].filter(Boolean).join(' ');

// Both servers are started with a test Administrator address (tests/support/recovery-env.ts), which the process
// environment gives them over `.env.local`: Administrator recovery (Story 1.6) serves the one Account whose Auth user's
// email is the server's ADMINISTRATOR_EMAIL, and the recovery browser flows make theirs under this address, so they never
// touch, and are never confused with, a developer's real Administrator in the same local database.
//
// They are also given the QStash signing keys of the tests (tests/support/qstash-signature.ts, Story 1.9), which are made up and belong to no
// Upstash account: the scheduled-job route verifies a signature only with the keys in its environment, and tests/e2e/jobs.spec.ts signs its
// calls with these. They are set here, in the web server's environment, and nowhere else: not in .env.example, not in .env.local.
const testServerEnv = {
  ADMINISTRATOR_EMAIL: recoveryAdministratorEmail,
  QSTASH_CURRENT_SIGNING_KEY: testSigningKeys.current,
  QSTASH_NEXT_SIGNING_KEY: testSigningKeys.next,
};

// Browser flows run against the production build (`npm run build` first). The server verifies its
// environment identity on startup, so run it against the Supabase CLI stack with `.env.local`
// written by `node scripts/setup-env.mjs local`, or export the same variables. The registration flows
// also forge Google sessions in that stack and issue codes under the server's hashing keys, so the tests
// read the same variables (tests/support/server-env.ts) and refuse to run against anything but the
// local stack.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  globalTeardown: './tests/support/fake-network-teardown.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', {open: 'never'}]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {name: 'desktop', use: {...devices['Desktop Chrome']}},
    {name: 'phone', use: {...devices['Pixel 7']}},
  ],
  webServer: [
    {
      command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
      url: `http://127.0.0.1:${port}/api/health`,
      env: testServerEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The same build with tests/support/fake-network.mjs preloaded. Nothing reaches it but the tests that
      // ask for it, and the fake network fails nothing until a test switches it on for one user. It is never
      // an already-running server: one that was not started with the preload (or with another directory)
      // would let the outage tests pass or fail for the wrong reason.
      command: `npm run start -- --hostname 127.0.0.1 --port ${flakyPort}`,
      url: `http://127.0.0.1:${flakyPort}/api/health`,
      env: {...testServerEnv, NODE_OPTIONS: nodeOptions, NOVA3D_FAKE_NETWORK: 'playwright', NOVA3D_FAKE_NETWORK_DIR: process.env.NOVA3D_FAKE_NETWORK_DIR},
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
