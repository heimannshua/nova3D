# External accounts, credentials and spend limits

<!-- Generated from provisioning/ledger.json by scripts/render-provisioning.mjs. Do not edit by hand: change the ledger, then run `npm run render:provisioning`. -->

This guide lists every external account, credential and spend limit that only the Administrator (Josh) can create, the story that first needs each, and how to record that it exists. It is rendered from the machine-readable [ledger](../provisioning/ledger.json), which holds names, dates and evidence references and never a secret value. Keys the application generates itself are in the [internal secrets register](secrets.md). Nothing in this repository creates an account or calls a provider.

## Record and check

Tasks are ordered by the build order in `_bmad-output/implementation-artifacts/sprint-status.yaml`, not by story number, and each is due by the story named: that story needs it, and so does every story built after it. Every item starts pending, and a pending item never counts as passed.

- A `secret-present` item passes when each variable it names is set to a real value in the process environment: not empty, and not a placeholder such as `replace-with-...`, `<...>`, `changeme`, `todo`, `none`, `null`, `xxx` or `your-key-here`. Only `local` and `staging` values are checked this way. A production secret never sits in a local file, so every production item is an attestation that its value is stored in Vercel, Railway or GitHub.
- An `attestation` item passes only with a dated evidence entry for the environment. Save a console export or screenshot **outside this repository** (a password manager or private drive), then add to the item in the ledger `"evidence": {"staging": {"date": "YYYY-MM-DD", "ref": "<export file name>"}}`: the date you captured it (a date up to one day ahead of UTC is accepted, so a local date in a UTC+ time zone is fine), and the export's file name, never its content, a URL or a path. The name may use letters, digits, spaces and `. _ ( ) , ' & + -`; a filler such as `tbd`, `none`, `test` or `export` is refused. A malformed or future date, or a bad reference name, is invalid and counts as missing.
- Check one environment through one story: `npm run check:provisioning -- --story <id> --env <local|staging|production>` (`--env` defaults to `APP_ENV`). For `local` and `staging` it loads `.env.local` or `.env.staging` itself when the file exists, without overriding variables already set; the direct equivalent is `node --env-file-if-exists=.env.staging scripts/check-provisioning.mjs --story <id> --env staging`. If `APP_ENV` is set it must equal `--env`, so values from another environment cannot satisfy the check. Exit 0: every item due by that story is present. Exit 1: some item is missing or invalid, and each is named with its story and variable names. Exit 2: unknown story or environment, a mismatched `APP_ENV`, or an unreadable input. It never prints a value.
- After you edit the ledger, run `npm run render:provisioning`. CI runs `npm run render:provisioning -- --check` and fails when this guide is out of date.
- Account-wide tasks are recorded once, under `staging`, the first environment that needs them. Tasks that differ per environment (clients, keys, buckets) list each environment. Production projects are created in Story 8.7 after the Story 8.4 drill, so a production check is expected to fail until then; the production-only Stripe tasks are due by Story 8.7 for that reason. See also [deployment setup](deployment-setup.md) and [authentication setup](auth-setup.md).

## Services

| Service | First needed | Spend backstop |
| --- | --- | --- |
| Google sign-in (Google Cloud OAuth clients) | Story 1.3 | Not billable, so there is no spend to cap. |
| Supabase (Postgres, Auth, Storage) | Story 1.4 | The organization's spend cap, left on in the billing settings. Fixed cost is about $35-40 a month; each restore drill adds a temporary project whose hourly cost is recorded at the first drill. |
| Vercel (Next.js hosting) | Story 1.4 | Hobby is free and cannot incur charges. When Pro starts, set a monthly spend limit in the team's billing settings and record the figure. |
| GitHub (Actions environments and Container Registry) | Story 1.4 | No paid add-on or metered billing enabled; watch container storage in the billing page. |
| Resend (application mailer) | Story 1.6 | Free plan without a payment method, so nothing can be charged. |
| Upstash (Redis and QStash) | Story 1.9 | A monthly budget limit set in the Upstash console and recorded in the evidence export. QStash is expected to cost on the order of a dollar a month (confirm the price at provisioning). |
| Railway (workers, gateway and backup service) | Story 1.9 | A usage limit set in Railway at the Hobby plan's monthly amount and recorded in the evidence export. |
| Anthropic (evidence synthesis and vision) | Story 2.5 | The workspace spend limit set in the Anthropic Console. The application's own ceilings ($1 an operation, $5 a Job) and Account allowances apply on top and are not a substitute. |
| Brave Search API (discovery) | Story 2.5 | Prepaid credit with no auto-recharge, so spend cannot exceed the balance. |
| Stripe (hosted Checkout payments) | Story 2.16 | No spend of its own: Stripe's fees come out of payments. Exposure is bounded by the payment rules (a price of $1.00 to $500.00 and at most 3 open requests per Account) and by a restricted API key. |
| Public model-asset bucket | Story 7.2 | Public, versioned, digest-pinned files only. Set a download or transaction cap on the host (a B2 cap, or the Supabase spend cap) and record the figure. |
| Web Push (VAPID keys) | Story 7.7 | Not billable, so there is no spend to cap. |
| Independent backups (Backblaze B2 and age encryption) | Story 8.9 | Daily storage, download and transaction caps set in the B2 account and recorded in the evidence export. Lifecycle keeps dumps 14 days and deleted-at-source objects 7 days. |

### Google sign-in (Google Cloud OAuth clients)

- Owner: Josh (Administrator)
- Plan: No charge. One OAuth web client per environment (local, staging, production); the consent screen is published In production.
- Region: Not region-bound.
- Spend backstop: Not billable, so there is no spend to cap.
- First needed: Story 1.3
- Verification: attestation (1)
- Secret names by environment: local, staging, production: `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`
- Free-tier limits relied on: none.

### Supabase (Postgres, Auth, Storage)

- Owner: Josh (Administrator)
- Plan: Pro in one organization, with staging and production as separate projects (Pro is $25 a month including a $10 credit; staging adds about $10). Local runs the Supabase CLI stack at no charge.
- Region: us-east-1
- Spend backstop: The organization's spend cap, left on in the billing settings. Fixed cost is about $35-40 a month; each restore drill adds a temporary project whose hourly cost is recorded at the first drill.
- First needed: Story 1.4
- Verification: attestation (3)
- Secret names by environment: staging: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`
- Free-tier limits relied on, with the trigger for upgrading:
  - A Free project pauses, so staging and production never run on the Free plan. Upgrade trigger: Pro before Story 1.4, so hosted-Auth checks can run.
  - Built-in backups cover Postgres only (daily, 7 days) and exclude Storage objects. Upgrade trigger: Not an upgrade: the independent backup service of Story 8.9 backs up Postgres and Storage every 12 hours.

