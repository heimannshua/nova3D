---
title: 'Story 2.4: Set accountable usage limits'
type: 'feature'
created: '2026-10-19'
status: 'in-progress'
baseline_commit: '661412318070aa143f3e5dd481db9930ff715bba'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-4/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-2-4/implementation-constraints.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-5-disable-and-re-enable-account-access.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-11-manage-invitations-with-fresh-authentication.md'
  - '{project-root}/docs/authority-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing records what an Account may spend, and the Administrator cannot see or change it. Paid work (Stories 2.5 to 2.8) needs a monthly limit to reserve against, and changing it must need fresh authentication and leave an accountable record.

**Approach:** A Usage-owned family of immutable monthly periods per Account, created with the Account at $25 (invitee) or $50 (Administrator) in integer microdollars. A fresh-authenticated Administrator changes or resets a limit by appending a successor period that carries liabilities. A new Usage and limits screen shows each Account's settled, reserved and available amounts. Settled and reserved come through one stand-in until Stories 2.6 to 2.8.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). No new npm dependency, environment variable, secret or `route.ts`; Server Actions only. Money is integer USD microdollars (`bigint` in SQL, a safe integer in TypeScript), never a float; dollars appear only through one deterministic formatter (`$25.00`, no `Intl`, shown as an LTR token). **Periods:** new closed schema `usage` (as `identity`, `projects`, `artifacts`) with `usage.periods`: `id`, `account_id` (to `identity.accounts`, restrict), `seq` (from 1), `month_start` (the UTC first of the month; `date_trunc('month', clock_timestamp() at time zone 'UTC')`, never the session time zone), `limit_microdollars` (0 to 10,000,000,000, that is $10,000, a multiple of 10,000, that is whole cents), `carried_settled_microdollars`, `carried_reserved_microdollars` (at least 0), `cause` (`initial`, `month`, `change`, `reset`), `previous_limit_microdollars` (null for `initial`), `actor` (`user:<id>` or `system`), `command_id` (null unless an Administrator command), `digest`, `created_at`; unique `(account_id, seq)` and `(account_id, command_id)`; update and truncate refused by trigger, delete allowed (Epic 8 purge). The current period is the highest `seq`; no row is ever edited, and the row IS the immutable record of actor, time and old and new limits. **Defaults:** `usage.default_limit(role)` returns 25,000,000 for a member and 50,000,000 for the Administrator; `identity.activate_account` is re-created to create the `initial` period in its transaction, and the migration backfills every existing Account. **Rollover is lazy:** internal `usage.ensure_period(account)`, under the advisory lock `nova3d:usage:<account>` (the lock Story 2.6 reuses), appends a `month` period when the latest `month_start` is before the current UTC month (same limit, carried settled 0, carried reserved = the previous carry plus its reserved figure); every Usage `api` function calls it first; no scheduler task. **Figures:** settled and reserved of a period come only from `usage.period_figures(period_id)`, a stand-in over the owner-written table `usage.fixture_figures(period_id, settled_microdollars, reserved_microdollars)`, empty (so zero) in every real environment and written by no application code or `api` function; Story 2.6 replaces the function body and drops the table. Shown settled = carried settled + figure; shown reserved = carried reserved + figure; used = settled + reserved; available = max(limit − used, 0); when used exceeds the limit the screen also shows the amount over, so the four amounts always reconcile. **State** by integer arithmetic only: `under` (used×5 < limit×4), `nearly` (used×5 ≥ limit×4 and used < limit), `reached` (used ≥ limit, a limit of 0 included). `reached` means new paid work is blocked; the screen says running work finishes and that disabling an Account still cancels it; internal `usage.available_microdollars(account)` returns the allowance headroom for Story 2.6 (credit joins in 2.14). **Command** `api.set_usage_limit(p_actor, p_admin_account_id, p_epoch, p_target_account_id, p_command_id, p_kind 'change'|'reset', p_limit_microdollars, p_expected_seq)`, in this order: arguments (22023); `identity.assert_operation_authority` for the Administrator (`denied`); the caller is an Administrator (`denied`); the target exists and has no tombstone (`not_found`); advisory lock; the target is disabled (`disabled`); `ensure_period`; the receipt by `(target, command_id)`: the same digest replays (`replayed`, the same period), another digest is `reused`; the latest `seq` is not `p_expected_seq` (`stale`, carrying the current `seq`); the limit is out of range, not whole cents, missing for `change` or given for `reset` (`invalid_limit`); a `change` to the current limit is `unchanged` and appends nothing; otherwise it appends `seq+1` and calls `identity.record_audit(p_actor, 'usage.limit_changed' | 'usage.limit_reset', 'account:<target>')` in the same transaction. **Carry:** `change` keeps counting everything so far (carried settled = previous carry + its settled figure, carried reserved likewise); `reset` restarts the count but keeps liabilities (carried settled 0, carried reserved as for `change`) and keeps the current limit; so already-reserved work keeps its reservation across both. **Gate:** the fresh administration marker is checked in TypeScript by `administered()` (`lib/administered.ts:44`), the only gate, and a refusal changes nothing; refusals are recorded, once an hour per actor and target, by the new `api.record_usage_refusal(p_user_id, p_action 'usage.limit_refused'|'usage.denied', p_target_account_id)` (as `record_invitation_refusal`), not by widening `record_account_refusal`. **Read** `api.list_usage(p_admin_account_id, p_epoch)`: `denied` unless an active Administrator, calls `ensure_period` for each Account, returns at most 200 Accounts in `list_accounts` order with `accountId`, `email`, `role`, `status` and the current period's `seq`, `monthStart`, limit, shown settled, shown reserved and `cause`; nothing else. **Screen** `/admin/usage` under `requireAdministrator()`: the Administration index gains a fourth section; one card per Account (no table), with month (UTC), limit, settled, reserved, available, the amount over when over, a state badge carrying a word and a shape, a meter with a text equivalent, a dollar field for "Change limit" (whole cents) and a confirmed "Reset" action; the command ID is made once per form and survives a double press; no marker shows the existing step-up notice, and the step-up return stays `/admin`. Every message has a remedy in both languages; the Hebrew has no Latin word (no "USD", no "UTC"). Readable and operable at 320 px, at 200% text, with 44 px targets, on phone and desktop.

