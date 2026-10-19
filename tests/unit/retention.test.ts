import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Operation} from '@/lib/authority';
import {createBudget} from '@/lib/deadline';
import {GatewayError, GatewayUnavailableError, type GatewayClient} from '@/lib/gateway-client';
import type {PictureRetentionCheck} from '@/lib/projects';
import {attachLimitMs, maxInFlight, retainBudgetMs, retainPictures, stripTransform, type RetentionDeps, type RetentionInput, type RetentionResult} from '@/lib/retention';

// Retaining the pictures of a review (Story 2.12, lib/retention.ts) with a fake pre-check and a fake gateway: which pictures are attached (only the ones that need it),
// how many at once (4), how long each may take (30 seconds), what each answer of the gateway means for the person, what a failure of one picture does to the others, and that
// a second run asks the gateway for nothing. The real pre-check is the database's (tests/integration/retained-pictures.test.ts) and the real gateway is
// tests/integration/file-gateway.test.ts.

const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const PROJECT = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const operation: Operation = {accountId: ACCOUNT, epoch: 4};
const upload = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ROOT = 'ab'.repeat(32);
const uploads = (count: number) => Array.from({length: count}, (_unused, index) => upload(index + 1));
const input = (count = 3): RetentionInput => ({projectId: PROJECT, expectedSeq: 2, uploadIds: uploads(count)});

/** What the pre-check says: every picture needs an attach unless listed in `retained`. */
const checked = (count: number, retained: number[] = []): PictureRetentionCheck => ({
  outcome: 'checked',
  pictures: uploads(count).map((uploadId, index) => ({position: index + 1, uploadId, action: retained.includes(index + 1) ? ('retained' as const) : ('attach' as const), root: retained.includes(index + 1) ? ROOT : null})),
});
const manifest = {id: upload(1), root: ROOT, digest: 'cd'.repeat(32), length: 1000, kind: 'picture'};

type AttachCall = {accountId: string; epoch: number; uploadId: string; transform: string};
type Fake = {
  client: GatewayClient;
  calls: AttachCall[];
  inFlight: () => number;
  peak: () => number;
  /** Decides what each attach does; the default publishes. */
  behavior: (call: AttachCall) => Promise<unknown> | unknown;
  setBehavior: (next: (call: AttachCall) => Promise<unknown> | unknown) => void;
};
function fakeGateway(): Fake {
  const calls: AttachCall[] = [];
  let current = 0;
  let peak = 0;
  let behavior: (call: AttachCall) => Promise<unknown> | unknown = () => ({outcome: 'published', manifest});
  const client: GatewayClient = {
    async attach(call) {
      calls.push(call);
      current += 1;
      peak = Math.max(peak, current);
      try {
        return (await behavior(call)) as Awaited<ReturnType<GatewayClient['attach']>>;
      } finally {
        current -= 1;
      }
    },
    async deleteStaging() {
      throw new Error('retention never deletes');
    },
    async deleteRoot() {
      throw new Error('retention never deletes');
    },
  };
  return {client, calls, inFlight: () => current, peak: () => peak, behavior, setBehavior: (next) => void (behavior = next)};
}

function run(check: PictureRetentionCheck | (() => Promise<PictureRetentionCheck>), gateway: Fake | null, extra: RetentionDeps = {}, request: RetentionInput = input()) {
  const deps: RetentionDeps = {
    check: vi.fn(async () => (typeof check === 'function' ? check() : check)),
    gateway: () => (gateway ? gateway.client : null),
    ...extra,
  };
  return {result: retainPictures(operation, request, deps), deps};
}

const logged = () => [console.log, console.info, console.warn, console.error, console.debug].flatMap((method) => vi.mocked(method).mock.calls.flat().map((value) => (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value))));

