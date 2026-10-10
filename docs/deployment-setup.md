# Supabase and Vercel setup

nova3D runs in three environments with separate Supabase projects, secrets, Google OAuth clients and callback domains: `local`, `staging` and `production`. Project refs and credentials are supplied through the deployment platform or a git-ignored env file and are never committed.

| Environment | Supabase | Vercel | Deploys from |
| --- | --- | --- | --- |
| `local` | Supabase CLI stack (`supabase start`), loopback URL only | none | your machine |
| `staging` | the existing hosted project (the one the earlier mock-first deployment used) | its own project, production branch `staging` | the `staging` branch |
| `production` | not created yet | not created yet | disabled until a production project exists |
| previews | none: a preview is rejected if it holds any Supabase, database or Stripe variable | same project as staging | disabled (see below) |

## Environment identity

Each database has exactly one `lifecycle.instance_identity` row: an environment name and a random instance UUID. The application mirrors it with `APP_ENV` and `INSTANCE_ID`, and verifies the match:

- at server startup (`instrumentation.ts`); a mismatch, an unreachable database or a missing row stops the server with an exit code of 1;
- in `npm run check:env -- --live`, which CI runs against the local stack (and which also runs the accounts API preflight described below);
- in the Vercel deployment build (`prebuild` runs `check-env --deployment`, active only when `VERCEL` is set), which fails closed for staging and production. A preview build only runs the label and credential-variable checks described below.

Staging and production must use an `https` Supabase URL; local must use a loopback URL. At startup, a transient failure (network error, timeout, HTTP 5xx) is retried twice with a short backoff before the server stops; a mismatch, an absent row or an HTTP 4xx stops it at once. Errors name the mismatch, add a one-line fix, and never print a key or a UUID.

`next build` outside Vercel does not read the database, so local and CI builds stay credential-free.

`check-env --live` (and therefore the deployment build, never a preview) also runs a **preflight of the accounts API** (Story 1.3): it calls `api.account_status` for the nil UUID with the service role and expects `none`. It fails with one line, for example `the accounts API cannot be verified: ... answered HTTP 404 for api.account_status (is the api schema exposed, the Story 1.3 migrations applied and the service key right?)`, when the `api` schema is not exposed, the migrations are not applied, the key is wrong or the database does not answer. It does **not** tell whether the database is seeded: **an unseeded deployment passes the check and then locks everyone out, the Administrator included**, because the live-Account check lets in only an Account, and a pre-authorization or a code is how an Account starts. Seed before you deploy: `npm run seed:accounts -- preauthorize` for local, and for staging `node --env-file=.env.staging scripts/seed-accounts.mjs preauthorize --confirm staging` (safe to repeat: it reports `already pre-authorized` for an address that is, so it also shows what is seeded), then `list` the same way to see the invitations issued so far (it never prints a code). See "Provisioning staging", step 5.

