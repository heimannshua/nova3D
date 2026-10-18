# Internal secrets register

This register names every secret nova3D depends on, who owns it, how it is generated, where it lives in each environment, and how and how often it is rotated. It holds names and procedures only. **No value, key, token, password or private key (the age private key and test keys included) is ever stored in this repository**; a unit test scans every tracked file for secret-shaped content. The accounts and spend limits behind the provider keys are in the [provisioning guide](provisioning.md), which also lists which of these names the checker looks for.

Names and procedures are provisional until the story that first uses a secret ships it. That story updates its entry in the same change.

## How to read an entry

Every entry has the same five fields:

- **Owner:** the person accountable for it. Every secret is owned by the Administrator (Josh), who generates, stores and rotates it; the entry's heading names the one component allowed to read it.
- **Generation:** how the value is created, and where it is created.
- **Location:** where it lives in `local`, `staging` and `production`. Local means the git-ignored `.env.local` or the shell. Staging and production mean the environment's own Vercel project variables (encrypted, Production scope; a preview holds none of these), Railway service variables, or the environment's GitHub secrets, as stated. Each environment has its own value; no secret is shared between environments, and production's does not exist until production is created (Story 8.7). Production values live only in those hosted stores, never in a local file or the repository, which is why the provisioning checker treats every production item as an attestation and reads no file for production.
- **Rotation:** the procedure to replace it.
- **Cadence:** every secret rotates yearly, and at once on suspected compromise.

Generate on your own machine, copy straight into the store, and never paste a value into a chat, a prompt, an issue or a commit. A secret that may have been exposed is rotated at once, whatever its schedule, and anything it protected is reviewed.

## Hashing keys (Identity)

### RATE_LIMIT_HASH_KEY

Story 1.3. Keyed hash (HMAC-SHA256) of the platform-reported client address for the registration rate limiter, so no raw address is kept. Since Story 1.8 the same hash keys the status route's per-origin counters (`POST /api/status`: 120 requests a minute from one origin), so no raw address is kept there either; no new variable was added for it. (Administrator recovery's limits, Story 1.6, are global and counted from its own rows: they use no client address and none of this key.) Read only by the application (`lib/accounts.ts`, and `lib/lifecycle.ts` for the status lookup). Required at startup in every environment except a preview, which must not hold it; checked for shape (base64, at least 32 bytes, different from the other two hashing keys).

- **Owner:** Administrator (Josh).
- **Generation:** 32 random bytes from a secure generator, for example `openssl rand -base64 32`, one value per environment.
- **Location:** local: `.env.local`; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** generate a new value, replace it in the environment's store, redeploy. Counters keyed by the old value age out within their window (an hour at most for registration, a minute for the status route), so the limiters start from zero briefly. Nothing else is keyed by it.
- **Cadence:** yearly, and at once on suspected compromise.

### INVITATION_HASH_KEY

Story 1.3. Keyed hash (HMAC-SHA256) under which invitation codes are stored; only hashes are kept. Read only by the application (`lib/accounts.ts`) and by the audited seed command (`scripts/seed-accounts.mjs`), which hashes a code before it reaches the database. Required at startup in every environment except a preview, which must not hold it; checked for shape (base64, at least 32 bytes, different from the other two hashing keys). `node scripts/setup-env.mjs local` generates all three local keys and keeps valid ones.

- **Owner:** Administrator (Josh).
- **Generation:** 32 random bytes from a secure generator, for example `openssl rand -base64 32`, one value per environment.
- **Location:** local: `.env.local`; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** stored hashes depend on the key, so replacing it invalidates every outstanding code. Revoke or let outstanding invitations be redeemed first, replace the key in the store, redeploy, then mint the next general code (it is shown once): from the Administrator page once Story 1.11 ships, until then with `npm run seed:accounts -- issue --general --replace`. Story 1.3 has no key versions, so there is no verify-only old key.
- **Cadence:** yearly, and at once on suspected compromise.

### RECOVERY_HASH_KEY

Story 1.6. Keyed hash (HMAC-SHA256, with its own domain label) under which the single-use Administrator recovery token is stored in `identity.recovery_tokens`; only hashes are kept, never a token. Read only by the application (`lib/accounts.ts`: it hashes a token when one is issued, checked, redeemed or voided). The audited seed command does not read it. Required at startup in every environment except a preview, which must not hold it; checked for shape (base64 text decoding to at least 32 bytes, different from `INVITATION_HASH_KEY` and `RATE_LIMIT_HASH_KEY` once decoded). `node scripts/setup-env.mjs local` generates it with the other two local keys and keeps a valid one.

