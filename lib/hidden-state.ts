// Story 1.8. The hidden-state contract: how a device (or any holder of an earlier answer) combines the status replies it gets
// about one target. It has NO imports and touches nothing of the server, so a browser, a worker and the tests all use this one rule.
//
// A status reply is `{state, revision}`: `active`, `disabled` or `deleted`, and the target's monotonic revision.
//   * An Account's revision is its authorization epoch.
//   * A Project's revision is its own revision PLUS its Account's authorization epoch. Both only rise, so the Account's disable and its
//     re-enable each give the Project's next reply a higher number, and a Project that is `disabled` because its Account is turns
//     `active` again by the rule below (a rename raises it too).
//   * A tombstone's revision is the revision it was recorded at. `deleted` is terminal, so that number never lifts anything.
//
// The rule, in order:
//   1. `deleted` is terminal. A target known to be deleted is never replaced, by anything; and a `deleted` reply always
//      applies, whatever its revision (a tombstone is never downgraded, and never held back by an older number).
//   2. Otherwise the HIGHER revision wins, and a lower revision never replaces a higher one: a stale reply that arrives late
//      cannot undo what a newer one said.
//   3. At EQUAL revisions the more restrictive state wins: deleted over disabled over active. So an `active` reply that merely repeats
//      the number of a `disabled` one never lifts it: only a reply that carries a HIGHER number does. A Project's reply after its
//      Account's re-enable does (its revision includes the Account's epoch, which the re-enable raised).

export const hiddenStates = ['active', 'disabled', 'deleted'] as const;
export type HiddenState = (typeof hiddenStates)[number];

/** What the status route answers for a handle it knows, and what a device keeps for the target. */
export type StatusReply = {state: HiddenState; revision: number};

/** How restrictive a state is: the order at equal revisions. */
const restriction: Record<HiddenState, number> = {active: 0, disabled: 1, deleted: 2};

export function isHiddenState(value: unknown): value is HiddenState {
  return typeof value === 'string' && (hiddenStates as readonly string[]).includes(value);
}

/** A reply as the status route sends it, checked; null for anything that is not one. */
export function parseStatusReply(value: unknown): StatusReply | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const {state, revision} = value as Record<string, unknown>;
  if (!isHiddenState(state) || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return null;
  return {state, revision};
}

/**
 * What to believe about a target after a new reply: the known answer (null if there is none yet) and the reply, merged by the rule
 * above. Pure: it returns one of its two arguments and changes neither.
 */
export function mergeStatus(known: StatusReply | null, reply: StatusReply): StatusReply {
  if (known === null) return reply;
  if (known.state === 'deleted') return known;
  if (reply.state === 'deleted') return reply;
  if (reply.revision > known.revision) return reply;
  if (reply.revision < known.revision) return known;
  return restriction[reply.state] > restriction[known.state] ? reply : known;
}
