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

Story 1.3. Keyed hash of the platform-reported client address for the registration and recovery rate limiter, so no raw address is kept. Read only by the application.

- **Owner:** Administrator (Josh).
- **Generation:** 32 random bytes from a secure generator, for example `openssl rand -base64 32`, one value per environment.
- **Location:** local: `.env.local`; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** generate a new value, replace it in the environment's store, redeploy. Counters keyed by the old value age out within their window (an hour at most), so the limiter starts from zero briefly. Nothing else is keyed by it.
- **Cadence:** yearly, and at once on suspected compromise.

### INVITATION_HASH_KEY

Story 1.3. Keyed hash under which invitation codes are stored; only hashes are kept. Read only by the application.

- **Owner:** Administrator (Josh).
- **Generation:** 32 random bytes from a secure generator, for example `openssl rand -base64 32`, one value per environment.
- **Location:** local: `.env.local`; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** stored hashes depend on the key, so replacing it invalidates every outstanding code. Revoke or let outstanding invitations be redeemed first, replace the key in the store, redeploy, then mint the next general code from the Administrator page (it is shown once). If Story 1.3 adds key versions, keep the old version verify-only until the codes it covers are gone, and update this entry.
- **Cadence:** yearly, and at once on suspected compromise.

### RECOVERY_HASH_KEY

Story 1.6. Keyed hash under which the single-use Administrator recovery token is stored. Read only by the application.

- **Owner:** Administrator (Josh).
- **Generation:** 32 random bytes from a secure generator, for example `openssl rand -base64 32`, one value per environment.
- **Location:** local: `.env.local`; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** replace it in the environment's store and redeploy. At most one token is outstanding and it lasts 15 minutes, so any outstanding link simply stops working and a new one is requested.
- **Cadence:** yearly, and at once on suspected compromise.

## Service-signing keys

Story 1.12. Keys are Ed25519 pairs, one per issuer. The private half below is held only by its issuer; receivers hold public keys, which are not secret. One key is active and at most one is retiring for each issuer. The application's key also signs transfer tickets: there is no separate ticket key.

### SERVICE_SIGNING_KEY_APPLICATION

Signs transfer tickets and worker dispatches. Read only by the application.

- **Owner:** Administrator (Josh).
- **Generation:** an Ed25519 key pair, for example `openssl genpkey -algorithm ed25519`; keep the private half here and give the public half to the gateway and the workers.
- **Location:** local: `.env.local`; staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** add a new key as active under a new key ID, making the old one the single retiring key; receivers accept both for the outstanding-request window (at most five minutes plus 60 seconds of skew), then remove the retiring key. On suspected compromise, revoke the key and its affected leases at once.
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

Signs the scheduler-heartbeat task's posts. Read only by the heartbeat task.

- **Owner:** Administrator (Josh).
- **Generation:** an Ed25519 key pair, for example `openssl genpkey -algorithm ed25519`; keep the private half here and give the public half to the application.
- **Location:** local: `.env.local`; staging: the Railway heartbeat cron task's variables; production: the production Railway heartbeat cron task's variables once it exists.
- **Rotation:** add a new key as active under a new key ID, making the old one the single retiring key; the application accepts both for the outstanding-request window, then remove the retiring key. On suspected compromise, revoke the key and its affected leases at once.
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

Story 1.6. Sends the Administrator recovery link and operational alarm mail. Read only by the application.

- **Owner:** Administrator (Josh).
- **Generation:** in the Resend dashboard, an API key with sending access only, one per environment.
- **Location:** local: not used (Inbucket catches local mail); staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** create a new key in Resend, replace it in the environment's store, redeploy, then delete the old key.
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

Story 1.9. Publishes messages and manages schedules on the environment's own QStash queue (us-east-1). Read only by the application.

- **Owner:** Administrator (Josh).
- **Generation:** issued by the Upstash console for the environment's QStash; the token is region-specific. `QSTASH_URL` names the region endpoint and is not a secret.
- **Location:** local: not used (a local fake stands in); staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** reset the token in the Upstash console, replace it in the environment's store, redeploy; the old token stops working at once.
- **Cadence:** yearly, and at once on suspected compromise.

### QSTASH_CURRENT_SIGNING_KEY

Story 1.9. Verifies that a scheduled call really came from QStash. Read only by the application.

- **Owner:** Administrator (Josh).
- **Generation:** issued by the Upstash console for the environment's QStash; region-specific.
- **Location:** local: not used (a local fake stands in); staging: the staging Vercel project's Production-scope variables; production: the production Vercel project's variables once it exists.
- **Rotation:** use the console's signing-key rotation, which promotes the next key to current and issues a new next key; copy both values to the environment's store and redeploy.
- **Cadence:** yearly, and at once on suspected compromise.

### QSTASH_NEXT_SIGNING_KEY

Story 1.9. The key that becomes current at the next rotation, so verification continues across a rotation. Read only by the application.

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
- **Location:** local: exported in the shell before `supabase start`, as `docs/auth-setup.md` says; staging: the Supabase Auth provider settings, and the `staging` GitHub environment's secrets once Story 1.9 pushes configuration; production: the production project's provider settings once it exists.
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

## Storage keys

### GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY

Story 1.12. The file gateway's own Supabase Storage S3 key pair. Supabase cannot scope an S3 key below the project, and the key bypasses row policies, so only the gateway holds one. Read only by the gateway. `GATEWAY_STORAGE_S3_ACCESS_KEY_ID` is its identifier and is not secret.

- **Owner:** Administrator (Josh).
- **Generation:** in the Supabase dashboard's Storage S3 settings for the environment's own project.
- **Location:** local: not used (the local stack's Storage is reached with local credentials from `.env.local`); staging: the Railway gateway service's variables; production: the production Railway gateway service's variables once it exists.
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

These names sit beside secrets, in the provisioning ledger or in an entry above, but are not secret: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser-visible by design), `SUPABASE_PROJECT_REF`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `QSTASH_URL`, `UPSTASH_REDIS_REST_URL`, `VAPID_PUBLIC_KEY`, the Storage S3 access key IDs `GATEWAY_STORAGE_S3_ACCESS_KEY_ID` and `BACKUP_STORAGE_S3_ACCESS_KEY_ID`, and the Backblaze key identifiers `B2_BACKUP_KEY_ID`, `B2_MANIFEST_READ_KEY_ID`, `B2_LEDGER_READ_KEY_ID` and `B2_LEDGER_APPEND_KEY_ID`. Exposing one grants nothing on its own.