- **Owner:** Administrator (Josh).
- **Generation:** 32 random bytes from a secure generator, for example `openssl rand -base64 32`, one value per environment.
- **Location:** local: `.env.local`; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** replace it in the environment's store and redeploy. Stored hashes depend on the key, so any outstanding recovery link stops working at once ("This link cannot be used"). That is fine: at most one token is outstanding and it lives 15 minutes. A new link can be requested once 15 minutes have passed since the last one was issued (the spacing limit counts every issuance, a link nobody can use any more included). Nothing else is keyed by it, so no other data is affected.
- **Cadence:** yearly, and at once on suspected compromise.

## Service-signing keys

Story 1.12. Keys are Ed25519 pairs, one per issuer. The private half below is held only by its issuer; receivers hold public keys, which are not secret. One key is active and at most one is retiring for each issuer. The application's key also signs transfer tickets and the commands it sends the file gateway: there is no separate ticket key. The heartbeat issuer's key signs the heartbeat of the Railway cron task (Story 1.13).

A **key set** is the public side: JSON of exactly `{"issuer": "<issuer>", "active": "<key ID>", "retiring": null or {"kid": "<key ID>", "until": "<ISO 8601 UTC time>"}, "keys": {"<key ID>": "<base64 SPKI Ed25519 public key>"}}`, with the named key IDs and no others in `keys`, at most one retiring key and an `until` whenever there is one. It is held in `SERVICE_KEYS_<ISSUER>` (for the application, `SERVICE_KEYS_APPLICATION`: not secret, in the application and in the file gateway). The private key is the base64 PKCS#8 of the ACTIVE key and is checked, at start-up of whatever holds it, to be the private half of the active public key. A token names the key that signed it (`kid`) and is accepted only from the active key, or from the retiring key before its `until`; a key that has been **revoked** is refused everywhere at once (`api.revoke_service_key(issuer, kid, reason)`, in the SQL editor or through the service role, which also ends every staging lease and transfer handle opened under that key). Every token is valid for at most five minutes, with at most 60 seconds of clock skew allowed.

To generate an application pair on your own machine, run this (it needs only Node, which the repository already requires, and writes no file):

```
node -e "const {generateKeyPairSync}=require('node:crypto');const k=generateKeyPairSync('ed25519');console.log('private (PKCS#8):',k.privateKey.export({type:'pkcs8',format:'der'}).toString('base64'));console.log('public (SPKI):',k.publicKey.export({type:'spki',format:'der'}).toString('base64'))"
```