beforeEach(() => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the sequence: a pre-check, then the attaches it asks for', () => {
  it('asks the pre-check as the operation of the verified Account, for the revision and the uploads it was given, within the run\'s budget', async () => {
    const gateway = fakeGateway();
    const {result, deps} = run(checked(3), gateway);
    await result;
    expect(deps.check).toHaveBeenCalledTimes(1);
    const [who, request, options] = vi.mocked(deps.check!).mock.calls[0];
    expect(who).toEqual(operation);
    expect(request).toEqual(input());
    expect(options?.timeoutMs).toBeGreaterThan(0);
    expect(options?.timeoutMs).toBeLessThanOrEqual(retainBudgetMs);
  });

  it('attaches every picture that has no retained copy, with the strip transform and the operation\'s Account and epoch, and answers retained with the count', async () => {
    const gateway = fakeGateway();
    expect(await run(checked(3), gateway).result).toEqual({outcome: 'retained', count: 3});
    expect(gateway.calls.map((call) => call.uploadId).sort()).toEqual(uploads(3));
    for (const call of gateway.calls) expect(call).toEqual({accountId: ACCOUNT, epoch: 4, uploadId: call.uploadId, transform: 'strip-picture-metadata'});
    expect(stripTransform).toBe('strip-picture-metadata');
  });

  it('attaches only the pictures the pre-check says need it: one already retained is not asked about again', async () => {
    const gateway = fakeGateway();
    expect(await run(checked(4, [1, 3]), gateway).result).toEqual({outcome: 'retained', count: 4});
    expect(gateway.calls.map((call) => call.uploadId).sort()).toEqual([upload(2), upload(4)]);
  });

  it('is idempotent: a run in which every picture is retained asks the gateway for nothing, and does not even build a client', async () => {
    const gateway = fakeGateway();
    const buildClient = vi.fn(() => gateway.client);
    const first = await retainPictures(operation, input(), {check: async () => checked(3, [1, 2, 3]), gateway: buildClient});
    const second = await retainPictures(operation, input(), {check: async () => checked(3, [1, 2, 3]), gateway: buildClient});
    expect(first).toEqual({outcome: 'retained', count: 3});
    expect(second).toEqual(first);
    expect(gateway.calls).toHaveLength(0);
    expect(buildClient).not.toHaveBeenCalled();
  });

  it('runs a second time after a first, and the second finds the pictures retained and attaches none (the same confirmation twice)', async () => {
    const gateway = fakeGateway();
    const retained = new Set<number>();
    const check = async (): Promise<PictureRetentionCheck> => checked(3, [...retained]);
    gateway.setBehavior((call) => {
      retained.add(uploads(3).indexOf(call.uploadId) + 1);
      return {outcome: 'published', manifest};
    });
    expect(await retainPictures(operation, input(), {check, gateway: () => gateway.client})).toEqual({outcome: 'retained', count: 3});
    expect(gateway.calls).toHaveLength(3);
    expect(await retainPictures(operation, input(), {check, gateway: () => gateway.client})).toEqual({outcome: 'retained', count: 3});
    expect(gateway.calls).toHaveLength(3);
  });

  it('treats `exists` as success: the gateway found the manifest already made', async () => {
    const gateway = fakeGateway();
    gateway.setBehavior(() => ({outcome: 'exists', manifest}));
    expect(await run(checked(2), gateway).result).toEqual({outcome: 'retained', count: 2});
  });

  it('answers unavailable (about no picture) and attaches nothing when no gateway is configured, and says so only when something had to be attached', async () => {
    expect(await run(checked(2), null).result).toEqual({outcome: 'unavailable', position: null});
    expect(await run(checked(2, [1, 2]), null).result).toEqual({outcome: 'retained', count: 2});
  });
});