**Previews are different.** A preview never reads the database, so nothing compares its identity with a row. It is kept away from real data by rejecting credential-like variables: the check fails if a preview or development deployment holds any variable named `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `DATABASE_URL`, `POSTGRES_*`, `STRIPE_*`, `INVITATION_HASH_KEY` or `RATE_LIMIT_HASH_KEY` (names are reported, never values), and it requires `PAID_ADAPTERS_ENABLED=false`, `SYNTHETIC_DATA_ENABLED=true` and `APP_ENV=staging`.

`ADMINISTRATOR_EMAIL` is required in every environment. Who may sign in is decided by the live-Account check (`docs/auth-setup.md`), not by a variable.

Story 1.3 adds `INVITATION_HASH_KEY` and `RATE_LIMIT_HASH_KEY`: required at startup in `local`, `staging` and `production` (the server stops, and the Vercel deployment build fails, without them), checked for shape (base64 text decoding to at least 32 bytes, different from each other once decoded). A preview or development deployment must hold neither key. It also adds the optional `SEED_ACCOUNT_EMAILS` (comma-separated member addresses, each at most 254 characters, for the seed command; unset in the templates on purpose).

## Local

```sh
supabase start                    # applies migrations, seeds the local identity row
node scripts/setup-env.mjs local  # writes .env.local from the stack, including INSTANCE_ID
npm run check:env -- --live       # confirms APP_ENV, INSTANCE_ID and the row agree, and the accounts API answers
npm run dev
```

`setup-env` replaces the Supabase URL, keys and `INSTANCE_ID` in an existing `.env.local` with the stack's (every duplicate, `export` lines included), leaves other lines alone, adds new template variables such as `ADMINISTRATOR_EMAIL`, and generates `INVITATION_HASH_KEY` and `RATE_LIMIT_HASH_KEY` when they are missing, placeholders or malformed (a valid key is kept, so invitation hashes already stored in the local database stay valid). When it replaces a hosted URL it first copies the old file to `.env.local.bak` (git-ignored, mode 0600) and never overwrites an existing backup; delete the backup when you no longer need those values. `supabase db reset` recreates the row with a new UUID; run `setup-env` again afterwards. A reset also empties the Accounts, invitations and pre-authorizations of Story 1.3; run `npm run seed:accounts -- preauthorize` again if you want your local addresses back.

**Never run `supabase db reset --linked` against staging or production.** It runs `supabase/seed.sql`, which would put a `local` identity row into the hosted project (and it resets the hosted database).

Tests: `npm test` runs the unit and integration suites (the integration suite needs the stack), `npm run test:env` exercises the environment guardrails against fixtures, and `npm run test:e2e` runs the browser flows against a production build (`npm run build` first) and the local stack. The registration and gating flows forge Google sessions in the local stack (see "Browser tests" in `docs/auth-setup.md`); they need the server to run with the keys in `.env.local` and refuse to run against anything but the local stack.

## Provisioning staging (Josh)

These are changes to the hosted project and the Vercel dashboard. The repository never makes them.

The other accounts, keys and spend limits that only Josh can create (Google OAuth clients, the Supabase plan, Resend, Upstash, Railway, the provider accounts and the rest) are tracked in [docs/provisioning.md](provisioning.md), each tagged with the story that first needs it. Check what is outstanding before starting a story with `node --env-file-if-exists=.env.staging scripts/check-provisioning.mjs --story <id> --env staging` (`npm run check:provisioning -- --story <id> --env staging` loads `.env.staging` itself). Production secrets are never checked from a local file. Keys the application generates itself are listed in [docs/secrets.md](secrets.md).

1. **Identity row.** In the Supabase SQL editor of the staging project, apply the migrations in `supabase/migrations/` in order (or run `supabase link --project-ref <ref>` and `supabase db push`), then insert the row once:

   ```sql
   insert into lifecycle.instance_identity (environment) values ('staging') returning instance_id;
   ```

   Keep the returned UUID; it is `INSTANCE_ID`. Never insert a second row, and never copy a row from another environment.
2. **Expose the schemas.** In Project Settings → API → Exposed schemas, add `lifecycle` (the server reads the row through the Data API with the service role; `anon` and `authenticated` hold no privileges on it) and `api` (Story 1.3: the only callable surface of Accounts and invitations; only the service role may execute its functions). Never expose `identity` or `projects`; they hold the tables.
3. **Auth settings.** Match `supabase/config.toml` as described in `docs/auth-setup.md`, including the Before User Created hook (`api.before_user_created`). The hook function exists only after step 1 has applied the Story 1.3 migrations (`*_accounts.sql`, `*_api.sql`).
4. **Hashing keys (Story 1.3).** Generate `INVITATION_HASH_KEY` and `RATE_LIMIT_HASH_KEY` on your own machine (`openssl rand -base64 32` each; two different values, never reused from another environment) and put them in the Vercel project's Production-scope variables and in your local, git-ignored `.env.staging`. Both are required: the application does not start, and the deployment build fails, without them. The seed command and `lib/accounts.ts` use them. See [secrets.md](secrets.md).
5. **Seed the accounts (Story 1.3).** With the migrations applied, `api` exposed and the keys in `.env.staging`, set `SEED_ACCOUNT_EMAILS` in `.env.staging` deliberately (the template leaves it commented out) and run `node --env-file=.env.staging scripts/seed-accounts.mjs preauthorize --confirm staging`. It pre-authorizes `ADMINISTRATOR_EMAIL` as the Administrator and every address in `SEED_ACCOUNT_EMAILS` as a member; running it again changes nothing. Each address becomes an Account at its first verified Google sign-in, in the sign-in callback. **Seed every address that is allowed in today before deploying Story 1.3 Part B**: the live-Account check replaces the old email list at once (the cutover steps are in `docs/auth-setup.md`). `issue --name <label>`, `issue --general`, `list`, `revoke` and `unauthorize --email` are the other commands (see `docs/auth-setup.md`). Every command is audited. Production seeding is decided in Story 8.7: production secrets are never read from a file on a laptop, so there is no `.env.production` to run the command with.
6. **Vercel project settings.**
   - Settings → Git → Production Branch: `staging`.
   - Settings → Environment Variables, Production scope: `APP_ENV=staging`, `NEXT_PUBLIC_APP_ENV=staging`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `INSTANCE_ID`, `ADMINISTRATOR_EMAIL`, `PAID_ADAPTERS_ENABLED=false`, `SYNTHETIC_DATA_ENABLED=true`, and the two hashing keys from step 4. Delete the variable whose name ends in `ALLOWED_EMAILS` (the old interim email list), if it is still there.
   - Preview and Development scopes: `APP_ENV=staging`, `NEXT_PUBLIC_APP_ENV=staging`, `INSTANCE_ID`, `ADMINISTRATOR_EMAIL`, `PAID_ADAPTERS_ENABLED=false`, `SYNTHETIC_DATA_ENABLED=true` and **no** variable named `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `DATABASE_URL`, `POSTGRES_*`, `STRIPE_*`, `INVITATION_HASH_KEY` or `RATE_LIMIT_HASH_KEY` (the Vercel Supabase integration adds several; remove them from these scopes). The check rejects a preview that holds one.
   - Leave Production deploys for `production` disabled until a production project exists.