**Ask First:** The 10,000,000,000 ceiling or the cent granularity; allowing a change for a disabled Account or a limit below what is used; any change to the marker's life or the step-up return path; a scheduler task for rollover; a new route, dependency, environment variable or secret; writing `usage.fixture_figures` from application code; any step against staging, production, Railway, GHCR or Backblaze.

**Never:** Reservations, settlements, rates, provider permissions, credit, payment requests or notifications (Stories 2.5 to 2.17); editing a period; old or new limits in a column of `identity.audit_events` (its five columns are pinned); usage on the Accounts list; a fixture figure shown by application code; changing Account disable or its cancellation; editing an expectation to make a test pass except the pins this spec names.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Defaults | An invitee and the Administrator are activated | `initial` periods of 25,000,000 and 50,000,000 for this UTC month; existing Accounts backfilled | N/A |
| Change | Limit 25M, used 10M, change to 40M | Period `seq+1`, `change`, previous limit 25M, carried the 10M; old row untouched; one audit event for the actor and Account | N/A |
| Reset | Used 10M settled, 2M reserved; reset | `reset` period: carried settled 0, carried reserved 2M, same limit; available 23M | N/A |
| Lower below used | Used 20M; change to 10M | Accepted; used 20M, available 0, 10M over, state `reached` | N/A |
| Thresholds | Limit 25M; used 19,999,999 / 20M / 25M; limit 0 | `under` / `nearly` / `reached`; 0 is `reached` | N/A |
| Rollover | First Usage call in a new UTC month | One `month` period: same limit, settled carry 0, reserved carry kept; a second call adds none | N/A |
| Reconcile | Any state | settled + reserved + available = limit, or limit + over = used | N/A |
| No fresh marker | Change or reset with none, an expired or a stale one | Refused, step-up offered for none and expired; nothing appended; refusal recorded once an hour | Step up, retry |
| Not an Administrator | A member, a stale epoch or a disabled caller | `denied`, 404 on the page; nothing appended | N/A |
| Stale | `expected_seq` is old | `stale` with the current `seq`; nothing appended | Reload |
| Replay / reuse | The same command ID twice / with another limit | `replayed`, the same period / `reused`; one period | N/A |
| Invalid limit | Negative, 12.345, over the ceiling, text, missing | `invalid_limit` or a form message; nothing appended | Fix the field |
| Unchanged | `change` to the current limit | `unchanged`; no period, no audit | N/A |
| Target | Disabled / unknown / tombstoned Account | `disabled` / `not_found`; nothing appended | Re-enable first |
| Disable at limit | An Account at its limit is disabled | Disable and cancellation behave as before; its usage stays readable | N/A |
| Immutability | Update or truncate a period | Refused | N/A |
| Read fails | The database is unreachable or answers nonsense | The screen says it could not be loaded; no number is invented | Retry |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261022120000_usage_limits.sql` -- new. Closed-schema block as `file_gateway.sql:57-65`; immutable-family triggers as `request_revisions.sql:144-156`; `identity.activate_account` is `accounts.sql:288-301` (callers: `api.register_with_code`, `api.consume_preauthorization`); `identity.record_audit` :230 (action `^[a-z][a-z_]*(\.[a-z][a-z_]*)+$`, target `kind:<id>`); command shape from `account_administration.sql:89` (`disable_account`) and `projects.sql:254` (`rename_project`: arguments, `assert_operation_authority` in `begin/exception when sqlstate 'N3010'`, advisory lock, receipt, stale); sibling refusal recorder `invitation_refusals.sql:35-85`; `api.preflight` is re-created (latest `retained_pictures.sql:989`, 38 signatures; grows to 41; raise `N3020` for the Story 2.4 block); end with `notify pgrst, 'reload schema'`. `docs/staging.md:61-79` needs a migration row in order (`staging-guide.test.ts:31-50`).
- `lib/usage.ts` -- new; the only caller of the three new `api` functions (add it to the four `callApi`/`callRow` allow-lists, `gate-structure.test.ts` :1029, :2259, :2581, :2952, on purpose); follow `listAccounts`/`disableAccount` (`lib/accounts.ts:991`, :1027) for typed validation and `checkMarker` (:777) for the marker outcomes. `lib/usage-view.ts` -- new, client-safe and pure: microdollar parse and format, `classify`, reconcile, the state-key map and an `attempt…` action wrapper (as `lib/account-admin.ts:58-94`).
- `app/admin/usage/page.tsx`, `actions.ts`; `components/admin/usage-content.tsx`, `usage-list.tsx` -- clone `app/admin/accounts/page.tsx` (guard, `generateMetadata`, `readConfirmation(access.user)`, a `readList()` that returns null on error) and `app/admin/accounts/actions.ts:44-115` (`administered(...)` around the typed call, `recordRefusal`); UI pieces `components/admin/account-failure-notice.tsx`, `StepUpNotice`, `Notice`, `StatusBadge`, `ConfirmDialog`, `LtrToken`, `use-account-action.ts`; `lib/project-pages.ts` for a cached loader union. `components/admin/admin-content.tsx:13` `areas` gains the fourth entry. A meter needs a new component (`.progress-track`/`.progress-fill` exist, `globals.css:662`, unused); rules at `globals.css:874` show the stacking pattern. Command IDs: `lib/request-view.ts:182` `commandIdFor`.
- `lib/i18n/en.ts`, `he.ts` -- `meta.usage`, `usage.*`, `admin.usage.{title,help,open}`; parity and plural rules `i18n.test.ts:19-70`; Hebrew cannot hold "USD"/"UTC" (use the existing "זמן עולמי" wording). Stale copy: `accounts.list.help` (en :660) says "never projects, files or usage" and stays true.
- Pins to change on purpose: `gate-structure.test.ts` :781-782 (drop `app/admin/page.tsx` and `components/admin/admin-content.tsx` from the `\busage\b` ban; keep it for the Accounts files), :680-682 (callers of `administered(` and `readConfirmation`), :446 (files that must not name `checkMarker`), the route list (:2597, :3135: still seven), `page-guards.test.ts:28` and :65 (add the page); the Administration index is exactly three sections (`accounts-page.test.tsx` ~:140, `accounts.spec.ts` ~:118, `operations.spec.ts` ~:108); the 38-signature count `toHaveLength(38)` (`alarms.test.ts:903`, `file-gateway-db.test.ts:1762`, `request-revisions.test.ts:1369`, `picture-sets.test.ts:1690`); `accounts.test.ts:53` sorted `apiFunctions`, :30-52 and :133 table lists; `isolation.test.ts` ~:150-225 (a body per `api` function) and :690, :772, :813, :885 (`closed` schemas gain `usage`); owner-privilege simulations (`account-administration.test.ts:934,960`, `scheduled-jobs.test.ts:1158,1178,1216`, `session-grants.test.ts:1195-1210`, `file-gateway-db.test.ts:1828-1876`); cleanup `tests/support/accounts-data.ts:92-118` and `forged-session.ts:326-339` must delete `usage` rows before the Account. Do not touch the step-up return path (`tests/unit/step-up.test.ts:47`, `step-up.spec.ts:132`).
- Tests to copy: `tests/unit/account-admin-actions.test.ts` (order role → marker → change → refresh), `accounts-page.test.tsx` (both locales), `tests/e2e/accounts.spec.ts` (404 for a member, no marker :192-263, dialog, 4-variant axe, 320 px at 200%, Hebrew RTL, keyboard) with `accountsWorld()` (`tests/support/forged-session.ts:17`: `forgeMarker`, `makeAdministrator`, `auditBy`), `tests/support/e2e-helpers.ts`. Fixtures for `nearly` and `reached` are rows in `usage.fixture_figures` inserted by the owner.
- Left for others: Story 2.6 replaces `usage.period_figures`, drops the fixture table, takes the same advisory lock, and registers the cancellation that releases reservations (`lib/authority.ts:135`); 2.14 adds credit to `usage.available_microdollars`; the owner's Credit and payments page is 2.14 to 2.16; Epic 8 purges periods.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/20261022120000_usage_limits.sql`, `docs/staging.md` -- the schema, periods, defaults and backfill, `activate_account`, rollover, figures stand-in, the three `api` functions, preflight, migration row -- AC-1 to AC-4
- [ ] `lib/usage.ts`, `lib/usage-view.ts` -- typed calls, money parse and format, state and reconcile, action wrapper -- AC-1 to AC-4
- [ ] `app/admin/usage/page.tsx`, `app/admin/usage/actions.ts`, `components/admin/usage-content.tsx`, `components/admin/usage-list.tsx`, `components/admin/admin-content.tsx`, `app/globals.css` -- the screen, meter, forms, step-up refusal -- AC-2 to AC-4
- [ ] `lib/i18n/en.ts`, `lib/i18n/he.ts` -- all copy in both languages -- AC-3, AC-4
- [ ] `README.md`, `docs/authority-contract.md` -- the Usage module row, the period and carry rules, the stand-in, rollout -- housekeeping
- [ ] `tests/` -- every matrix row: unit (money, thresholds at the edges, reconcile, carry arithmetic, the action order), integration (defaults and backfill, change, reset, rollover, stale, replay, reuse, invalid, unchanged, disabled, unknown, authority, isolation, immutability, closure, preflight), component (every state in both locales), browser on desktop and phone in both languages with the real database (no marker, step-up, change, reset, nearly, reached, axe, overflow, 200% text, keyboard); update the pins above -- all ACs
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- the fixture stand-in until 2.6, the $10,000 ceiling, no scheduler rollover, no usage history view, limits for disabled Accounts -- housekeeping

**Acceptance Criteria:**
- Given a new Account, when its allowance period is created, then an invitee has $25 and the Administrator $50 for the UTC month, stored as integer microdollars, and existing Accounts have the same.
- Given liabilities and settled usage, when a fresh-authenticated Administrator changes or resets a limit, then a successor period carries the liabilities, no earlier row changes, already reserved work keeps its reservation, and the period and an audit event record the actor, time and old and new limits.
- Given usage at or above 80% of the limit, or reaching it, when it is displayed, then settled, reserved and available reconcile, new paid work is shown as blocked, disabling an Account still revokes its work, and the screen is readable on phone and desktop.
- Given a limit change with no fresh administration marker, when it is submitted, then it is refused, nothing changes and the step-up is offered.

## Spec Change Log

## Design Notes

A limit change must not lose what was already counted, and a reset must not lose what is still owed, so the carry is stored on the successor and the arithmetic is the same everywhere. Settled and reserved are only an interface until Story 2.6; the fixture table lets every state be shown and tested without inventing the ledgers.

```
25M limit, 10M settled, 2M reserved:  change to 40M -> seq 2 carried 10M/2M, available 28M
                                      reset          -> seq 2 carried  0M/2M, available 23M
```

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase db reset && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (stack started as CI does, fake Google active) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- Sign in as the Administrator, open Administration, Usage and limits: each Account shows its month, limit, settled, reserved and available. Change a limit without confirming: the step-up is offered; after confirming, the change is accepted and the page shows the new limit.