describe('the pre-check\'s own answers are the run\'s, and nothing is attached for them', () => {
  it.each<[PictureRetentionCheck, RetentionResult]>([
    [{outcome: 'denied'}, {outcome: 'denied'}],
    [{outcome: 'unavailable'}, {outcome: 'gone'}],
    [{outcome: 'not_editable'}, {outcome: 'not_editable'}],
    [{outcome: 'stale', seq: 5}, {outcome: 'stale', seq: 5}],
    [{outcome: 'stale', seq: null}, {outcome: 'stale', seq: null}],
    [{outcome: 'unknown_upload', position: 2}, {outcome: 'unknown_upload', position: 2}],
    [{outcome: 'not_ready', position: 3}, {outcome: 'not_ready', position: 3}],
    [{outcome: 'expired_upload', position: 1}, {outcome: 'expired_upload', position: 1}],
    [{outcome: 'quota_exceeded', kept: 2_137_000_000, asked: 12_582_912}, {outcome: 'quota_exceeded', kept: 2_137_000_000, asked: 12_582_912}],
  ])('turns %j into %j', async (check, expected) => {
    const gateway = fakeGateway();
    expect(await run(check, gateway).result).toEqual(expected);
    expect(gateway.calls).toHaveLength(0);
  });

  it('lets a pre-check that could not reach the database throw: the caller tells the person to try again, and nothing was attached', async () => {
    const gateway = fakeGateway();
    const failing = vi.fn(async () => {
      throw new Error('the database did not answer');
    });
    await expect(retainPictures(operation, input(), {check: failing, gateway: () => gateway.client})).rejects.toThrow('the database did not answer');
    expect(gateway.calls).toHaveLength(0);
  });
});

describe('at most 4 in flight, each limited to 30 seconds', () => {
  it('has 4 attaches in flight at a time, however many pictures there are, and starts the next as one finishes', async () => {
    expect(maxInFlight).toBe(4);
    const gateway = fakeGateway();
    const release: (() => void)[] = [];
    gateway.setBehavior(
      () =>
        new Promise((resolve) => {
          release.push(() => resolve({outcome: 'published', manifest}));
        }),
    );
    const { result } = run(checked(12), gateway);
    await vi.waitFor(() => expect(gateway.inFlight()).toBe(4));
    expect(gateway.calls).toHaveLength(4);
    // One finishes, the next starts, and there are still 4.
    release.shift()!();
    await vi.waitFor(() => expect(gateway.calls).toHaveLength(5));
    expect(gateway.inFlight()).toBe(4);
    while (release.length > 0 || gateway.calls.length < 12) {
      release.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(await result).toEqual({outcome: 'retained', count: 12});
    expect(gateway.peak()).toBe(4);
    expect(gateway.calls).toHaveLength(12);
    expect(new Set(gateway.calls.map((call) => call.uploadId)).size).toBe(12);
  });

  it('starts fewer when there are fewer pictures to attach', async () => {
    const gateway = fakeGateway();
    gateway.setBehavior(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {outcome: 'published', manifest};
    });
    await run(checked(2), gateway).result;
    expect(gateway.peak()).toBe(2);
  });

  it('can be asked for fewer in flight', async () => {
    const gateway = fakeGateway();
    gateway.setBehavior(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {outcome: 'published', manifest};
    });
    await run(checked(6), gateway, {maxInFlight: 2}).result;
    expect(gateway.peak()).toBe(2);
  });

  it('gives up on an attach that takes more than 30 seconds, as one the gateway did not answer, and goes on with the others', async () => {
    vi.useFakeTimers();
    expect(attachLimitMs).toBe(30_000);
    const gateway = fakeGateway();
    gateway.setBehavior((call) => (call.uploadId === upload(2) ? new Promise(() => undefined) : { outcome: 'published', manifest }));
    const { result } = run(checked(3), gateway);
    await vi.advanceTimersByTimeAsync(29_999);
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    // Picture 2 did not answer: it is reported, and pictures 1 and 3 were published (kept for the retry).
    expect(await result).toEqual({outcome: 'unavailable', position: 2});
    expect(gateway.calls.map((call) => call.uploadId).sort()).toEqual(uploads(3));
  });

  it('gives an attach no more time than the run has left, and starts none when none is left', async () => {
    vi.useFakeTimers();
    const gateway = fakeGateway();
    gateway.setBehavior(() => new Promise(() => undefined));
    // Three pictures, one at a time, 40 seconds in all: the first takes the 30, the second the 10 that are left, and the third is never started.
    const budget = createBudget(40_000);
    const { result } = run(checked(3), gateway, { maxInFlight: 1, budget });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(gateway.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await result).toEqual({outcome: 'unavailable', position: 1});
    expect(gateway.calls).toHaveLength(2);
  });
});