### Vercel (Next.js hosting)

- Owner: Josh (Administrator)
- Plan: Hobby ($0) until Story 2.16, then Pro (about $20 a month). Staging is its own project whose production branch is `staging`; production deploys stay disabled until a production project exists.
- Region: iad1
- Spend backstop: Hobby is free and cannot incur charges. When Pro starts, set a monthly spend limit in the team's billing settings and record the figure.
- First needed: Story 1.4
- Verification: attestation (2)
- Secret names by environment: staging: `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Free-tier limits relied on, with the trigger for upgrading:
  - Function request and response bodies are capped at 4.5 MB, so no user file crosses a Vercel function; uploads and downloads go through the Railway gateway. Upgrade trigger: Not an upgrade trigger. If a feature needs larger bodies, move that transfer to the gateway (Story 1.12).
  - Hobby terms allow non-commercial use only. Upgrade trigger: Upgrade to Pro before Story 2.16, because taking payments is commercial use.

### GitHub (Actions environments and Container Registry)

- Owner: Josh (Administrator)
- Plan: The repository's existing GitHub plan, a protected `staging` environment for CI secrets (production gets its own later), and Container Registry for worker images.
- Region: Not region-bound (GitHub-hosted).
- Spend backstop: No paid add-on or metered billing enabled; watch container storage in the billing page.
- First needed: Story 1.4
- Verification: attestation (2)
- Secret names by environment: staging: `GHCR_TOKEN`
- Free-tier limits relied on, with the trigger for upgrading:
  - Older generator images stay in the registry so reproducible Versions can still be rebuilt. Upgrade trigger: Review when retained image storage nears the allowance the GitHub billing page shows.

### Resend (application mailer)

- Owner: Josh (Administrator)
- Plan: Free, with no payment method on file.
- Region: Not region-bound.
- Spend backstop: Free plan without a payment method, so nothing can be charged.
- First needed: Story 1.6
- Verification: secret-present (1), attestation (2)
- Secret names by environment: staging, production: `RESEND_API_KEY`
- Free-tier limits relied on, with the trigger for upgrading:
  - With no verified sending domain, the `resend.dev` sender reaches only the Resend account owner's address, which must be the Administrator's. Recovery and alarm mail go to that address only. Upgrade trigger: Verify a sending domain (none is owned today) before any mail goes to another recipient.

### Upstash (Redis and QStash)

- Owner: Josh (Administrator)
- Plan: Redis on the free tier, moving to pay-as-you-go on need. QStash pay-as-you-go from Story 1.9.
- Region: QStash us-east-1, set explicitly because the SDK default is EU. Redis in the nearest available region to Virginia, with the actual placement recorded at provisioning.
- Spend backstop: A monthly budget limit set in the Upstash console and recorded in the evidence export. QStash is expected to cost on the order of a dollar a month (confirm the price at provisioning).
- First needed: Story 1.9
- Verification: secret-present (1), attestation (2)
- Secret names by environment: staging, production: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
- Free-tier limits relied on, with the trigger for upgrading:
  - QStash's free tier allows roughly 1,000 messages a day; the periodic tasks need about 1,700 a day plus per-Job steps. Upgrade trigger: Pay-as-you-go from Story 1.9.
  - Redis on the free tier carries only rate limiting and disposable coordination or cache; the free-tier quotas shown in the Upstash console at provisioning are recorded in the evidence export. Upgrade trigger: Move Redis to pay-as-you-go when its usage nears any of those quotas.

### Railway (workers, gateway and backup service)

- Owner: Josh (Administrator)
- Plan: Hobby ($5 a month), holding disposable scratch only: no authoritative data.
- Region: Virginia (us-east4-eqdc4a)
- Spend backstop: A usage limit set in Railway at the Hobby plan's monthly amount and recorded in the evidence export.
- First needed: Story 1.9
- Verification: attestation (2)
- Secret names by environment: staging: `RAILWAY_TOKEN`
- Free-tier limits relied on, with the trigger for upgrading:
  - The Hobby plan's monthly credit is shared by the CAD worker, the reconversion engine worker, the gateway and the backup service; the first deployment records actual usage against it. Upgrade trigger: Move to Pro when recorded usage nears the credit or a service needs more than Hobby resources.
  - Volume backups stay disabled because their monthly retention (89 days) would breach the 30-day deletion limit. Upgrade trigger: Never enable Railway volume backups for private data; nothing authoritative lives on Railway.

### Anthropic (evidence synthesis and vision)

- Owner: Josh (Administrator)
- Plan: API pay-as-you-go with a dedicated workspace for each environment, each with its own spend limit. The adapter uses claude-sonnet-5-5.
- Region: Not region-bound; no residency promise extends to AI providers.
- Spend backstop: The workspace spend limit set in the Anthropic Console. The application's own ceilings ($1 an operation, $5 a Job) and Account allowances apply on top and are not a substitute.
- First needed: Story 2.5
- Verification: secret-present (1), attestation (2)
- Secret names by environment: staging, production: `ANTHROPIC_API_KEY`
- Free-tier limits relied on: none.

### Brave Search API (discovery)

- Owner: Josh (Administrator)
- Plan: Web Search v1 with prepaid credit and auto-recharge off. The plan and rate are recorded at provisioning.
- Region: Not region-bound; no residency promise extends to search providers.
- Spend backstop: Prepaid credit with no auto-recharge, so spend cannot exceed the balance.
- First needed: Story 2.5
- Verification: secret-present (1), attestation (3)
- Secret names by environment: staging, production: `BRAVE_SEARCH_API_KEY`
- Free-tier limits relied on, with the trigger for upgrading:
  - Section 3(b) of the Brave terms bars storing or caching results, so a Brave result is transient discovery input only and the adapter ships disabled until the review is recorded. Upgrade trigger: Record the terms review (`brave-terms-review`) before Story 2.5 enables the adapter, and review again if Brave changes its terms or the account moves to another plan.

### Stripe (hosted Checkout payments)

- Owner: Josh (Administrator)
- Plan: A United Kingdom account with standard per-payment fees (confirm UK pricing at provisioning), used in test mode for local and staging and in live mode for production only.
- Region: United Kingdom account, settling to a GBP bank account; payments are charged in USD, which may incur a currency-conversion fee.
- Spend backstop: No spend of its own: Stripe's fees come out of payments. Exposure is bounded by the payment rules (a price of $1.00 to $500.00 and at most 3 open requests per Account) and by a restricted API key.
- First needed: Story 2.16
- Verification: secret-present (2), attestation (6)
- Secret names by environment: staging, production: `STRIPE_RESTRICTED_KEY`, `STRIPE_WEBHOOK_SECRET`
- Free-tier limits relied on, with the trigger for upgrading:
  - Test mode serves local and staging, previews hold no Stripe keys, and live mode is enabled only in production after the account is verified. Upgrade trigger: Enable live mode only when production exists and Stripe has verified the account.

### Public model-asset bucket

- Owner: Josh (Administrator)
- Plan: A public bucket on Backblaze B2 or Supabase Storage, chosen in Story 7.2 once Story 7.1 knows the weight size.
- Region: US East (Backblaze) or us-east-1 (Supabase), matching the host chosen.
- Spend backstop: Public, versioned, digest-pinned files only. Set a download or transaction cap on the host (a B2 cap, or the Supabase spend cap) and record the figure.
- First needed: Story 7.2
- Verification: attestation (1)
- Secret names by environment: none
- Free-tier limits relied on: none.

### Web Push (VAPID keys)

- Owner: Josh (Administrator)
- Plan: No account: standard Web Push through each browser's push service with one VAPID key pair per environment and no third-party notification provider.
- Region: Not region-bound.
- Spend backstop: Not billable, so there is no spend to cap.
- First needed: Story 7.7
- Verification: secret-present (1), attestation (1)
- Secret names by environment: local, staging, production: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- Free-tier limits relied on: none.

### Independent backups (Backblaze B2 and age encryption)

- Owner: Josh (Administrator)
- Plan: B2 pay-as-you-go with a private backup bucket for each environment and a separate private ledger bucket. Every dump and mirrored object is encrypted with age, using a separate key pair for each environment, before upload; age needs no account.
- Region: US East
- Spend backstop: Daily storage, download and transaction caps set in the B2 account and recorded in the evidence export. Lifecycle keeps dumps 14 days and deleted-at-source objects 7 days.
- First needed: Story 8.9
- Verification: secret-present (2), attestation (4)
- Secret names by environment: staging, production: `B2_MANIFEST_READ_KEY_ID`, `B2_MANIFEST_READ_APPLICATION_KEY`, `B2_LEDGER_READ_KEY_ID`, `B2_LEDGER_READ_APPLICATION_KEY`, `BACKUP_AGE_PUBLIC_KEY`
- Free-tier limits relied on, with the trigger for upgrading:
  - Object lock of at most 7 days and lifecycle rules through the S3-compatible API; their behaviour is not yet confirmed (gate G-9). Upgrade trigger: Confirm lifecycle and object-lock behaviour in Story 8.9 before relying on them.

## Tasks by story

### Due by Story 1.3

#### `google-oauth-client`: One Google OAuth client per environment, consent screen In production

- Service: Google sign-in (Google Cloud OAuth clients)
- Verification: attestation
- Environments: local, staging, production
- Secret names: `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`
- Status: local: pending; staging: pending; production: pending

1. In Google Cloud Console open the nova3D project's OAuth consent screen and set its publishing status to In production. Testing mode silently allowlists users and expires grants.
2. Create one OAuth client of type Web application for each environment: local, staging and production. Never reuse a client across environments.
3. Set each client's authorized redirect URI exactly: `http://127.0.0.1:54321/auth/v1/callback` for local, and `https://<project-ref>.supabase.co/auth/v1/callback` with the staging project's ref for staging. Create the production client now and add its redirect URI, built the same way, when the production Supabase project exists (Story 8.7), then record production again.
4. Keep each client ID and secret in your password manager and enter them where `docs/auth-setup.md` says (the local shell for `supabase start`, the Supabase Auth provider settings for a hosted environment). They are never committed.
5. Save an export or screenshot of the consent screen status and the client list, without secrets, outside the repository, and record its file name as evidence for each environment.

