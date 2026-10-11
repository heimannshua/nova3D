// A fake network for the browser tests (Story 1.4a). It is preloaded with `node --import` into the SECOND
// application server that tests/e2e/authorization.spec.ts talks to (see playwright.config.ts), and into
// nothing else: the application's own code has no test hook in it. It wraps the server's fetch so that a
// service-role call to the accounts API for ONE named user can be made to fail on demand, which is how a
// browser test makes "the database is unreachable" true for that user alone while every other test goes on
// using the same local stack.
//
// Control is by files in that directory, keyed by the user's ID, so the tests need no channel into the server:
//
//   <dir>/<user-id>          present: calls for that user fail. Its content may narrow and shape the failure:
//                            {"rpc": ["authorize_session"], "mode": "down" | "error"}
//                            (no content: every call, mode "down"). "down" is a connection that never gets
//                            through; "error" is the database answering 503.
//   <dir>/<user-id>.calls    one line per accounts API call made for that user, by function name, so a test
//                            can count how many authorizations a page costs.
//
// A call is attributed to the user by the `p_user_id` it carries, or by the `user:<id>` actor of a
// revocation. Everything else, Auth included, goes through untouched.
//
// It refuses to load unless playwright.config.ts has said it may: NOVA3D_FAKE_NETWORK must be `playwright`,
// and NOVA3D_FAKE_NETWORK_DIR must name the private directory (made with mkdtemp) the run controls it through.
// A stray NODE_OPTIONS in a shell or a deployment therefore cannot turn a real server into a flaky one.
import {appendFileSync, existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

if (process.env.NOVA3D_FAKE_NETWORK !== 'playwright') {
  throw new Error('tests/support/fake-network.mjs is a test fake. It loads only for the server playwright.config.ts starts for it (NOVA3D_FAKE_NETWORK=playwright).');
}
const directory = process.env.NOVA3D_FAKE_NETWORK_DIR;
if (!directory) throw new Error('tests/support/fake-network.mjs needs NOVA3D_FAKE_NETWORK_DIR, the private directory made by playwright.config.ts.');

const realFetch = globalThis.fetch;
const rpcPath = /^\/rest\/v1\/rpc\/([a-z_]+)$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subjectOf(body) {
  if (typeof body.p_user_id === 'string' && uuid.test(body.p_user_id)) return body.p_user_id.toLowerCase();
  const actor = typeof body.p_actor === 'string' ? body.p_actor : '';
  const id = actor.startsWith('user:') ? actor.slice(5) : '';
  return uuid.test(id) ? id.toLowerCase() : null;
}

function plan(userId, name) {
  const file = join(directory, userId);
  if (!existsSync(file)) return null;
  let spec = {};
  try {
    const text = readFileSync(file, 'utf8').trim();
    spec = text ? JSON.parse(text) : {};
  } catch {
    spec = {};
  }
  if (Array.isArray(spec.rpc) && !spec.rpc.includes(name)) return null;
  return spec.mode === 'error' ? 'error' : 'down';
}

globalThis.fetch = async function fakeNetworkFetch(input, init) {
  let userId = null;
  let name = null;
  try {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    name = rpcPath.exec(url.pathname)?.[1] ?? null;
    if (name && typeof init?.body === 'string') userId = subjectOf(JSON.parse(init.body));
  } catch {
    name = null;
  }
  if (name && userId) {
    try {
      appendFileSync(join(directory, `${userId}.calls`), `${name}\n`);
    } catch {
      // Counting is a convenience for the tests; it must never change what the server does.
    }
    const failure = plan(userId, name);
    if (failure === 'down') throw new TypeError('fetch failed');
    if (failure === 'error') return new Response(JSON.stringify({message: 'the database is down (fake network)'}), {status: 503, headers: {'content-type': 'application/json'}});
  }
  return realFetch(input, init);
};
