# nova3D

A private web app, open only to invited Google accounts, that turns an idea or a few pictures into a printable model. This repository is the qualified application seed: a Next.js 16 App Router shell with Google sign-in through Supabase Auth and a **synthetic dashboard**. Nothing in the dashboard is saved, and no provider is called.

## Run it

Needs Node 24 (`engines` allows any 24.x and `.npmrc` enforces it; `.nvmrc` and CI pin 24.21.0, and Vercel supplies its own Node 24 patch), Docker and the Supabase CLI.

```sh
npm ci
supabase start                    # local Postgres, Auth and API on loopback ports
node scripts/setup-env.mjs local  # writes .env.local, including INSTANCE_ID
npm run dev                       # http://127.0.0.1:3000
```

| Command | What it does |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run build` | static checks and a credential-free production build |
| `npm run check:env -- --live` | verifies `APP_ENV` and `INSTANCE_ID` against the database's identity row |
| `npm test` | Vitest unit and integration suites (integration needs `supabase start`) |
| `npm run test:env` | the environment guardrails, against fixture environments |
| `npm run test:e2e` | Playwright browser flows against a production build |
| `node --env-file-if-exists=.env.staging scripts/check-provisioning.mjs --story <id> --env staging` | reports which external accounts, keys and spend limits due by that story are still missing (see below); `npm run check:provisioning -- --story <id> --env staging` loads the same file itself |
| `npm run render:provisioning` | renders `provisioning/ledger.json` to `docs/provisioning.md` (CI checks it is current) |

Production builds use webpack (`next build --webpack`), as the seed already did. The [stack qualification report](_bmad-output/implementation-artifacts/qualification-2026-09-14/stack/qualification-report.md) records clean default (Turbopack) and webpack production builds both passing on the pinned package set, and a prerender failure that appeared only in an earlier non-clean staging harness, with its exact cause not established.

## Environment boundaries

There are three environments: `local`, `staging` and `production`. Each has its own Supabase project, secrets, Google OAuth client and callback domain, and each database carries one `lifecycle.instance_identity` row that `APP_ENV` and `INSTANCE_ID` must match. The server compares them at startup, and the Vercel deployment build compares them too for staging and production, so a mis-pointed deployment cannot run against another environment's data.

- `local` runs only against the Supabase CLI stack on a loopback URL.
- `staging` is the existing hosted Supabase project and its own Vercel project; only the `staging` branch deploys.
- `production` does not exist yet.
- Previews never read the database, so nothing compares their identity. They are kept away from real data by rejecting credential-like variables: the check fails if a preview holds any `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `DATABASE_URL`, `POSTGRES_*` or `STRIPE_*` variable, or enables paid adapters.

Details, the staging promotion flow and the Vercel settings that only Josh can change are in [docs/deployment-setup.md](docs/deployment-setup.md). Sign-in setup is in [docs/auth-setup.md](docs/auth-setup.md).

## External accounts and secrets

Accounts, keys and spend limits that only Josh can create are recorded in a machine-readable ledger, `provisioning/ledger.json`, and rendered to [docs/provisioning.md](docs/provisioning.md) with how-to steps, the story that first needs each, and the free-tier limits the design relies on. The ledger holds names, dates and evidence references, never a value. `node --env-file-if-exists=.env.staging scripts/check-provisioning.mjs --story <id> --env staging` fails naming every item due by that story that is still missing, and ignores later ones; everything starts pending. Keys for `local` and `staging` are checked by presence from `.env.local` and `.env.staging`; a production secret never sits in a local file, so production items are attestations. The keys the application generates itself, with their owner, location, rotation procedure and cadence, are in [docs/secrets.md](docs/secrets.md).

## Modules and ownership

The application is a modular monolith. The architecture (AR-2) makes each module the only writer of its own records and has invariants that span modules use coordinated Postgres transactions; nothing in the seed enforces that yet, because the seed has one table. Next.js handles commands and web delivery. Trusted Railway workers will handle geometry, validation, export and large-file delivery, and models only propose validated data, never executable scripts. Later stories introduce their own entities; this seed adds only what start-up needs.

| Module | Owns | In the seed |
| --- | --- | --- |
| Lifecycle | environment identity, restore ledger, tombstones | `lifecycle.instance_identity` (the only table), `lib/environment.ts`, `instrumentation.ts`, `scripts/check-env.mjs` |
| Identity | Accounts, sessions, invitations, audit events | interim Google sign-in and email allowlist: `lib/auth*.ts`, `lib/supabase/`, `proxy.ts`, `app/login/`, `app/auth/callback/` (Story 1.3 replaces the allowlist) |
| Projects, Evidence, Geometry, Manufacturing, Artifacts, Jobs, Usage and notifications | their own records | nothing yet |
| Preferences | language, light or dark, explanation detail and first-use guidance | four first-party device cookies (`nova3d-locale`, `nova3d-theme`, `nova3d-detail`, `nova3d-guidance`): `lib/preferences.ts`, `lib/preferences.server.ts`, `components/preferences-provider.tsx`; Story 1.4 adds the Account-owned record |
| Interface (shell, localization, design tokens) | the shared tokens, English and Hebrew catalogs, and the accessible patterns every screen inherits | `app/globals.css`, `lib/i18n/`, `components/ui/`, `components/shell/`, `app/settings/`; the Hebrew catalog is a machine-drafted first pass awaiting native review (see `deferred-work.md`) |
| Synthetic shell | nothing persisted | `components/nova-dashboard.tsx`, `lib/mock-data.ts`; later stories replace it |
| Design kit | nothing persisted | `app/kit/`, `components/kit/`: shows the tokens, patterns and a bilingual sample so tests can reach the shell without signing in; without `SYNTHETIC_DATA_ENABLED=true` (which production forbids) it is not public: a signed-out visitor is redirected to sign-in and a signed-in one gets a 404 |

Qualification probes for the engineering gates live in [tools/qualification](tools/qualification/README.md).