describe('what each answer of the gateway means for the person', () => {
  const refuse = (status: number, code: string | null) => () => {
    throw new GatewayError(status, code);
  };

  it.each([
    [409, 'bytes_changed', 'bytes_changed'],
    [400, 'strip_failed', 'strip_failed'],
    [409, 'lease_expired', 'lease_expired'],
    [409, 'not_complete', 'not_complete'],
    [409, 'manifest_conflict', 'manifest_conflict'],
    [404, 'not_found', 'unknown_upload'],
  ] as const)('names the picture for %i %s: %s', async (status, code, outcome) => {
    const gateway = fakeGateway();
    gateway.setBehavior((call) => (call.uploadId === upload(2) ? refuse(status, code)() : { outcome: 'published', manifest }));
    expect(await run(checked(3), gateway).result).toEqual({outcome, position: 2});
  });

  it('maps the gateway\'s quota backstop (a race) to quota_exceeded for the whole confirmation, without sizes it does not know', async () => {
    const gateway = fakeGateway();
    gateway.setBehavior(refuse(413, 'quota_exceeded'));
    expect(await run(checked(3), gateway).result).toEqual({outcome: 'quota_exceeded', kept: null, asked: null});
  });

  it('maps a refusal of authority to denied', async () => {
    const gateway = fakeGateway();
    gateway.setBehavior(refuse(403, 'forbidden'));
    expect(await run(checked(2), gateway).result).toEqual({outcome: 'denied'});
  });

  it.each([
    ['a gateway that cannot be reached', () => { throw new GatewayUnavailableError(); }],
    ['a 503', refuse(503, 'unavailable')],
    ['a 502 with no body', refuse(502, null)],
    ['a 429', refuse(429, null)],
  ])('maps %s to unavailable, for the picture it was about, which trying again may cure', async (_name, behavior) => {
    const gateway = fakeGateway();
    gateway.setBehavior((call) => (call.uploadId === upload(3) ? behavior() : { outcome: 'published', manifest }));
    expect(await run(checked(3), gateway).result).toEqual({outcome: 'unavailable', position: 3});
  });

  it('maps an answer it does not know (a code it has no word for) to unavailable, and does not go on', async () => {
    const gateway = fakeGateway();
    gateway.setBehavior(refuse(400, 'unknown_transform'));
    expect(await run(checked(8), gateway, {maxInFlight: 1}).result).toEqual({outcome: 'unavailable', position: 1});
    expect(gateway.calls).toHaveLength(1);
  });

  it('maps an error that is not the gateway\'s (a claim the signer refused, a bug) to unavailable too, and prints nothing', async () => {
    const gateway = fakeGateway();
    gateway.setBehavior(() => {
      throw new TypeError(`bad claims for ${ACCOUNT}`);
    });
    expect(await run(checked(2), gateway).result).toEqual({outcome: 'unavailable', position: 1});
    expect(logged()).toEqual([]);
  });
});