### Due by Story 1.4

#### `supabase-organization-plan`: Organization on Pro; the existing project's status and region recorded

- Service: Supabase (Postgres, Auth, Storage)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. In the Supabase dashboard confirm the organization is on the Pro plan (a Free project pauses) and that its spend cap is the setting you want.
2. Open the existing hosted project, the one the earlier mock-first deployment used and now staging. Confirm it is active and not paused, that its region is us-east-1, and note its database major version. If it is paused, resume it as `docs/deployment-setup.md` describes.
3. Confirm the plan allows the settings `supabase/config.toml` declares that may be paid-plan features: the 30-day session time-box, the 7-day inactivity timeout and the 100MiB Storage file-size limit. Note the result in your export.
4. Save an export of the organization's billing page and the project's general settings outside the repository, and record its file name as evidence.

#### `supabase-cli-credentials`: Personal access token, staging database password and project reference stored in the protected `staging` GitHub environment

- Service: Supabase (Postgres, Auth, Storage)
- Verification: attestation
- Environments: staging
- Secret names: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`
- Status: staging: pending

1. In the Supabase dashboard create a personal access token for this organization, named for nova3D CI, so the CLI and CI can push configuration and migrations.
2. Have the staging database password and the project reference ready from the project's settings. Reset the database password only if you do not have it, and update anything that uses the old one.
3. In the repository's `staging` GitHub environment (see `github-staging-environment`) add the three secrets named here. Production gets its own environment later.
4. Save an export of the environment's secret names (GitHub shows names, never values) outside the repository, and record its file name as evidence.

#### `github-staging-environment`: Protected GitHub environment `staging`

- Service: GitHub (Actions environments and Container Registry)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. In the repository settings create an environment named `staging`.
2. Protect it: limit its deployment branches to `staging`, and add yourself as a required reviewer if you want a manual approval before a workflow can use its secrets.
3. Save an export of the environment's protection rules outside the repository, and record its file name as evidence.

#### `vercel-staging-project`: Staging Vercel project linked to the `staging` branch with the seed application deployed

- Service: Vercel (Next.js hosting)
- Verification: attestation
- Environments: staging
- Secret names: `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Status: staging: pending

