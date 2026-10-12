# Pushing to staging by hand

Until Story 1.9 builds the CI that does it, the staging database and its Auth settings are changed by hand with the Supabase CLI. This page is the whole procedure. It is written for Josh on Windows: every command is PowerShell (Windows PowerShell 5.1 or PowerShell 7), nothing needs a bash shell, and no command uses `&&`, `export` or a `\` line continuation.

**Do the whole procedure in ONE PowerShell window.** `$ref`, `$work` and the environment variables below live only in the window that set them; a new window starts without them. If you have to close it half way, open a new one, repeat "Before you start", step 2, and re-create the scratch copy of step 3 before you go on.

**Nothing in this repository applies anything to a hosted project.** Not the build, not `npm test`, not CI. The Vercel build only *checks* the database (`prebuild` runs `check-env --deployment`, whose accounts API preflight reads at most one row of each table the gate depends on and writes nothing). A deploy therefore fails with one line if a migration is missing; it never fixes it. You apply migrations, then settings, then seed the accounts, then deploy, in that order, and only you do it.

**Migrations and settings are not enough.** A deployment whose database has been migrated but not *seeded* passes the preflight and then locks everyone out, the Administrator included: the live-Account check lets in only an Account, and a pre-authorization or an invitation code is how an Account starts. Step 5 seeds it; do not skip it.

This procedure has been checked against the Supabase CLI's own help (version 2.120.0, the version CI pins), not against the hosted project: the first real run is also its first test. That is why every step that changes something shows you what it will change first. If anything on screen is not what a step says, stop and ask before answering `y`.

## Before you start

1. **Check what is outstanding.** The Story 1.4 items in [docs/provisioning.md](provisioning.md) are what this page needs: `supabase-organization-plan` (the project is active, on Pro, in the region the ledger records), `supabase-cli-credentials` (an access token, the database password and the project reference), `github-staging-environment` and `vercel-staging-project`. From the repository root:

   ```powershell
   npm run check:provisioning -- --story 1-4 --env staging
   ```

   It names every item due by Story 1.4 that is still missing, and prints no value. Story 1.11 adds one more, `hosted-step-up-and-invitation-check`, which is the hosted check of step 6 below (`--story 1-11 --env staging` lists it); it is due after this procedure, so it is not a prerequisite of it.
2. **Sign in, and give this window what it needs.** `supabase --version` should print 2.120.0 or newer. Nothing secret is typed where it would be shown on the screen or kept in the window's history:
   - The **access token** is the CLI's own business. `supabase login` opens your browser and the CLI keeps the token itself; you never put it in a command line, a file or an environment variable.
   - The **database password** goes to the CLI in an environment variable, read with `-AsSecureString` (the characters are not shown) and converted in this session only. If you leave these two lines out, the CLI asks for the password itself, with the characters hidden, each time it needs it.
   - `$ref` is the project reference from the staging project's General settings (20 lowercase letters, not a secret).

   ```powershell
   supabase login
   $ref = 'the-20-letter-staging-project-reference'
   $securePassword = Read-Host 'Staging database password' -AsSecureString
   $env:SUPABASE_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
   ```

   Take the password from your password manager. The staging database password is not the access token.
3. **Be on the commit you mean to deploy.** From the repository root, on `main`, with nothing uncommitted:

   ```powershell
   git status
   git log -1 --oneline
   ```

   The migrations pushed below are the ones in `supabase/migrations/` at this commit. The CLI applies exactly those files, so the commit decides what staging gets.
4. **Never** run `supabase db reset --linked` (it resets the hosted database and runs `supabase/seed.sql`, which would put a `local` identity row into it), and never pass `--include-seed` or `--include-roles` to `db push` (the seed is local-only; the hosted identity row is inserted once by hand, `docs/deployment-setup.md`, Provisioning staging, step 1). Do not edit a migration that any hosted project has already applied: add a new one.

## 1. Link the project and see what is pending

```powershell
supabase link --project-ref $ref
supabase migration list --linked
supabase db push --linked --dry-run
```

`link` takes the database password from `SUPABASE_DB_PASSWORD` (it asks for it, hidden, if the variable is not set) and records the project in `supabase/.temp/` (git-ignored). `migration list` has a Local column and a Remote column: a version in Local and not in Remote is pending. `db push --dry-run` prints the migrations it *would* apply and applies none. Check that the pending list is exactly the migrations you expect from the table below, no more and no fewer, and that they are in this order.

## 2. The migrations, in order

Apply them all, in this order. The CLI applies each file and records it, and stops at the first file that fails, so nothing after a failure is applied.

| Migration | What it adds | Notes for the deploy |
| --- | --- | --- |
| `20261009120000_instance_identity.sql` | the `lifecycle` schema and `lifecycle.instance_identity` (Story 1.1) | The one hosted identity row is inserted by hand after this (`docs/deployment-setup.md`, step 1). Never insert a second. |
| `20261010120000_accounts.sql` | the unexposed `identity` and `projects` schemas: Accounts, invitations, pre-authorizations, audit events, Workspaces (Story 1.3) | Tables only; nothing callable by a browser role. |
| `20261010120100_api.sql` | the `api` schema, the only callable surface (service role only), and `api.before_user_created` for the Auth hook (Story 1.3) | Expose `api` and `lifecycle` in the Data API (step 3). The hook is switched on by the config push (step 3). |
| `20261010130000_session_grants.sql` | session grants, `api.authorize_session` and the revocation primitive (Story 1.4a) | **Apply before the build that uses it.** Every existing session ends at the deploy: everyone signs in once (`docs/auth-setup.md`, Cutting over to session grants). |
| `20261011120000_step_up.sql` | step-up nonces and 5-minute markers (Story 1.4b) | Additive: nothing to do around it but apply it before the deploy. |
| `20261011130000_request_integrity.sql` | the per-session CSRF token hash on the grant (Story 1.4c) | Additive: older grants get their token on their next page request. |
| `20261011140000_account_preferences.sql` | the Account-owned preferences record and its two functions; `api.authorize_session` now also returns the record (Story 1.4d) | Additive: the previous build ignores the extra field. A person's first sign-in on the new build adopts the cookies of their device into their record. |
| `20261012120000_invitation_refusals.sql` | `api.record_invitation_refusal`, the one function that records an invitation change the Administrator's page refused (`invitation.issue_refused`, `invitation.revoke_refused`, `invitation.denied`); no table (Story 1.11) | Additive: apply it **before** the build that uses it deploys. The previous build never calls it; the new build serves the page without it but cannot audit a refusal until it is applied. No setting, secret or session is involved. |
| `20261012130000_account_administration.sql` | the Accounts list and the two changes behind the Administrator's Accounts page (`api.list_accounts`, `api.disable_account`, `api.enable_account`), the authority check every Job and file path must pass (`api.guard_operation`, `identity.assert_operation_authority`), `api.record_account_refusal` (`account.disable_refused`, `account.enable_refused`, `account.denied`), and a preflight that also probes all of them and the privilege to end Auth sessions; no table (Story 1.5) | Additive: apply it **before** the build that uses it deploys. The previous build never calls it. The new build's preflight (`check-env --live`, the Vercel build) fails with one line if this file is missing, or if the database owner cannot delete from `auth.sessions` (disabling ends the person's Auth sessions in the same transaction, so an environment that refuses it must fail the build rather than half-disable). No setting, secret or session is involved. Checks: step 5 and `docs/auth-setup.md`, Disabling an Account. |
| `20261012140000_administrator_recovery.sql` | `identity.recovery_tokens` (the keyed hash of each recovery token, its issue, expiry, use and void times) and the four functions behind Administrator recovery (`api.issue_recovery`, `api.void_recovery`, `api.check_recovery`, `api.redeem_recovery`); the marker table of the step-up (`identity.fresh_authentications`) gets an optional nonce and a `source` column, the only edit to it; and a preflight that also probes all of it (Story 1.6) | Additive: apply it **before** the build that uses it deploys. The previous build never calls any of it, and the old marker rows stay valid (`source` defaults to `step_up`). The new build's preflight (`check-env --live`, the Vercel build) fails with one line if this file is missing. No setting or secret is involved in the migration itself, but the new build also needs three Vercel Production variables: `RECOVERY_HASH_KEY`, `RESEND_API_KEY` and `APP_ORIGIN` (`docs/secrets.md`, `docs/deployment-setup.md`). Check: step 6 and `docs/auth-setup.md`, Verifying Administrator recovery on hosted environments (with the Email provider disabled). |

Push them:

```powershell
supabase db push --linked
```

Then look again:

```powershell
supabase migration list --linked
```

Local and Remote must now list the same versions. A migration that is in Remote and not in Local means this checkout is behind staging: stop and work out why before going on.

## 3. Auth settings and the exposed schemas (`supabase/config.toml`)

`supabase/config.toml` is the reference for the hosted Auth settings (Google only, sign-ups on, the 30-day time-box and 7-day inactivity timeout, the Before User Created hook) and for the exposed schemas (`public`, `graphql_public`, `lifecycle`, `api`; never `identity` or `projects`). `supabase config push` writes the properties the file declares to the project, and shows the exact diff before it writes each resource.

**Do not push the file as it is.** It is the local file: its `site_url` and `additional_redirect_urls` are loopback addresses, and a hosted project must never hold a `127.0.0.1`, `localhost` or LAN callback (`docs/auth-setup.md`, Staging and production). So push from a scratch copy that carries the hosted addresses, and leave the repository's file alone:

```powershell
$work = Join-Path $env:TEMP 'nova3d-staging-config'
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $work 'supabase') | Out-Null
Copy-Item supabase/config.toml (Join-Path $work 'supabase/config.toml')
notepad (Join-Path $work 'supabase/config.toml')
```

**The copy is `config.toml` alone, and that is enough.** The only line in the file that names another file is `[db.seed] sql_paths = ["./seed.sql"]`, which `db reset` and `db push --include-seed` read (both of which this page forbids) and `config push` does not. The CLI loads such a copy with no `seed.sql` beside it (checked with `supabase status --workdir` on a copy of the file); if a later change to `config.toml` adds a template, a function or another path and `config push` complains about a missing file, copy that file into the scratch folder at the same relative path. A test fails when the file gains a path other than the seed's, so this paragraph cannot go stale unnoticed.

In the copy, and only there, change:

- `site_url` to `https://<deployment-domain>` (the staging Vercel domain);
- `additional_redirect_urls` to `["https://<deployment-domain>/auth/callback"]` and nothing else.