describe('a picture that fails does not undo the others', () => {
  it('keeps going after a failure that trying again may cure, only to report it: pictures 1 and 3 are published for the retry, and the failure names picture 2', async () => {
    const gateway = fakeGateway();
    gateway.setBehavior((call) => {
      if (call.uploadId === upload(2)) throw new GatewayUnavailableError();
      return { outcome: 'published', manifest };
    });
    expect(await run(checked(3), gateway, {maxInFlight: 1}).result).toEqual({outcome: 'unavailable', position: 2});
    expect(gateway.calls.map((call) => call.uploadId)).toEqual(uploads(3));
  });

  it('stops starting new attaches after a failure that trying again cannot cure, and lets the ones in flight finish', async () => {
    const gateway = fakeGateway();
    gateway.setBehavior(async (call) => {
      // Picture 2 is refused at once; pictures 1 and 3 are still on their way when it is.
      if (call.uploadId === upload(2)) throw new GatewayError(409, 'bytes_changed');
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { outcome: 'published', manifest };
    });
    const answer = await run(checked(10), gateway, {maxInFlight: 3}).result;
    expect(answer).toEqual({outcome: 'bytes_changed', position: 2});
    // Pictures 1 to 3 were in flight when picture 2 failed; none after them was started.
    expect(gateway.calls.map((call) => call.uploadId).sort()).toEqual(uploads(3));
  });

  it('tells the Account\'s lost authority first, then the quota, then a picture that cannot be kept, then one that could not be reached', async () => {
    const answers = async (failures: Record<number, unknown>) => {
      const gateway = fakeGateway();
      gateway.setBehavior((call) => {
        const failure = failures[uploads(4).indexOf(call.uploadId) + 1];
        if (failure) throw failure;
        return { outcome: 'published', manifest };
      });
      return run(checked(4), gateway, {maxInFlight: 4}).result;
    };
    const unreachable = new GatewayUnavailableError();
    const changed = new GatewayError(409, 'bytes_changed');
    const quota = new GatewayError(413, 'quota_exceeded');
    const forbidden = new GatewayError(403, 'forbidden');
    expect(await answers({1: unreachable, 2: changed})).toEqual({outcome: 'bytes_changed', position: 2});
    expect(await answers({1: changed, 3: quota})).toEqual({outcome: 'quota_exceeded', kept: null, asked: null});
    expect(await answers({2: quota, 4: forbidden})).toEqual({outcome: 'denied'});
    expect(await answers({4: unreachable, 3: unreachable})).toEqual({outcome: 'unavailable', position: 3});
    expect(await answers({3: changed, 1: new GatewayError(400, 'strip_failed')})).toEqual({outcome: 'strip_failed', position: 1});
  });
});

describe('what the run keeps to itself', () => {
  it('puts no manifest root, object key or address in any answer or any line it prints, whatever the gateway and the pre-check say', async () => {
    const gateway = fakeGateway();
    const secret = 'ee'.repeat(32);
    gateway.setBehavior((call) => {
      if (call.uploadId === upload(2)) throw new GatewayError(409, 'bytes_changed');
      return { outcome: 'published', manifest: { ...manifest, root: secret } };
    });
    const check: PictureRetentionCheck = {
      outcome: 'checked',
      pictures: [
        {position: 1, uploadId: upload(1), action: 'retained', root: ROOT},
        {position: 2, uploadId: upload(2), action: 'attach', root: null},
        {position: 3, uploadId: upload(3), action: 'attach', root: null},
      ],
    };
    const answers = [await run(check, gateway).result, await run(checked(3, [1, 2, 3]), gateway).result];
    for (const answer of answers) {
      expect(JSON.stringify(answer)).not.toContain(ROOT);
      expect(JSON.stringify(answer)).not.toContain(secret);
      expect(JSON.stringify(answer)).not.toMatch(/objects\/|staging\/|https?:/);
    }
    expect(logged()).toEqual([]);
  });

  it('is not a way to delete anything: the gateway client\'s deletions are never asked for', async () => {
    const gateway = fakeGateway();
    await run(checked(3), gateway).result;
    gateway.setBehavior(() => {
      throw new GatewayError(409, 'bytes_changed');
    });
    await run(checked(3), gateway).result;
    // (The fake throws if a deletion is asked for; no run above failed with that.)
    expect(gateway.calls.every((call) => call.transform === 'strip-picture-metadata')).toBe(true);
  });
});
