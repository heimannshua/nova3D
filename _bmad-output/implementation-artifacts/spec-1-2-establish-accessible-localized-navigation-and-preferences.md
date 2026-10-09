---
title: 'Story 1.2: Establish accessible localized navigation and preferences'
type: 'feature'
created: '2026-10-09'
status: 'done'
baseline_commit: 'c445af4283dc774358af178d89b9771dd0bcb95b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-2/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-2/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The shell is English-only with hard-coded colours, no dark mode, no right-to-left layout, no keyboard or screen-reader support, and no settings. Every later screen would inherit those gaps.

**Approach:** Add semantic design tokens (light default, explicit dark), a small dependency-free English and Hebrew catalog layer, device-stored preferences, accessible shell and shared patterns, and a Settings page, then move the synthetic shell and login page onto them.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). Light is the default and dark is chosen only explicitly, never from the OS. Use logical CSS directions, rem units and a system font stack. Preferences live in first-party cookies (`nova3d-locale`, `nova3d-theme`, `nova3d-detail`, `nova3d-guidance`) so the server renders the right `lang`, `dir` and theme on first paint; the Account-owned record arrives in Story 1.4. Technical-detail preference changes explanation depth only. Hebrew and English spans stay distinct with their own `lang` and `dir`. Touch targets are at least 44 px. Status uses text and shape as well as colour.

**Ask First:** Adding any runtime i18n or UI library; adding a third language.