The Google client is the *staging* client (one client per environment; never reuse another environment's). `config.toml` names it by variable, so give the two variables to this window and not to a file. The client ID is not a secret; the client secret is read hidden, like the password:

```powershell
$env:SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID = Read-Host 'Staging Google client ID'
$secureGoogleSecret = Read-Host 'Staging Google client secret' -AsSecureString
$env:SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET = [System.Net.NetworkCredential]::new('', $secureGoogleSecret).Password
```

Then read before you write:

```powershell
supabase config diff --workdir $work --project-ref $ref
```

It is read-only. What you should see: Auth provider settings, the session limits, the hook, the exposed schemas and the redirect URL. What must **not** appear as a change you did not intend: Email or Phone sign-in switched on, sign-ups switched off, a loopback URL, a different Google client. Local-only sections (`[db.seed]`, `[studio]`, the ports) are not hosted settings and are not pushed. When the diff is what you meant:

```powershell
supabase config push --workdir $work --project-ref $ref
```

It asks `y` or `n` for each changed resource, with its diff; answer each on its own. The hook (`api.before_user_created`) can only be switched on after `20261010120100_api.sql` of step 2 has been applied, because that is the migration that creates the function. Then check that the push took, by asking for the difference again. The second diff must show **no differences**, and `--exit-code` makes the command say so (exit code 0; 2 means a difference is left):

```powershell
supabase config diff --workdir $work --project-ref $ref --exit-code
$LASTEXITCODE
```

If a difference is left, read it: it names a setting the push did not take (a paid-plan feature the project's plan does not include, for example). Fix it before you go on. **Keep the scratch copy until the end of the procedure** ("When you are done"): you may need it again.

Storage needs nothing pushed: Supabase ships no policy on `storage.objects`, so a browser role is denied by default, and `tests/integration/isolation.test.ts` pins that. The 100 MiB file limit in `[storage]` is a hosted setting that the plan must allow (`supabase-organization-plan`).

## 4. Check the database from the application's side

This is the same read-only preflight the Vercel build runs, and it needs the `api` schema exposed, which step 3 did. It needs `.env.staging` (git-ignored; start from `.env.staging.example`, and see [docs/secrets.md](secrets.md) and `docs/deployment-setup.md` for where each value comes from) with the staging URL, the service-role key, `APP_ENV=staging` and `INSTANCE_ID` (the identity row exists, inserted once by hand after the first migration, and `INSTANCE_ID` is the UUID it returned). It validates the same variables the server and the Vercel build need, so since Story 1.6 `.env.staging` must also hold the three keys and settings of Administrator recovery, the same values as in the Vercel Production scope: `RECOVERY_HASH_KEY` (a third hashing key, different from the other two), `RESEND_API_KEY` (the Resend key; the sender is `resend.dev`) and `APP_ORIGIN` (the https origin of the staging deployment, a plain origin with no path; not a secret). A preview deployment holds neither key (`docs/deployment-setup.md`).

```powershell
node --env-file=.env.staging scripts/check-env.mjs --live
```

It must end with `Environment validation passed for staging`, naming the identity row and the accounts API. A one-line failure names what is wrong: the `api` schema is not exposed (step 3), a migration is not applied, a privilege on an `auth` table is missing, or the key is wrong. **A pass does not mean the deployment can be used**: it does not look at who may sign in. That is the next step.

## 5. Seed the accounts

The migrations create the tables; nobody can sign in until an address is pre-authorized or has a code. With `.env.staging` holding `ADMINISTRATOR_EMAIL`, `SEED_ACCOUNT_EMAILS` (set it deliberately; the template leaves it commented out) and the hashing keys (`docs/deployment-setup.md`, Provisioning staging, steps 4 and 5; the audited seed command needs only the one it uses, and, since Story 1.6, neither `RESEND_API_KEY` nor `APP_ORIGIN`):

```powershell
node --env-file=.env.staging scripts/seed-accounts.mjs preauthorize --confirm staging
node --env-file=.env.staging scripts/seed-accounts.mjs list --confirm staging
```

`preauthorize` pre-authorizes the Administrator and every address in `SEED_ACCOUNT_EMAILS`; it is safe to repeat and reports `already pre-authorized` for an address that is, so it also shows what is seeded. `list` shows the invitations issued so far (never a code). **Seed every address that is allowed in today before you deploy**, or those people see the registration screen and nothing else. Every command is audited. `docs/deployment-setup.md` (Provisioning staging, step 5) and `docs/auth-setup.md` (Accounts, invitations and the seed command) have the rest.

## 6. Deploy, then verify

Only now promote the branch (`docs/deployment-setup.md`, Promoting to staging):

```powershell
git push origin main:staging
```

Never force-push `staging`. Then open the app with a real Google sign-in and run the hosted checks that belong to the stories you just shipped; each is written where its feature is described:

- sign-in, sign-out and "sign out my other sessions": `docs/auth-setup.md`, Cutting over to session grants (the first real sign-in is the first time the callback runs against hosted Auth);
- the step-up: `docs/auth-setup.md`, Verifying the step-up on hosted Auth (it starts from the Administrator's invitation page now);
- the Administrator's invitation page (Story 1.11): `docs/auth-setup.md`, Verifying invitation management on hosted environments. It needs the Administrator's own Google account, the step-up above and a throwaway account to register with a code; when it passes, record it as the ledger item `hosted-step-up-and-invitation-check` (see [docs/provisioning.md](provisioning.md));
- the Administrator's Accounts page (Story 1.5): `docs/auth-setup.md`, Verifying account administration on hosted environments. It needs the Administrator's own Google account, the step-up above and a throwaway account that registered with a named code, to disable and re-enable; the migration `20261012130000_account_administration.sql` (step 2) must be applied before the deploy, and step 4's preflight now also fails with one line if the database owner cannot delete from `auth.sessions`. When it passes, record it as the ledger item `hosted-account-disable-check` (see [docs/provisioning.md](provisioning.md));
- Administrator recovery (Story 1.6): `docs/auth-setup.md`, Verifying Administrator recovery on hosted environments. Before the deploy, the migration `20261012140000_administrator_recovery.sql` (step 2) must be applied, and `RECOVERY_HASH_KEY`, `RESEND_API_KEY` and `APP_ORIGIN` must be set in the Vercel Production scope (the build fails without them). The check needs the Administrator's own Google account, the **Email provider disabled** in the staging Auth settings and the Administrator's mailbox (the Resend account must be registered with that address, because the `resend.dev` sender reaches no one else). If hosted Auth refuses the Admin link API or `verifyOtp`, stop and record a design change (the Spine allows the Google provider only). When it passes, record it as the ledger item `hosted-recovery-check` (see [docs/provisioning.md](provisioning.md));
- origin and CSRF checks: `docs/auth-setup.md`, Verifying request integrity on hosted environments;
- the preferences record (Story 1.4d): in a browser with no session, choose Hebrew and dark on the sign-in page and sign in. An Account's first sign-in after the deploy adopts the choices of that browser, so expect Hebrew and dark; later sign-ins do not adopt anything. Then open the app in a second browser, signed in as the same person, and expect Hebrew and dark there too; change a setting in one browser and expect the other to show it on its next page load. Nothing about it needs a setting on the hosted project.

## If something goes wrong

Everything here assumes you are still in the window you started in (see the top of the page).

- **A migration fails.** Read the error, then `supabase migration list --linked` to see what the project recorded. A file that is not recorded can be fixed in the repository, committed and pushed again. A file that is recorded is never edited: add a new migration instead.
- **The deploy fails its preflight.** Read the one line; it names the cause. It means the database does not yet match the build, which is what the check is for. Do not skip the check.
- **Nobody can sign in after the deploy.** The accounts were not seeded (step 5), or an address was left out of it. Seed it, and have the person sign in again.
- **You need the previous build back.** Redeploy it from Vercel. Leave the migrations in place: each one is additive and harmless to the previous build, and removing one would delete data. `docs/auth-setup.md` says what each story's rollback means for sessions.
- **You pushed a setting you did not mean to.** The scratch copy from step 3 is still there until you clean up: change the setting in it (or in the dashboard), run the diff again and push again; `config push` only moves what the file declares. If you have already cleaned up or closed the window, repeat "Before you start", step 2, and step 3 from the top to make the copy again.

## When you are done

Remove everything this procedure put in the window, the scratch copy and every secret included, and sign the CLI out on a machine that is not only yours (it asks you to confirm):

```powershell
Remove-Item -Recurse -Force $work
Remove-Item Env:SUPABASE_DB_PASSWORD, Env:SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID, Env:SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET
$securePassword.Dispose()
$secureGoogleSecret.Dispose()
supabase logout
```

Nothing in the scratch copy is a secret (the file holds variable names), but it holds your hosted callback, so it does not stay around. Closing the window also ends every variable in it; this is for the window you keep open.