1. Create a Vercel project for this repository for staging and set Settings, Git, Production Branch to `staging`, as `docs/deployment-setup.md` describes.
2. Set the Production-scope variables listed in `docs/deployment-setup.md`, including the two named here. Keep the Preview and Development scopes free of any Supabase, database or Stripe variable.
3. Fast-forward `main` into `staging` (`git push origin main:staging`) and confirm the seed application deploys and `/api/health` answers.
4. Save an export of the project's Git settings and its deployment list outside the repository, and record its file name as evidence.

### Due by Story 1.6

#### `resend-account`: Resend account registered with the Administrator address

- Service: Resend (application mailer)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. Sign up at Resend with the Administrator's address (the value of `ADMINISTRATOR_EMAIL`). The `resend.dev` sender reaches only the account owner's address, so the account must be registered with that address.
2. Stay on the free plan and add no payment method. No sending domain is owned today.
3. Save an export of the account page outside the repository, and record its file name as evidence.

#### `resend-api-key`: Resend API key for staging

- Service: Resend (application mailer)
- Verification: secret-present
- Environments: staging
- Secret names: `RESEND_API_KEY`
- Status: staging: checked from the process environment

1. In Resend create an API key for staging, with sending access only.
2. Store it as `RESEND_API_KEY` in the staging Vercel project's Production-scope variables and in your git-ignored `.env.staging`, so the check can see it. Never commit it.

