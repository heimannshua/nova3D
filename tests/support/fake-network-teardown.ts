import {rmSync} from 'node:fs';

// Removes the fake network's private control directory (see playwright.config.ts) when the run ends.
export default function teardown() {
  const directory = process.env.NOVA3D_FAKE_NETWORK_DIR;
  if (directory) rmSync(directory, {recursive: true, force: true});
}
