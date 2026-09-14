# nova3D

The nova3D web application. Real routing, real auth gate, real state — running
against an in-memory backend that is designed to be deleted.

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck
```

Sign in with any email in the seed (`josh@nova3d.local`) and **any** password.
Type `wrong` as the password to see the failure state.

---

## The point of the structure

This is not a mockup with a nav bar bolted on. It is the application, with one
layer swapped out:

```
src/
  api/              ← the seam. Replace `mock/` with HTTP and stop.
    types.ts          the domain contract — survives the swap untouched
    client.ts         transport. `request()` becomes `fetch()`. One file.
    index.ts          the resource modules features actually call
    mock/             DELETE THIS DIRECTORY when the backend lands
  store/            client state: subscribes to the backend, exposes hooks
  features/         one folder per product area, routed
  components/
    ui/               primitives (Btn, Field, Value, Notice, …)
    nova3d/           the components DESIGN.md names (GatePanel, StatusToken, …)
    layout/           AppShell + the two content shells
  styles/           design tokens and the component layer
  lib/              i18n, useAction
  routes.tsx        the route table
```

**Nothing outside `src/api/` imports from `src/api/mock/`.** Features call
`api.plans.approve(projectId)` and get a promise. When that promise is backed by a
real server instead of a `setTimeout`, no feature file changes.

### What "no rewriting later" actually means here

- **Every api call is already async** and already throws `ApiError` with a code.
  Features already handle pending and error states through `useAction()`.
- **Reads return snapshots; writes return void and the store refetches.** That is
  how a real client behaves. Swapping in HTTP does not change a call site.
- **`needsConnection` is already declared per call.** The offline capability table
  (NFR-19) is encoded in `src/api/index.ts`, not scattered through components.
- **Gates are enforced in the backend, not just in `disabled` attributes.**
  `approvePlan` throws if a disputed reading is undecided. A gate that only exists
  in the UI is not a gate, and the real backend must keep enforcing it.
- **`Verified<T>` is a wire type, not a fixture convenience.** See below.

---

## The rule that matters most

**Nothing here invents evidence.**

Every Source passage, citation, translation, dimension, price, retention period,
layer count, duration and file size renders as *verified content pending* or
*value pending*.

This is enforced in the type system. Anything that must come from a Source, a
provider, a slicer or a machine is typed `Verified<T>` and may be `PENDING`; the
`<Value>` component prints the pending phrase and cannot print a substitute.

`PENDING` is not a placeholder for the mock. It is the wire format for **"not
known"**, and the real backend will return it — a provider that has not stated its
retention, a spool whose tag could not be read, a check that needs the unratified
AD-3 rule set. The UI must keep handling it after the swap.

Do not fill a `PENDING` with a realistic-looking value to make a screen look
finished. That is the single failure mode nova3D exists to prevent.

---

## The flow you can actually drive

The seed starts the altar Project mid-flow so the gates are demonstrable:

1. **`/projects/p-altar/plan`** — the Research Plan. One disputed reading is
   undecided, so Plan Approval is blocked and says why.
2. **Decide it** (`/projects/p-altar/plan/claims/cl-horn-form`) — this creates a
   new Plan revision. Any approval bound to the old one is withdrawn in place.
3. **`/projects/p-altar/plan/approve`** — the gate opens. Approving starts a
   generation Job.
4. **`/jobs`** — watch it run. Leave the page; it keeps going.
5. **`/projects/p-altar/model`** — a Version now exists, read-only, every feature
   traced to its Claims.
6. **`/projects/p-altar/model/approve`** — the second gate. Export and printing
   are blocked until this passes.
7. **`/projects/p-altar/export`** then **`/projects/p-altar/print`**.

Other things worth doing because they exercise real state:

- **Reject a Source** on a Claim or in a running research Job → affected Claims are
  invalidated, a new Plan revision is created, and replacement research starts.
- **`/printers/pt-a1` → Simulate a detected problem** → the print pauses and the
  problem alert appears with its frames and three real exits. *False alarm* deletes
  the frames and says so.
- **Toggle Offline** in the top bar → research, sending and watching state that
  they need a connection; reading, inspection, both gates and slicing keep working.
- **`/settings/appearance`** → dark mode, text size, contrast, reduced motion.
- **`/settings/language`** → set direction to right-to-left, independently of
  language. The whole shell mirrors; identifiers and dates stay LTR.

---

## Conventions worth keeping

**Two content shells.** `StepShell` for anything that asks one question and takes
one action. `WorkspaceShell` where a viewport or a long document must stay on
screen. Screens do not invent a third.

**One primary action per screen.** `ActionBar` takes exactly one, and a disabled
primary must be given a `blockedReason`. There is no way to render a greyed-out
button with no explanation without going around the component.

**State is a word and a shape before it is a colour.** `StatusToken`,
`JobStateToken` and `PrintStateToken` each render a glyph and a word. Nothing is
distinguishable by colour alone.

**Pairs that must never merge.** Plan Approval and Model Approval (one component,
never one screen). Cached research and fresh research. Warning and blocking
failure. Per-Project Source rejection and Account-wide disabling. Camera presence
and Watching. The components keep them apart; keep it that way.

**Logical CSS properties throughout** — `border-inline-start`, `padding-inline`,
`text-align: start`. RTL is a supported layout, not a mirrored afterthought.
Identifiers, measurements, dates and file extensions stay LTR inside mirrored text
via `<Ltr>`, never by reversing a string.

**Every user-facing string goes through `lib/i18n.ts` or is a prop.** No
concatenated sentence fragments — a sentence is one key. AD-15 has not chosen the
real mechanism, so `translate()` is shaped to be swapped behind its call sites
rather than at them.

---

## Screens that assume an unratified decision

Nine architecture decisions (`AD-8` … `AD-16` in `prd.md`) are gated and unratified.
Screens depending on one say so in the interface copy, because "we do not know this
yet" is something the user is entitled to see.

| Decision | Where it surfaces |
| --- | --- |
| AD-3 · printer profile rule set | `/projects/:id/export` — dependent checks report **unknown**, never *passing* |
| AD-8 · per-vendor printer integration | `/projects/:id/print`, `/printers/:id`, `/admin/printers` |
| AD-9 · problem-detection model | `/prints/:id` — the alert exists; the detector does not |
| AD-10 · slicing engine | `/projects/:id/print/slice` |
| AD-11 · spool-tag reading | `/printers/:id`, slice view |
| AD-14 · push delivery | `/settings/notifications` |
| AD-16 · accessibility conformance method | `/settings/appearance` |

---

## Replacing the mock backend

1. Rewrite `request()` in `src/api/client.ts` as `fetch`. Keep the `ApiError`
   shape and the `needsConnection` behaviour.
2. Point each function in `src/api/index.ts` at its endpoint. The signatures do
   not change.
3. Delete `src/api/mock/` and the `devtools` export.
4. Replace the `api.subscribe` effect in `src/store/workspace.tsx` with a socket or
   a poll. The refetch shape is already correct.
5. Keep `Verified<T>`, `PENDING` and `<Value>`. They are the mechanism that stops a
   plausible number reaching a user as though it were researched.

Nothing in `features/`, `components/` or `styles/` should need to change.

---

## Provenance

- `docs/screen-map.md` — every screen ID in `SCREEN-INVENTORY.md` mapped to its route.
- `DESIGN.md` — the visual contract; source for every token and component.
- `EXPERIENCE.md` — the narrative these screens serve.
- `prd.md` — requirements.
- `_bmad-output/.../imports/claude-design-8bb862aa/` — the native Claude Design
  sources, including all seven mockup files and the Broadsheet design system.