The first line is the private half (the base64 PKCS#8 text, for `SERVICE_SIGNING_KEY_<ISSUER>`) and the second the public half (the base64 SPKI text, for the `keys` of the key set). Store the private half straight into the password manager and the environment's store, and clear the terminal's scrollback afterwards. If you make the pair with `openssl genpkey -algorithm ed25519 -out key.pem` instead (`openssl pkey -in key.pem -outform DER | openssl base64 -A` for the private half and `openssl pkey -in key.pem -pubout -outform DER | openssl base64 -A` for the public half), delete the private PEM, `key.pem`, as soon as both are stored: it is the private key in plain text. The key ID is a short label you choose, such as `application-2026-10`, and a revoked key ID is never reused: a rotation always uses a new one.

A retiring key's `until` must be no more than ten minutes after the moment the key set is read (a rotation needs six): a set with a later one is refused when it is read (the gateway exits at start-up, naming the variable, and the application treats its signing configuration as unset, so the ticket route answers 503), so a retiring key cannot be left valid for days by mistake. An `until` that has already passed is fine: it is how a finished rotation stays until the retiring key is removed from the set.

### SERVICE_SIGNING_KEY_APPLICATION

Signs transfer tickets (`POST /api/transfers/tickets`), the commands the application sends the file gateway (attach, delete-staging, delete-root) and, later, worker dispatches. Read only by the application, and never present in a preview (the environment check rejects any `SERVICE_SIGNING_KEY_*` name there, and the gateway's two secrets, `GATEWAY_DATABASE_URL` and `GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY`; the gateway's non-secret names are not on that list). The ticket route and the staging cleanup fail closed (503, `no_store`) when it is not set, so it is not on the list of variables a hosted deployment must hold.

- **Owner:** Administrator (Josh).
- **Generation:** an Ed25519 key pair (see above); keep the private half here, as base64 PKCS#8, and give the public key set (`SERVICE_KEYS_APPLICATION`, not secret) to the gateway and the workers.
- **Location:** local: `.env.local`, written with its public key set by `node scripts/setup-env.mjs local` (a random pair per machine, kept while it is valid); staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** add a new key as active under a new key ID, making the old one the single retiring key with an `until` six minutes ahead (a ticket lives five minutes, with a minute of skew); set the new key set in the gateway first and then in the application together with the new private key; receivers accept both for the outstanding-request window, then remove the retiring key from the set. On suspected compromise, revoke the key (`api.revoke_service_key`, which ends its leases and handles in the same transaction) and rotate at once: a ticket under a revoked key is refused immediately, whatever its `until`.
- **Cadence:** yearly, and at once on suspected compromise.

### SERVICE_SIGNING_KEY_GATEWAY

Signs the file gateway's own callbacks. Read only by the gateway.

- **Owner:** Administrator (Josh).
- **Generation:** an Ed25519 key pair, for example `openssl genpkey -algorithm ed25519`; keep the private half here and give the public half to the application.
- **Location:** local: `.env.local`; staging: the Railway gateway service's variables; production: the production Railway gateway service's variables once it exists.
- **Rotation:** add a new key as active under a new key ID, making the old one the single retiring key; the application accepts both for the outstanding-request window, then remove the retiring key. On suspected compromise, revoke the key and its affected leases at once.
- **Cadence:** yearly, and at once on suspected compromise.

### SERVICE_SIGNING_KEY_CAD_WORKER

Signs the CAD worker's callbacks. Read only by the CAD worker.

- **Owner:** Administrator (Josh).
- **Generation:** an Ed25519 key pair, for example `openssl genpkey -algorithm ed25519`; keep the private half here and give the public half to the application.
- **Location:** local: `.env.local`; staging: the Railway CAD worker service's variables; production: the production Railway CAD worker service's variables once it exists.
- **Rotation:** add a new key as active under a new key ID, making the old one the single retiring key; the application accepts both for the outstanding-request window, then remove the retiring key. On suspected compromise, revoke the key and its affected leases at once.
- **Cadence:** yearly, and at once on suspected compromise.

### SERVICE_SIGNING_KEY_ENGINE_WORKER

Signs the reconversion engine worker's callbacks. Read only by the engine worker.

- **Owner:** Administrator (Josh).
- **Generation:** an Ed25519 key pair, for example `openssl genpkey -algorithm ed25519`; keep the private half here and give the public half to the application.
- **Location:** local: `.env.local`; staging: the Railway engine worker service's variables; production: the production Railway engine worker service's variables once it exists.
- **Rotation:** add a new key as active under a new key ID, making the old one the single retiring key; the application accepts both for the outstanding-request window, then remove the retiring key. On suspected compromise, revoke the key and its affected leases at once.
- **Cadence:** yearly, and at once on suspected compromise.

### SERVICE_SIGNING_KEY_BACKUP_SERVICE

Signs the backup service's failure callbacks. Read only by the backup service.

- **Owner:** Administrator (Josh).
- **Generation:** an Ed25519 key pair, for example `openssl genpkey -algorithm ed25519`; keep the private half here and give the public half to the application.
- **Location:** local: `.env.local`; staging: the Railway backup service's variables; production: the production Railway backup service's variables once it exists.
- **Rotation:** add a new key as active under a new key ID, making the old one the single retiring key; the application accepts both for the outstanding-request window, then remove the retiring key. On suspected compromise, revoke the key and its affected leases at once.
- **Cadence:** yearly, and at once on suspected compromise.

### SERVICE_SIGNING_KEY_HEARTBEAT

Story 1.13. Signs the heartbeat that the Railway cron task (`workers/heartbeat`) posts to the application's `POST /api/heartbeat` every 30 minutes: a service token with `typ: "heartbeat"`, `iss: "heartbeat"` and `aud: "application"`, valid for five minutes, with no claim beyond the standard ones. Read only by the heartbeat task, which holds no other secret (no database access, no Storage key), and never present in a preview (the environment check rejects any `SERVICE_SIGNING_KEY_*` name there) or in the application: the application holds only the public key set, `SERVICE_KEYS_HEARTBEAT` (not secret; "Names that are not secrets", below), which it verifies the heartbeat with. The heartbeat route answers 503 and the monitor does not watch for a missing heartbeat (`heartbeat-stale`) while the application does not hold the key set, so the application does not require it. The task exits 1, naming the variable and never its value, when this or any of its other four variables (`APP_ENV`, `INSTANCE_ID`, `APP_ORIGIN`, `SERVICE_KEYS_HEARTBEAT`) is missing or malformed, or when this is not the private half of the key set's active key.

- **Owner:** Administrator (Josh).
- **Generation:** an Ed25519 key pair made on your own machine (the one-liner above); keep the private half here, as base64 PKCS#8, and give the public key set (`SERVICE_KEYS_HEARTBEAT`, the JSON `{"issuer": "heartbeat", ...}` with the key ID of your choice) to the application and to the task.
- **Location:** local: `.env.local`, written with its public key set by `node scripts/setup-env.mjs local` (a random pair per machine, kept while it is valid); staging: the Railway heartbeat cron task's variables; production: the production Railway heartbeat cron task's variables once it exists.
- **Rotation:** add a new key as active under a new key ID, making the old one the single retiring key with an `until` six minutes ahead; set the new key set in the application first and then in the task together with the new private key; the application accepts both for the outstanding-request window, then remove the retiring key from the set. On suspected compromise, revoke the key (`api.revoke_service_key('heartbeat', '<key ID>', 'compromise')`, in the SQL editor): the route refuses a token under a revoked key at once with its one `invalid_token` answer, whatever its time, and the monitor raises `heartbeat-stale` two hours after the last good heartbeat if you do not rotate; then rotate.
- **Cadence:** yearly, and at once on suspected compromise.

## Backup encryption (age)

### BACKUP_AGE_PUBLIC_KEY

Story 8.9. The age public key every dump and mirrored object of one environment is encrypted to. Each environment has its own age pair, so a compromised private key exposes only that environment's backups. It is public, but it is registered because replacing it changes what the backups can be read with. Read only by the backup service, which can therefore never decrypt a backup.

- **Owner:** Administrator (Josh).
- **Generation:** the public line of the environment's own pair, which `age-keygen` writes on your own machine (see `BACKUP_AGE_PRIVATE_KEY`).
- **Location:** local: `.env.local`, a throwaway public key from a test pair you generate yourself, never committed; staging: the Railway backup service's variables; production: the production Railway backup service's variables once it exists.
- **Rotation:** generate a new pair for that environment, set the new public key in its backup service and redeploy. New backups use it at once; keep the old private key (see `BACKUP_AGE_PRIVATE_KEY`).
- **Cadence:** yearly, and at once on suspected compromise.

### BACKUP_AGE_PRIVATE_KEY

Story 8.9. The age private key (identity) that decrypts one environment's backups; there is one for each environment. It is not an environment variable anywhere.

- **Owner:** Administrator (Josh).
- **Generation:** `age-keygen` on your own machine, once for each environment and never reused across environments; the secret line goes straight into the password manager and the file is deleted.
- **Location:** local: none, and a test private key is never committed; staging: none, held only in the Administrator's password manager as staging's own entry and supplied for each restore drill; production: none, held only in the password manager as production's own separate entry, never in any Railway, Vercel or GitHub store.
- **Rotation:** generate a new pair for that environment and rotate its `BACKUP_AGE_PUBLIC_KEY`. Keep the old private key in the password manager until no dump or mirrored object encrypted to it remains in the bucket; losing it makes those unreadable, and the Administrator page says so.
- **Cadence:** yearly, and at once on suspected compromise.

## Provider API keys

### RESEND_API_KEY

Story 1.6. The Bearer credential for `POST https://api.resend.com/emails`, used to mail the Administrator recovery link from the `resend.dev` sender (`onboarding@resend.dev`); since Story 1.13 the operational alarm mail (`sendAlarmMail`, the condition, the subject, the first time and the last receipt of the task, nothing private) goes through the same module, to the same address. Read only by the application, and only in `lib/mailer.ts`, which sends the recovery link and the alarm to `ADMINISTRATOR_EMAIL` alone (the recipient is not a parameter) and logs nothing. The `resend.dev` sender reaches only the address the Resend account is registered with, so that account must be the Administrator's (provisioning item `resend-account`). Required in staging and production (the server stops, and the Vercel build fails, without it), checked to be one token with no spaces; a preview must not hold it; local does not use it. The key needs sending access only.

- **Owner:** Administrator (Josh).
- **Generation:** in the Resend dashboard, an API key with sending access only, one per environment.
- **Location:** local: not used (with `APP_ENV=local` the mail goes to the Supabase stack's own Mailpit, `http://127.0.0.1:54324`, and never to Resend); staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** create a new key in Resend, replace it in the environment's store, redeploy, then delete the old key. Until the new one is deployed the Recover page answers "not available right now" and the audit holds `recovery.mail_failed`; a link already mailed keeps working, because the key is not part of the token.
- **Cadence:** yearly, and at once on suspected compromise.

### ANTHROPIC_API_KEY

Story 2.5. Evidence synthesis and vision calls. Read only by the application.

- **Owner:** Administrator (Josh).
- **Generation:** in the Anthropic Console, an API key created inside that environment's dedicated workspace, so its spend limit applies.
- **Location:** local: unset while `PAID_ADAPTERS_ENABLED=false`, and in `.env.local` only to test the real provider; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** create a new key in the same workspace, replace it in the environment's store, redeploy, then delete the old key.
- **Cadence:** yearly, and at once on suspected compromise.

### BRAVE_SEARCH_API_KEY

Story 2.5. Public-subject discovery search. Read only by the application, and only after the Brave terms review is recorded.

- **Owner:** Administrator (Josh).
- **Generation:** in the Brave Search API dashboard, one key per environment.
- **Location:** local: unset while `PAID_ADAPTERS_ENABLED=false`, and in `.env.local` only to test the real provider; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** create a new key, replace it in the environment's store, redeploy, then delete the old key.
- **Cadence:** yearly, and at once on suspected compromise.

### STRIPE_RESTRICTED_KEY

Story 2.16. Creates Checkout Sessions and reads charges. Restricted to Checkout Sessions: write and Charges and PaymentIntents: read. Read only by the application, and never present in a preview.

- **Owner:** Administrator (Josh).
- **Generation:** in the Stripe Dashboard, a restricted key with exactly those permissions, in test mode for staging and in live mode for production.
- **Location:** local: unset unless you use Stripe test mode through the Stripe CLI, then in `.env.local`; staging: the staging Vercel project's Production-scope variables (test mode); production: the production Vercel project's variables once it exists (live mode).
- **Rotation:** roll the key in the Stripe Dashboard, replace it in the environment's store, redeploy, then let the old key expire.
- **Cadence:** yearly, and at once on suspected compromise.

### STRIPE_WEBHOOK_SECRET

Story 2.16. Verifies Stripe's webhook signatures. Read only by the application, and never present in a preview.

- **Owner:** Administrator (Josh).
- **Generation:** created by Stripe with the environment's webhook endpoint, test mode for staging and live mode for production.
- **Location:** local: unset unless you forward test events with the Stripe CLI, then its own secret in `.env.local`; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** roll the endpoint's signing secret in the Stripe Dashboard, replace it in the environment's store, redeploy, then let the old secret expire.
- **Cadence:** yearly, and at once on suspected compromise.

### QSTASH_TOKEN

Story 1.9. Publishes messages and manages schedules on the environment's own QStash queue (us-east-1). Read by the operator's command `scripts/schedules.mjs`, which makes the live schedules equal the registry, and never by CI. Like every QStash name it is never set in a preview: the environment check rejects any `QSTASH_*` name there.

- **Owner:** Administrator (Josh).
- **Generation:** issued by the Upstash console for the environment's QStash; the token is region-specific. `QSTASH_URL` names the region endpoint and is not a secret.
- **Location:** local: not used (a local fake stands in); staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** reset the token in the Upstash console, replace it in the environment's store, redeploy; the old token stops working at once.
- **Cadence:** yearly, and at once on suspected compromise.

### QSTASH_CURRENT_SIGNING_KEY

Story 1.9. Verifies that a scheduled call really came from QStash (`POST /api/jobs`, over the raw body; the route answers 503 without both signing keys). Read only by the application. Never set in a preview.

- **Owner:** Administrator (Josh).
- **Generation:** issued by the Upstash console for the environment's QStash; region-specific.
- **Location:** local: not used (a local fake stands in); staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** use the console's signing-key rotation, which promotes the next key to current and issues a new next key; copy both values to the environment's store and redeploy.
- **Cadence:** yearly, and at once on suspected compromise.

### QSTASH_NEXT_SIGNING_KEY

Story 1.9. The key that becomes current at the next rotation, so verification continues across a rotation. Read only by the application. Never set in a preview.

- **Owner:** Administrator (Josh).
- **Generation:** issued by the Upstash console together with the current key; region-specific.
- **Location:** local: not used (a local fake stands in); staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** replaced together with `QSTASH_CURRENT_SIGNING_KEY` in the same console rotation.
- **Cadence:** yearly, and at once on suspected compromise.

### UPSTASH_REDIS_REST_TOKEN

Story 1.9. Access to the environment's Redis database, which holds only rate limiting and disposable coordination. Read only by the application. `UPSTASH_REDIS_REST_URL` names the database and is not a secret.

- **Owner:** Administrator (Josh).
- **Generation:** issued by the Upstash console for the environment's own database.
- **Location:** local: unset unless you test against the real service, then `.env.local`; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** reset the database token in the Upstash console, replace it in the environment's store, redeploy; the old token stops working at once.
- **Cadence:** yearly, and at once on suspected compromise.

### VAPID_PRIVATE_KEY

Story 7.7. Signs Web Push messages. Read only by the application. `VAPID_PUBLIC_KEY` is its public half and is not secret.

- **Owner:** Administrator (Josh).
- **Generation:** one VAPID key pair per environment, for example with `npx web-push generate-vapid-keys`; the private half also goes in the password manager.
- **Location:** local: `.env.local`; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** generate a new pair and replace both halves in the environment's store. Existing push subscriptions are bound to the old public key, so each device re-subscribes the next time it opens the app.
- **Cadence:** yearly, and at once on suspected compromise.

### SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET

Story 1.3. The Google OAuth client secret for sign-in. Read only by Supabase Auth, or by the Supabase CLI when it pushes configuration. `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` is not secret.

- **Owner:** Administrator (Josh).
- **Generation:** in Google Cloud, the secret of the environment's own OAuth web client; never reused across environments.
- **Location:** local: exported in the shell before `supabase start`, as `docs/auth-setup.md` says; staging: the Supabase Auth provider settings, and the `staging` GitHub environment's secrets (Story 1.9: `staging.yml` needs it, with the client ID, for `supabase config diff`); production: the production project's provider settings once it exists.
- **Rotation:** add a new secret to the client in Google Cloud, enter it where the environment holds it, confirm sign-in works, then disable the old secret.
- **Cadence:** yearly, and at once on suspected compromise.

## Database, platform and pipeline credentials

### SUPABASE_SERVICE_ROLE_KEY

Story 1.1 (in place). Server-only access that bypasses row policies. Read only by the application on the server, and never exposed to a browser, a preview or a worker.

- **Owner:** Administrator (Josh).
- **Generation:** issued by Supabase for the environment's own project.
- **Location:** local: `.env.local`, written by `node scripts/setup-env.mjs local` from the local stack; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** rotate it in the project's API key settings, replace it in the environment's store and in your local files, redeploy, then disable the old key. `npm run check:env -- --live` confirms the new value works.
- **Cadence:** yearly, and at once on suspected compromise.

### SUPABASE_DB_PASSWORD

Story 1.4. The staging database password the Supabase CLI and CI use to push migrations. Read only by CI.

- **Owner:** Administrator (Josh).
- **Generation:** a long random password from the password manager, set in the Supabase dashboard's database settings.
- **Location:** local: not used (the local stack has its own); staging: the `staging` GitHub environment's secrets; production: the production GitHub environment's secrets once it exists.
- **Rotation:** reset the database password in the Supabase dashboard, update the GitHub environment secret and anything else that connects with it, then confirm CI can still push.
- **Cadence:** yearly, and at once on suspected compromise.

### SUPABASE_ACCESS_TOKEN

Story 1.4. The personal access token the Supabase CLI and CI use to push configuration and migrations. Read only by CI.

- **Owner:** Administrator (Josh).
- **Generation:** in the Supabase dashboard, a personal access token named for nova3D CI.
- **Location:** local: not used by the application (export it in the shell only for a manual CLI session); staging: the `staging` GitHub environment's secrets; production: the production GitHub environment's secrets once it exists.
- **Rotation:** create a new token, update the GitHub environment secret, confirm CI works, then revoke the old token.
- **Cadence:** yearly, and at once on suspected compromise.

### GHCR_TOKEN

Story 1.9. Pushes worker images to GitHub Container Registry. Read only by CI.

- **Owner:** Administrator (Josh).
- **Generation:** a GitHub token that can push container images (a classic token with the `write:packages` scope), named for the worker pipeline.
- **Location:** local: not used; staging: the `staging` GitHub environment's secrets; production: the production GitHub environment's secrets once it exists.
- **Rotation:** create a new token, update the GitHub environment secret, confirm an image push works, then delete the old token.
- **Cadence:** yearly, and at once on suspected compromise.

### RAILWAY_TOKEN

Story 1.9. Deploys worker image digests to the Railway project. Read only by CI.

- **Owner:** Administrator (Josh).
- **Generation:** in the Railway project settings, a project token for the environment.
- **Location:** local: not used; staging: the `staging` GitHub environment's secrets; production: the production GitHub environment's secrets once it exists.
- **Rotation:** create a new project token, update the GitHub environment secret, confirm a deploy works, then delete the old token.
- **Cadence:** yearly, and at once on suspected compromise.

### VERCEL_STAGING_DEPLOY_HOOK

Story 1.9. The deploy hook URL of the staging Vercel project (made for the `staging` branch in the project's Git settings). `.github/workflows/staging.yml` posts to it after the migrations are applied, so a deployment always follows them. Vercel documents that anyone who holds the URL can deploy the project, so it is a secret. Read only by that workflow, from the environment, and never printed.

- **Owner:** Administrator (Josh).
- **Generation:** in the staging Vercel project's Settings, Git, Deploy Hooks, a hook named for the pipeline and bound to the `staging` branch.
- **Location:** local: not used; staging: the `staging` GitHub environment's secrets; production: none (the production workflow never deploys, and the production project does not exist until Story 8.7).
- **Rotation:** create a new hook in Vercel, update the GitHub environment secret, push to `staging` and confirm a deployment is triggered, then delete the old hook. If the URL may have been exposed, delete the hook first.
- **Cadence:** yearly, and at once on suspected compromise.

### GATEWAY_DATABASE_URL

Story 1.12. The connection string of the file gateway's own database role, `nova3d_gateway`: a role that can read the two authorization views and insert and read the redemption, handle and lease records, and execute `artifacts.publish_attachment`, and nothing else (it holds no `api`, `identity`, `projects` or `lifecycle` object, and not the service-role key). Read only by the gateway, and never present in a preview (the environment check rejects the name there). The role is created by a migration WITHOUT a password, so the password exists only where this string does.

- **Owner:** Administrator (Josh).
- **Generation:** a long random password from the password manager, set by hand on the role in the Supabase dashboard's SQL editor (`alter role nova3d_gateway with password`, the password in quotes), and the connection string for the Supabase pooler in transaction mode (the user is `nova3d_gateway.<project-ref>`), ending in `?sslmode=require` (or `verify-ca` or `verify-full`): the gateway refuses to start for staging or production with a URL that does not ask for TLS, and a hosted database is reached over the network.
- **Location:** local: the stack's direct connection with the local password that `supabase/seed.sql` sets, written to `.env.local` by `node scripts/setup-env.mjs local`; staging: the Railway gateway service's variables; production: the production Railway gateway service's variables once it exists.
- **Rotation:** set a new password on the role, replace the string in the gateway service and redeploy, confirm a transfer works. Until it is replaced the gateway cannot reach the database and answers 503, which is the safe answer.
- **Cadence:** yearly, and at once on suspected compromise.

## Storage keys

### GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY

Story 1.12. The file gateway's own Supabase Storage S3 key pair. Supabase cannot scope an S3 key below the project, and the key bypasses row policies, so only the gateway holds one. Read only by the gateway, and never present in a preview (the environment check rejects the name there). `GATEWAY_STORAGE_S3_ACCESS_KEY_ID` is its identifier and is not secret.

- **Owner:** Administrator (Josh).
- **Generation:** in the Supabase dashboard's Storage S3 settings for the environment's own project.
- **Location:** local: the stack's own S3 key pair, written to `.env.local` by `node scripts/setup-env.mjs local` (it opens the local Storage only); staging: the Railway gateway service's variables; production: the production Railway gateway service's variables once it exists.
- **Rotation:** create a new key pair, replace both values in the gateway service, redeploy, confirm a transfer works, then delete the old pair.
- **Cadence:** yearly, and at once on suspected compromise.

### BACKUP_STORAGE_S3_SECRET_ACCESS_KEY

Story 8.9. The backup service's own Supabase Storage S3 key pair, used to read objects for the mirror. Read only by the backup service. `BACKUP_STORAGE_S3_ACCESS_KEY_ID` is its identifier and is not secret.

- **Owner:** Administrator (Josh).
- **Generation:** in the Supabase dashboard's Storage S3 settings for the environment's own project, separate from the gateway's pair.
- **Location:** local: not used; staging: the Railway backup service's variables; production: the production Railway backup service's variables once it exists.
- **Rotation:** create a new key pair, replace both values in the backup service, redeploy, confirm a run completes, then delete the old pair.
- **Cadence:** yearly, and at once on suspected compromise.

### B2_BACKUP_APPLICATION_KEY

Story 8.9. The backup service's Backblaze key, scoped to the environment's backup bucket. Read only by the backup service. `B2_BACKUP_KEY_ID` is its identifier and is not secret.

- **Owner:** Administrator (Josh).
- **Generation:** in the Backblaze account, an application key limited to the environment's backup bucket.
- **Location:** local: not used; staging: the Railway backup service's variables; production: the production Railway backup service's variables once it exists.
- **Rotation:** create a new key with the same bucket scope, replace it in the backup service, redeploy, confirm a run completes, then delete the old key.
- **Cadence:** yearly, and at once on suspected compromise.

### B2_MANIFEST_READ_APPLICATION_KEY

Story 1.10 and Story 8.9. A read-only Backblaze key scoped to the environment's backup bucket, used by the scheduled route that reads the newest manifest. Read only by the application. `B2_MANIFEST_READ_KEY_ID` is its identifier and is not secret.

- **Owner:** Administrator (Josh).
- **Generation:** in the Backblaze account, an application key with read-only capabilities limited to the environment's backup bucket.
- **Location:** local: not used; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** create a new read-only key with the same scope, replace it in the environment's store, redeploy, then delete the old key.
- **Cadence:** yearly, and at once on suspected compromise.

### B2_LEDGER_READ_APPLICATION_KEY

Story 1.10 and Story 8.9. A read-only Backblaze key scoped to the ledger bucket, used to read the restore ledger. Read by the application and the backup service. `B2_LEDGER_READ_KEY_ID` is its identifier and is not secret.

- **Owner:** Administrator (Josh).
- **Generation:** in the Backblaze account, an application key with read-only capabilities limited to the ledger bucket.
- **Location:** local: not used; staging: the staging Vercel project's Production-scope variables and the Railway backup service's variables; production: the same two stores of the production projects once they exist.
- **Rotation:** create a new read-only key with the same scope, replace it in both stores, redeploy, then delete the old key.
- **Cadence:** yearly, and at once on suspected compromise.

### B2_LEDGER_APPEND_APPLICATION_KEY

Story 8.9. The application's Backblaze key for the ledger bucket, intended to create files but not delete or hide them (whether Backblaze's S3-compatible API enforces that is confirmed in Story 8.9 and gate G-9). Read only by the application. `B2_LEDGER_APPEND_KEY_ID` is its identifier and is not secret.

- **Owner:** Administrator (Josh).
- **Generation:** in the Backblaze account, an application key limited to the ledger bucket and intended to write new files without deleting or hiding any; the append-only behaviour is intended and is confirmed in Story 8.9 and gate G-9.
- **Location:** local: not used; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** create a new key with the same limits, replace it in the environment's store, redeploy, confirm a ledger event is written, then delete the old key.
- **Cadence:** yearly, and at once on suspected compromise.

### B2_RESTORE_OPERATOR_APPLICATION_KEY

Story 8.4. The separate operator key the restore tooling uses to write the restore lock and the completion event in the ledger bucket. Read only by the Administrator while a restore runs.

- **Owner:** Administrator (Josh).
- **Generation:** in the Backblaze account, an application key limited to the ledger bucket, separate from every key the application and the backup service hold.
- **Location:** local: not used; staging: none in any service, held in the Administrator's password manager and exported in the shell only for a restore; production: the same password-manager copy, never in Vercel, Railway or GitHub.
- **Rotation:** create a new key with the same limits, store it in the password manager, delete the old key. Rotate right after every restore drill.
- **Cadence:** yearly, and at once on suspected compromise.

## Names that are not secrets

These names sit beside secrets, in the provisioning ledger or in an entry above, but are not secret: `APP_ORIGIN` (the https origin of the deployed application, Story 1.6: the link in the recovery mail points at it, so it is required in staging and production and is an ordinary, readable setting; see `docs/deployment-setup.md`), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser-visible by design), `SUPABASE_PROJECT_REF`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `QSTASH_URL`, `STAGING_SITE_URL` (Story 1.9: the https origin of the staging deployment, from which `scripts/staging-config.mjs` writes the scratch `config.toml` that `staging.yml` diffs the live Auth settings against; it is stored as a secret of the `staging` GitHub environment only so that the workflow reads every input the same way), `UPSTASH_REDIS_REST_URL`, `VAPID_PUBLIC_KEY`, the application issuer's public key set `SERVICE_KEYS_APPLICATION` (Story 1.12: the public keys that verify its tickets and commands; the gateway and the application hold it), the heartbeat issuer's public key set `SERVICE_KEYS_HEARTBEAT` (Story 1.13: the public keys that verify the Railway cron task's heartbeat; the application and the task hold it, it is optional in the application, and the monitor watches for a missing heartbeat only once the application has it), `FILE_GATEWAY_URL` (the https origin of the file gateway, which the application hands to a browser with every ticket), the gateway's Storage endpoint and region `GATEWAY_STORAGE_S3_ENDPOINT` and `GATEWAY_STORAGE_S3_REGION`, the Storage S3 access key IDs `GATEWAY_STORAGE_S3_ACCESS_KEY_ID` and `BACKUP_STORAGE_S3_ACCESS_KEY_ID`, and the Backblaze key identifiers `B2_BACKUP_KEY_ID`, `B2_MANIFEST_READ_KEY_ID`, `B2_LEDGER_READ_KEY_ID` and `B2_LEDGER_APPEND_KEY_ID`. Exposing one grants nothing on its own.
