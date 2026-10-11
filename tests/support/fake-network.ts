import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

// The test side of tests/support/fake-network.mjs: switch the fake network on and off for one user, and read
// how many accounts API calls the server made for them. The directory is the private one playwright.config.ts
// made for the run and handed to the server (the workers inherit it), so a test run outside Playwright cannot
// find one and says so.
export function fakeNetworkDirectory() {
  const directory = process.env.NOVA3D_FAKE_NETWORK_DIR;
  if (!directory) throw new Error('The fake network is controlled through the directory playwright.config.ts makes (NOVA3D_FAKE_NETWORK_DIR); run this test with `npm run test:e2e`.');
  return directory;
}

export type Outage = {
  /** Fail only these accounts API functions (by name); by default all of them. */
  rpc?: string[];
  /** `down`: the connection fails. `error`: the database answers 503. */
  mode?: 'down' | 'error';
};

/** Makes the accounts API fail for the user until the returned function (or `restore`) is called. */
export function startOutage(userId: string, outage: Outage = {}) {
  writeFileSync(join(fakeNetworkDirectory(), userId), JSON.stringify(outage));
  return () => endOutage(userId);
}

export function endOutage(userId: string) {
  rmSync(join(fakeNetworkDirectory(), userId), {force: true});
}

/** The accounts API functions the server called for the user, in order, since the last `forgetCalls`. */
export function callsFor(userId: string): string[] {
  const file = join(fakeNetworkDirectory(), `${userId}.calls`);
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function forgetCalls(userId: string) {
  rmSync(join(fakeNetworkDirectory(), `${userId}.calls`), {force: true});
}

/** The address of the second application server, the one with the fake network, given the first one's. */
export function flakyBaseUrl(baseURL: string) {
  const url = new URL(baseURL);
  url.port = String(Number(url.port) + 1);
  return url.origin;
}