**Never:** Add Account, database or auth changes. Follow the OS colour scheme automatically. Hard-code a user-visible string outside the catalogs. Present machine-drafted Hebrew as reviewed (flag it for Josh in `deferred-work.md`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Device language Hebrew | no cookie, `Accept-Language: he-IL` | `lang="he" dir="rtl"`, Hebrew copy | N/A |
| Unsupported language | `fr-FR` | English | N/A |
| Cookie wins | cookie `en`, device Hebrew | English | N/A |
| Tampered cookie | value not in the allowed set | ignored, default used | no error shown |
| Dark chosen | `nova3d-theme=dark` | `data-theme="dark"` in the first HTML, no flash | N/A |
| Guidance dismissed | dismiss, reload, then "Replay" in Settings | stays hidden, then returns | N/A |
| Missing catalog key | key in English absent in Hebrew | unit test fails | N/A |
| RTL | Hebrew | layout and direction icons mirror | N/A |

</frozen-after-approval>

## Code Map

- `app/layout.tsx` -- fixed `<html lang="en">`; make it read cookies and `Accept-Language`, set `lang`, `dir`, `data-theme`.
- `app/globals.css` (68 lines) -- hard-coded colours and physical directions; replace with tokens, logical properties, focus, `forced-colors`, `prefers-contrast` and `prefers-reduced-motion`.
- `components/nova-dashboard.tsx` (113 lines), `components/login-form.tsx`, `lib/mock-data.ts` -- English-only strings and navigation to move onto catalogs and shared patterns.
- `proxy.ts` -- `publicPaths` list; the design kit route is added only when `SYNTHETIC_DATA_ENABLED=true`.
- `tests/unit/synthetic-shell.test.tsx`, `tests/e2e/public-surface.spec.ts`, `playwright.config.ts` -- extend; projects `desktop` and `phone` exist.
- `package.json` -- add `@axe-core/playwright` pinned.

## Tasks & Acceptance

**Execution:**
- [x] `lib/i18n/` -- typed `en` and `he` catalogs, locale negotiation, `t()`, bidi-safe span helper -- AC-1, AC-3
- [x] `lib/preferences.ts` -- parse and serialize the four cookies against allowed sets; server and client readers -- AC-2
- [x] `app/globals.css` -- semantic tokens (surfaces, slate text, indigo actions, evidence and status colours, spacing, radii, elevation), dark set, high-contrast and reduced-motion rules -- AC-1, AC-3
- [x] `components/ui/` -- Button, StatusBadge, EmptyState, ErrorState, ConfirmDialog (native `<dialog>`), Announcer (polite live region), SkipLink, Guidance card -- AC-1, AC-3
- [x] `components/shell/` and `app/layout.tsx` -- global shell: Home, Notifications, Settings, Account and back; sidebar on desktop and a bottom bar on phone; My Projects, Create and In Progress stay primary -- AC-3
- [x] `app/settings/page.tsx` -- language, light/dark, simple/technical detail, onboarding replay; announces each change -- AC-2
- [x] `components/nova-dashboard.tsx`, `components/login-form.tsx`, `lib/mock-data.ts` -- use catalogs and patterns; keep the synthetic label -- AC-1
- [x] `app/kit/page.tsx`, `proxy.ts` -- synthetic-only design kit that shows tokens, components, states and a bilingual sample for tests; returns 404 unless `SYNTHETIC_DATA_ENABLED=true` -- AC-3
- [x] `tests/` -- catalog parity, negotiation and cookie parsing, token contrast ratios (text 4.5:1, UI 3:1, both themes), axe and keyboard flows on desktop and phone in English and Hebrew, 200% text and 320 px reflow -- all ACs
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- Hebrew copy needs native review before release -- housekeeping

**Acceptance Criteria:**
- Given a supported device language and no override, when the shell first opens, then it uses that language, light neutral/slate/indigo styling and dismissible guidance.
- Given a language, dark mode or technical-detail change, when selected, then it persists on the device, evidence and decisions are unchanged, and guidance can be reopened.
- Given keyboard, screen reader, 200% text, high contrast, reduced motion or Hebrew, when the shell is exercised on phone and desktop, then focus, names, announcements, contrast, reflow and directions keep every action usable.

## Spec Change Log

## Design Notes

The kit page exists because the real shell is behind sign-in and Story 1.4 supplies no test login; production cannot enable synthetic data (`check-env`), so the route is never public there. Server reads `cookies()` and `headers()` in the root layout, which makes pages dynamic; that is acceptable for a private app. Direction icons use `rtl:` mirroring via logical CSS, not duplicated assets.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `npm run test:unit` -- expected: catalog, preference and contrast tests pass
- `npm run test:e2e` -- expected: axe finds no violations; keyboard, Hebrew, dark, 200% text and 320 px flows pass on both projects

## Suggested Review Order

**Look and feel (tokens)**

- Light is the default; dark applies only when chosen, never from the OS.
  [`globals.css:16`](../../app/globals.css#L16)

- The explicit dark palette.
  [`globals.css:112`](../../app/globals.css#L112)

- High-contrast, reduced-motion and forced-colors rules.
  [`globals.css:173`](../../app/globals.css#L173)

**Languages (English and Hebrew)**

- The device language is matched from the browser's list, with a bad weight ignored.
  [`negotiate.ts:17`](../../lib/i18n/negotiate.ts#L17)

- Text lookup never throws, and names inside sentences are isolated so Hebrew and Latin do not scramble.
  [`index.ts:44`](../../lib/i18n/index.ts#L44)

**Preferences (kept on the device)**

- A saved choice is read back from the raw cookie, so a refused cookie is never reported as saved.
  [`preferences.ts:125`](../../lib/preferences.ts#L125)

- Cookies are validated against allowed values; a tampered one falls back to the default.
  [`preferences.ts:43`](../../lib/preferences.ts#L43)

**Shell and patterns**

- The shell: sidebar on desktop, bottom bar on phone, and menus that close on navigation.
  [`shell.tsx:116`](../../components/shell/shell.tsx#L116)

- Back link names its real destination.
  [`shell.tsx:42`](../../components/shell/shell.tsx#L42)

- Dialog closes on a real backdrop click only, not a drag that ends there.
  [`dialog.tsx:12`](../../components/ui/dialog.tsx#L12)

- A fallback page for when the root layout itself fails.
  [`global-error.tsx:15`](../../app/global-error.tsx#L15)

**Test surface (design kit)**

- The kit is public only when synthetic data is on, so tests can reach the shell.
  [`public-paths.ts:14`](../../lib/public-paths.ts#L14)

**Tests (supporting)**

- Browser checks for accessibility, keyboard, Hebrew, dark, 200% text and phone width.
  [`shell.spec.ts:92`](../../tests/e2e/shell.spec.ts#L92)

- Contrast ratios of every colour pair in all four palettes.
  [`design-tokens.test.ts`](../../tests/unit/design-tokens.test.ts)