#### `resend-api-key-production`: Resend API key for production, stored in Vercel

- Service: Resend (application mailer)
- Verification: attestation
- Environments: production
- Secret names: `RESEND_API_KEY`
- Status: production: pending

1. In Resend create a separate API key for production, with sending access only.
2. Store it as `RESEND_API_KEY` in the production Vercel project's variables, once that project exists. Production values never go in a local file, an env file or the repository, so this is an attestation and not a presence check.
3. Save an export of the production variable names outside the repository (the console shows variable names, never values), and record its file name as evidence.

### Due by Story 1.9

#### `upstash-account`: Upstash account with Redis and QStash in the adopted regions

- Service: Upstash (Redis and QStash)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. Create an Upstash account. Create a Redis database on the free tier in the nearest available region to Virginia and note the region. It holds only rate limiting and disposable coordination.
2. Move QStash to pay-as-you-go (about 1,700 messages a day exceed the free tier) and use the us-east-1 endpoint explicitly: the SDK default is EU, and the token and signing keys are region-specific.
3. Set a monthly budget limit in the console if the plan offers one, and confirm the QStash price. Note the figures and the Redis free-tier quotas in your export.
4. Save an export of the account, the database region and the QStash plan outside the repository, and record its file name as evidence.

#### `upstash-credentials`: Redis and QStash credentials for staging

- Service: Upstash (Redis and QStash)
- Verification: secret-present
- Environments: staging
- Secret names: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
- Status: staging: checked from the process environment

1. Copy staging's Redis REST URL and token, and its QStash URL (the us-east-1 endpoint), token and both signing keys, from the Upstash console.
2. Store them under these names in the staging Vercel project's Production-scope variables and in your git-ignored `.env.staging`. Each environment has its own queue and credentials.

#### `upstash-credentials-production`: Redis and QStash credentials for production, stored in Vercel

- Service: Upstash (Redis and QStash)
- Verification: attestation
- Environments: production
- Secret names: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
- Status: production: pending

1. Copy production's own Redis REST URL and token, and its own QStash URL (the us-east-1 endpoint), token and both signing keys, from the Upstash console. Production has its own database and queue.
2. Store them under these names in the production Vercel project's variables, once that project exists. Production values never go in a local file, an env file or the repository, so this is an attestation and not a presence check.
3. Save an export of the production variable names outside the repository (the console shows variable names, never values), and record its file name as evidence.

#### `railway-account`: Railway account and project on the Hobby plan in Virginia

- Service: Railway (workers, gateway and backup service)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. Create the Railway account on the Hobby plan and a project for nova3D.
2. Set the project's region to Virginia (`us-east4-eqdc4a`) and a usage limit at the plan's monthly amount. Keep volume backups off: their monthly retention (89 days) would breach the 30-day deletion limit.
3. Note that the CAD worker, the engine worker, the gateway and the backup service share the monthly credit. The first deployment records actual usage against it.
4. Save an export of the plan, region and usage limit outside the repository, and record its file name as evidence.

#### `ghcr-token`: GitHub Container Registry token for the worker image pipeline

- Service: GitHub (Actions environments and Container Registry)
- Verification: attestation
- Environments: staging
- Secret names: `GHCR_TOKEN`
- Status: staging: pending

1. Create a GitHub token that can push container images to GitHub Container Registry (a classic token with the `write:packages` scope) and name it for the worker pipeline.
2. Add it as `GHCR_TOKEN` to the `staging` GitHub environment's secrets.
3. Save an export of the environment's secret names outside the repository, and record its file name as evidence.

#### `railway-project-token`: Railway project token for deploying worker images

- Service: Railway (workers, gateway and backup service)
- Verification: attestation
- Environments: staging
- Secret names: `RAILWAY_TOKEN`
- Status: staging: pending

1. In the Railway project's settings create a project token for the staging environment.
2. Add it as `RAILWAY_TOKEN` to the `staging` GitHub environment's secrets.
3. Save an export of the environment's secret names outside the repository, and record its file name as evidence.

### Due by Story 2.5

#### `anthropic-workspace-spend-limit`: Dedicated Anthropic workspace with a spend limit for each environment

- Service: Anthropic (evidence synthesis and vision)
- Verification: attestation
- Environments: staging, production
- Secret names: none
- Status: staging: pending; production: pending

1. In the Anthropic Console create a workspace dedicated to nova3D for this environment.
2. Set the workspace's spend limit to the amount you accept as the provider-side backstop. The application's own reservation limits apply on top and are not a substitute.
3. Note in your export whether an organization Admin key exists.
4. Save an export of the workspace and its limit outside the repository, and record its file name as evidence.

