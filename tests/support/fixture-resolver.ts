import type {ResolveInput, Resolver} from '../../workers/files/src/resolvers';

// The test-only fixture resolver of Story 1.12. The gateway's resolver registry (workers/files/src/resolvers.ts) maps a kind of target to a function that
// answers whether an Account may move the bytes of one target now, and where they are. Production registers `staging`; the stories that attach files to a
// Project (1.7's wiring), retained pictures (2.12), artifact manifests (4.1) and exports (6.9) register theirs. Until then this stands in for "another kind
// of target" in the tests, so that the registry itself, a kind with no resolver, and a target whose state changes between two chunks can all be shown
// without a Project: register it with `createResolvers({[fixtureKind]: fixture.resolver})`.

export const fixtureKind = 'fixture';

export type FixtureTarget = {
  /** Where its bytes are in the bucket (a validated `staging/<account>/<id>` or `objects/<account>/<root>` key). */
  key: string;
  length: number;
  contentType: string;
  etag: string;
};

export function createFixtureResolver() {
  const targets = new Map<string, FixtureTarget & {available: boolean}>();
  const asked: ResolveInput[] = [];
  const idOf = (accountId: string, targetId: string) => `${accountId}/${targetId}`;

  const resolver: Resolver = async (_query, input) => {
    asked.push(input);
    const target = targets.get(idOf(input.accountId, input.targetId));
    // Another Account's target, an unknown one and one that has become unavailable are one answer, with nothing in it.
    if (!target?.available) return {outcome: 'unavailable'};
    return {outcome: 'allowed', key: target.key, length: target.length, contentType: target.contentType, etag: target.etag};
  };

  return {
    kind: fixtureKind,
    resolver,
    /** The questions the registry has asked, in order. */
    asked,
    /** A target of the Account, available. */
    add(accountId: string, targetId: string, target: FixtureTarget) {
      targets.set(idOf(accountId, targetId), {...target, available: true});
    },
    /** Changes whether the target is there, between two chunks of a transfer. */
    setAvailable(accountId: string, targetId: string, available: boolean) {
      const target = targets.get(idOf(accountId, targetId));
      if (!target) throw new Error('no such fixture target');
      target.available = available;
    },
  };
}