7. Fast-forward `main` into `staging` (below) to trigger the first build.

Known consequence, accepted 2026-10-09: once `vercel.json` lands, `main` no longer deploys, and the Vercel project fails its build until `INSTANCE_ID` and `ADMINISTRATOR_EMAIL` are set there and the staging database has its identity row.

## Promoting to staging

`vercel.json` skips every ref except `staging` (`ignoreCommand`), disables Git deploys for `main`, and pins the build command to `npm run build` so a dashboard override cannot bypass the `prebuild` identity check. Promote by fast-forward:

```sh
git push origin main:staging
```

Never force-push `staging`. If the push is rejected as non-fast-forward, `staging` holds commits `main` lacks; resolve that on purpose first. Nothing yet protects the `staging` branch or requires CI to pass before it moves; that is recorded in `deferred-work.md` for Story 1.9. Because only `staging` builds, pull-request previews do not deploy; previews stay synthetic if the project ever enables them.

## Variable contract

`NEXT_PUBLIC_*` variables are browser-visible. `SUPABASE_SERVICE_ROLE_KEY` is server-only and belongs only in encrypted Vercel settings or a local ignored file. `.env.example`, `.env.staging.example` and `.env.production.example` document the contract. The check fails closed on missing or placeholder values, an `APP_ENV` that is not `local`, `staging` or `production`, `APP_ENV=local` against a non-loopback Supabase URL, a staging or production URL that is not `https`, a preview that is not staging or that enables paid adapters or disables synthetic data, a preview that holds any variable named `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `DATABASE_URL`, `POSTGRES_*`, `STRIPE_*`, `INVITATION_HASH_KEY` or `RATE_LIMIT_HASH_KEY`, and production with synthetic data. Placeholder detection matches `replace-with-…`, `<…>`, `changeme` and `todo` as whole values, so a real address such as `todos@example.com` is not rejected.

## Supabase restore

To resume the existing hosted project (staging) through the Supabase Management API, export a personal access token with project-admin write scope and run `SUPABASE_ACCESS_TOKEN=... node scripts/restore-supabase.mjs`. The script defaults to the staging project ref, never creates a replacement project, and reports the HTTP result without printing the token.

## Google sign-in

Google sign-in is credential-gated and configured per environment; see `docs/auth-setup.md`. The app has no temporary password fallback. A deployment without valid Google/Supabase configuration remains private and returns users to the login page.