#### `anthropic-api-key`: Anthropic API key for staging

- Service: Anthropic (evidence synthesis and vision)
- Verification: secret-present
- Environments: staging
- Secret names: `ANTHROPIC_API_KEY`
- Status: staging: checked from the process environment

1. Create an API key inside the staging environment's dedicated workspace, so the workspace spend limit applies to it.
2. Store it as `ANTHROPIC_API_KEY` in the staging Vercel project's Production-scope variables and in your git-ignored `.env.staging`. Paid adapters stay disabled until the story that enables them.

#### `anthropic-api-key-production`: Anthropic API key for production, stored in Vercel

- Service: Anthropic (evidence synthesis and vision)
- Verification: attestation
- Environments: production
- Secret names: `ANTHROPIC_API_KEY`
- Status: production: pending

1. Create an API key inside the production environment's dedicated workspace, so that workspace's spend limit applies to it.
2. Store it as `ANTHROPIC_API_KEY` in the production Vercel project's variables, once that project exists. Production values never go in a local file, an env file or the repository, so this is an attestation and not a presence check.
3. Save an export of the production variable names outside the repository (the console shows variable names, never values), and record its file name as evidence.

#### `brave-prepaid-credit`: Brave Search API account with prepaid credit and no auto-recharge

- Service: Brave Search API (discovery)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. Create a Brave Search API account and choose a plan for Web Search v1.
2. Buy prepaid credit and turn auto-recharge off, so spend cannot exceed the balance. Note the plan and balance in your export.
3. Save an export of the plan and billing settings outside the repository, and record its file name as evidence.

#### `brave-api-key`: Brave Search API key for staging

- Service: Brave Search API (discovery)
- Verification: secret-present
- Environments: staging
- Secret names: `BRAVE_SEARCH_API_KEY`
- Status: staging: checked from the process environment

1. Create an API key for staging in the Brave Search API dashboard.
2. Store it as `BRAVE_SEARCH_API_KEY` in the staging Vercel project's Production-scope variables and in your git-ignored `.env.staging`.

#### `brave-api-key-production`: Brave Search API key for production, stored in Vercel

- Service: Brave Search API (discovery)
- Verification: attestation
- Environments: production
- Secret names: `BRAVE_SEARCH_API_KEY`
- Status: production: pending

1. Create a separate API key for production in the Brave Search API dashboard.
2. Store it as `BRAVE_SEARCH_API_KEY` in the production Vercel project's variables, once that project exists. Production values never go in a local file, an env file or the repository, so this is an attestation and not a presence check.
3. Save an export of the production variable names outside the repository (the console shows variable names, never values), and record its file name as evidence.

#### `brave-terms-review`: Brave terms review recorded (section 3(b) bars storing or caching results)

- Service: Brave Search API (discovery)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. Read the current Brave Search API terms. Section 3(b) bars storing or caching results, so a Brave result is transient discovery input only.
2. Confirm the rates and the account terms against what Story 2.5 will send: normalized public subjects only, never private prompts.
3. Write down the date and outcome of the review in a note kept outside the repository, and record its file name as evidence. The Brave adapter stays disabled until this item is recorded.

### Due by Story 2.16

#### `vercel-pro-plan`: Vercel team upgraded to Pro

- Service: Vercel (Next.js hosting)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. Upgrade the Vercel team to Pro (about $20 a month). Taking payments is commercial use, which Hobby terms do not allow.
2. Set a monthly spend limit in the team's billing settings and note the figure in your export.
3. Save an export of the team's plan and spend settings outside the repository, and record its file name as evidence.

#### `stripe-account`: Stripe account in the United Kingdom with test and live modes and receipts enabled

- Service: Stripe (hosted Checkout payments)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. Open the Stripe account in the United Kingdom. It settles to a GBP bank account.
2. Confirm test mode works (local and staging use it) and enable customer email receipts in the account's email settings.
3. Save an export of the account settings outside the repository, and record its file name as evidence.

#### `stripe-restricted-key`: Restricted Stripe API key for staging (test mode)

- Service: Stripe (hosted Checkout payments)
- Verification: secret-present
- Environments: staging
- Secret names: `STRIPE_RESTRICTED_KEY`
- Status: staging: checked from the process environment

1. In Stripe test mode create a restricted API key with Checkout Sessions: write, and Charges and PaymentIntents: read, and nothing else.
2. Store it as `STRIPE_RESTRICTED_KEY` in the staging Vercel project's Production-scope variables (never in a preview) and in your git-ignored `.env.staging`.

#### `stripe-webhook-secret`: Stripe webhook endpoint and signing secret for staging (test mode)

- Service: Stripe (hosted Checkout payments)
- Verification: secret-present
- Environments: staging
- Secret names: `STRIPE_WEBHOOK_SECRET`
- Status: staging: checked from the process environment

1. In Stripe test mode add a webhook endpoint for the staging deployment's domain. Story 2.16 names the route path; update the endpoint if it differs.
2. Store the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET` in the staging Vercel project's Production-scope variables (never in a preview) and in your git-ignored `.env.staging`.

#### `stripe-fees-tax-review`: Stripe UK fees, USD conversion fee, and the tax and VAT position confirmed

- Service: Stripe (hosted Checkout payments)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. Confirm Stripe's UK fees for card payments and the currency-conversion fee for charging in USD while settling to a GBP account.
2. Confirm the tax and VAT position, including consumer cancellation rights, privacy-notice duties for payment records, and any record-keeping duty that conflicts with deleting billing history. nova3D computes no tax; registration and the terms are yours.
3. Write down the findings and decisions in a note kept outside the repository, and record its file name as evidence.

#### `payment-terms-text`: Terms and refund policy text written

- Service: Stripe (hosted Checkout payments)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. Write the terms and refund policy that the owner sees before the Pay button: English now, and a Hebrew version when you supply one.
2. State what happens to unspent credit when an Account is deleted or the instance closes, and that Stripe processes the payment and keeps its own records under its terms and the law.
3. Keep the text outside the repository until Story 2.16 adds it to the application, and record the document's file name and date as evidence.

### Due by Story 7.2

#### `public-model-asset-bucket`: Public model-asset bucket that Story 7.2 names

- Service: Public model-asset bucket
- Verification: attestation
- Environments: staging, production
- Secret names: none
- Status: staging: pending; production: pending

1. Story 7.2 chooses the host once Story 7.1 knows the weight size: a Backblaze B2 public bucket or a Supabase public bucket. Create it then, one for each environment, in the adopted region.
2. The bucket holds only public, versioned, digest-pinned application and model assets. Never put a user file or a private artifact in it.
3. Set a download or transaction cap on the host and note the figure in your export.
4. Save an export of the bucket's settings outside the repository, and record its file name as evidence.

### Due by Story 7.7

#### `vapid-keys`: VAPID key pair for local and staging

- Service: Web Push (VAPID keys)
- Verification: secret-present
- Environments: local, staging
- Secret names: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- Status: local: checked from the process environment; staging: checked from the process environment

1. Generate one VAPID key pair for each of local and staging (for example with `npx web-push generate-vapid-keys`). Never reuse a pair across environments.
2. Store the pair as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in `.env.local` for local, and in the staging Vercel project's Production-scope variables and your git-ignored `.env.staging` for staging. Keep the private keys in your password manager.

#### `vapid-keys-production`: VAPID key pair for production, stored in Vercel

- Service: Web Push (VAPID keys)
- Verification: attestation
- Environments: production
- Secret names: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- Status: production: pending

1. Generate a separate VAPID key pair for production (for example with `npx web-push generate-vapid-keys`) and keep the private key in your password manager.
2. Store the pair as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in the production Vercel project's variables, once that project exists. Production values never go in a local file, an env file or the repository, so this is an attestation and not a presence check.
3. Save an export of the production variable names outside the repository (the console shows variable names, never values), and record its file name as evidence.

### Due by Story 8.9

#### `backblaze-buckets`: Backblaze account, a backup bucket for each environment in US East, and a separate ledger bucket

- Service: Independent backups (Backblaze B2 and age encryption)
- Verification: attestation
- Environments: staging, production
- Secret names: none
- Status: staging: pending; production: pending

1. Create the Backblaze B2 account and set daily storage, download and transaction caps. Note the figures in your export.
2. Create a private backup bucket for this environment in the US East region, and a separate private ledger bucket (its object keys are prefixed with the instance ID).
3. Give the ledger bucket no lifecycle rule: it is intended to be append-only, which Story 8.9 and gate G-9 confirm. Story 8.9 applies the backup lifecycle (dumps 14 days, deleted-at-source objects 7 days, object lock of at most 7 days).
4. Save an export of the buckets, their region and the caps outside the repository, and record its file name as evidence.

#### `backblaze-read-only-keys`: Read-only manifest key and ledger read-only key for staging

- Service: Independent backups (Backblaze B2 and age encryption)
- Verification: secret-present
- Environments: staging
- Secret names: `B2_MANIFEST_READ_KEY_ID`, `B2_MANIFEST_READ_APPLICATION_KEY`, `B2_LEDGER_READ_KEY_ID`, `B2_LEDGER_READ_APPLICATION_KEY`
- Status: staging: checked from the process environment

1. Create a read-only application key scoped to staging's backup bucket (the application reads the newest manifest with it) and a read-only key scoped to the ledger bucket (the application and the backup service both read the ledger with it).
2. Store the manifest key ID and application key in the staging Vercel project's Production-scope variables. Store the ledger key ID and application key there and also in the Railway backup service's variables. For the check, keep the same values in your git-ignored `.env.staging`.

#### `backblaze-read-only-keys-production`: Read-only manifest key and ledger read-only key for production, stored in Vercel and Railway

- Service: Independent backups (Backblaze B2 and age encryption)
- Verification: attestation
- Environments: production
- Secret names: `B2_MANIFEST_READ_KEY_ID`, `B2_MANIFEST_READ_APPLICATION_KEY`, `B2_LEDGER_READ_KEY_ID`, `B2_LEDGER_READ_APPLICATION_KEY`
- Status: production: pending

1. Create a read-only application key scoped to production's backup bucket (the application reads the newest manifest with it) and a read-only key scoped to the ledger bucket (the application and the backup service both read the ledger with it).
2. Store the manifest key ID and application key in the production Vercel project's variables. Store the ledger key ID and application key there and also in the production Railway backup service's variables. Production values never go in a local file, an env file or the repository, so this is an attestation and not a presence check.
3. Save an export of the production variable names outside the repository (the console shows variable names, never values), and record its file name as evidence.

#### `age-key-pair`: One age key pair for each environment; each private key held only in the Administrator's password manager

- Service: Independent backups (Backblaze B2 and age encryption)
- Verification: attestation
- Environments: staging, production
- Secret names: none
- Status: staging: pending; production: pending

1. Generate a separate pair for each environment with `age-keygen` on your own machine. Never reuse a pair across environments.
2. Store each private key only in your password manager, as its own entry. It never goes in the repository, Railway, Vercel, GitHub or any env file. Losing it makes that environment's dumps unreadable, and the Administrator page says so.
3. Keep each public key (the `age1` line) for `age-public-key` and `age-public-key-production`.
4. Write down the date each pair was generated and where its private key is stored, never the key itself, in a note kept outside the repository, and record its file name as evidence for each environment.

#### `age-public-key`: age public key set for staging's backup service

- Service: Independent backups (Backblaze B2 and age encryption)
- Verification: secret-present
- Environments: staging
- Secret names: `BACKUP_AGE_PUBLIC_KEY`
- Status: staging: checked from the process environment

1. Set `BACKUP_AGE_PUBLIC_KEY` to the public key of staging's own pair from `age-key-pair` in the Railway backup service's variables and in your git-ignored `.env.staging`.
2. It encrypts every dump and mirrored object. The backup service holds the public key only and can never decrypt a backup.

#### `age-public-key-production`: age public key set for production's backup service, stored in Railway

- Service: Independent backups (Backblaze B2 and age encryption)
- Verification: attestation
- Environments: production
- Secret names: `BACKUP_AGE_PUBLIC_KEY`
- Status: production: pending

1. Take the public key of production's own pair from `age-key-pair`; never reuse staging's pair.
2. Set `BACKUP_AGE_PUBLIC_KEY` to it in the production Railway backup service's variables, once that service exists. Production values never go in a local file, an env file or the repository, so this is an attestation and not a presence check.
3. Save an export of the production variable names outside the repository (the console shows variable names, never values), and record its file name as evidence.

### Due by Story 8.4

#### `supabase-restore-project-permission`: Permission to create and delete a restore project for the Story 8.4 drill

- Service: Supabase (Postgres, Auth, Storage)
- Verification: attestation
- Environments: staging
- Secret names: none
- Status: staging: pending

1. Confirm the Supabase organization may create a dedicated, temporary restore project for each drill, and that you will delete it afterwards. Its hourly cost is recorded at the first drill and sits outside the fixed monthly figure.
2. Write down your permission in a note kept outside the repository, and record its file name as evidence.

### Due by Story 8.7

#### `stripe-live-mode`: Stripe account verified and live mode enabled for production

- Service: Stripe (hosted Checkout payments)
- Verification: attestation
- Environments: production
- Secret names: none
- Status: production: pending

1. Once the production domain exists (Story 8.7), complete Stripe's account verification and activate live mode. Use live mode in production only: local and staging stay in test mode, and previews hold no Stripe keys.
2. Save an export of the account's activation status outside the repository, and record its file name as evidence.

#### `stripe-restricted-key-production`: Restricted Stripe API key for production (live mode), stored in Vercel

- Service: Stripe (hosted Checkout payments)
- Verification: attestation
- Environments: production
- Secret names: `STRIPE_RESTRICTED_KEY`
- Status: production: pending

1. Once the production domain exists, create a live-mode restricted API key with Checkout Sessions: write, and Charges and PaymentIntents: read, and nothing else.
2. Store it as `STRIPE_RESTRICTED_KEY` in the production Vercel project's variables (never in a preview). Production values never go in a local file, an env file or the repository, so this is an attestation and not a presence check.
3. Save an export of the production variable names outside the repository (the console shows variable names, never values), and record its file name as evidence.

#### `stripe-webhook-secret-production`: Stripe webhook endpoint and signing secret for production (live mode), stored in Vercel

- Service: Stripe (hosted Checkout payments)
- Verification: attestation
- Environments: production
- Secret names: `STRIPE_WEBHOOK_SECRET`
- Status: production: pending

1. In Stripe live mode add a webhook endpoint for the production domain, which only exists once production does (Story 8.7). Story 2.16 names the route path.
2. Store the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET` in the production Vercel project's variables (never in a preview). Production values never go in a local file, an env file or the repository, so this is an attestation and not a presence check.
3. Save an export of the production variable names outside the repository (the console shows variable names, never values), and record its file name as evidence.
