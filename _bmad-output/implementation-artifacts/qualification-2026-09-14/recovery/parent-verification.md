# Recovery qualification evidence — G-9 prototype

- Run: `20260914T154259Z`; generated UTC: `2026-09-14T15:43:04.531621+00:00`
- Overall: **PASS for local executable assertions; NOT a deployed nova3D/Supabase qualification**
- Duration: `4.54s`; disposable container: `nova3d-qualification-recovery-20260914-199321`
- Image: `postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`; limits: `--cpus=2 --memory=2g`; no host port published
- Retained raw evidence: `_bmad-output/implementation-artifacts/qualification-2026-09-14/recovery/raw/20260914T154259Z`; backup archive: `_bmad-output/implementation-artifacts/qualification-2026-09-14/recovery/raw/20260914T154259Z/database.dump` (22047 bytes), SHA-256 `ec62af2132fa3c629e2fc12a2d2263b5a70857b4cbd5e558785a7ef2eef091bc`; object snapshot: `_bmad-output/implementation-artifacts/qualification-2026-09-14/recovery/raw/20260914T154259Z/object-backup.tar` (10240 bytes), SHA-256 `3f7f2d80af6f220625a227823b45bf0bdca8804581d56145bb4f677299bc6a59`
- Persisted backup manifest: `_bmad-output/implementation-artifacts/qualification-2026-09-14/recovery/raw/20260914T154259Z/backup-manifest.json` (279 bytes), SHA-256 `bf34c68e8f3868beb171d3d406cbda1cf89cb1fe87992b8a02d5d8e1e2655efb`
- Independent restore-exclusion ledger: `_bmad-output/implementation-artifacts/qualification-2026-09-14/recovery/raw/20260914T154259Z/restore-exclusion-ledger.json` (597 bytes), SHA-256 `98000aaccf2fcfd4d292bcb23f00e71c92ff365da042f537c7e2e040b598b106`

## Results

### Pinned Postgres startup — **PASS**
- Command: `docker run -d --rm --name nova3d-qualification-recovery-20260914-199321 --cpus=2 --memory=2g -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=app postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`
- Inputs: Synthetic database; no host port; unique disposable container
- Observed: `ready; PostgreSQL 16`
- Scope/limitations: Container execution only; no deployment claim

### Independent database/object backup — **PASS**
- Command: `docker exec nova3d-qualification-recovery-20260914-199321 pg_dump -U postgres -Fc -d app > /home/josh/.cache/nova3d-qualification-20260914/recovery/20260914T154259Z/database.dump`
- Inputs: DB rows for two synthetic projects; object files with digests {'deleted': '74947a30a6e66980d2fd1281f1e2a4e3c1b517d027ffcff1a3269bb39cea635b', 'survivor': '70e76b18d6da9f780895e62a8c1740c3d58c5c368bdef47cc1f91007154ce766'}
- Observed: `database.dump=22047 bytes SHA-256=ec62af2132fa3c629e2fc12a2d2263b5a70857b4cbd5e558785a7ef2eef091bc; object snapshot SHA-256=3f7f2d80af6f220625a227823b45bf0bdca8804581d56145bb4f677299bc6a59; manifest=/home/josh/.cache/nova3d-qualification-20260914/recovery/20260914T154259Z/backup-manifest.json`
- Scope/limitations: Local backup files only; no managed backup retention evidence

### Corrupted backup rejected before restore — **PASS**
- Command: `verify /home/josh/.cache/nova3d-qualification-20260914/recovery/20260914T154259Z/database-corrupt.dump against /home/josh/.cache/nova3d-qualification-20260914/recovery/20260914T154259Z/backup-manifest.json`
- Inputs: One-byte-mutated synthetic pg_dump; object snapshot unchanged
- Observed: `rejected=True`
- Scope/limitations: Negative digest check only; no corruption recovery claim

### Deletion transaction and external ledger — **PASS**
- Command: `durably write intent; injected SQL ROLLBACK; then BEGIN; tombstone/hide; cancel; purge; COMMIT; active object purge`
- Inputs: Synthetic delete project/artifact plus job/outbox and object key
- Observed: `intent survived injected rollback; live DB rows and deleted object purged; committed ledger retained`
- Scope/limitations: Prototype ordering and ledger shape; fsync plus rollback injection, no actual power-loss simulation or production deletion service

### Restore with intervening deletion — **PASS**
- Command: `createdb app_restored; pg_restore -d app_restored /home/josh/.cache/nova3d-qualification-20260914/recovery/20260914T154259Z/database.dump; replay /home/josh/.cache/nova3d-qualification-20260914/recovery/20260914T154259Z/restore-exclusion-ledger.json before opening access`
- Inputs: Pre-delete pg_dump plus post-delete external ledger and object snapshot
- Observed: `deleted project/artifact/job absent; tombstone retained; survivor project/artifact/object digest intact`
- Scope/limitations: Synthetic Postgres/local object store; no cloud cross-provider path

### Stale worker callback rejected after deletion — **PASS**
- Command: `UPDATE ... WHERE deleted project is absent/status=active and expected account epoch/revision RETURNING id`
- Inputs: Old job token with account_epoch=7/project_revision=3 after deletion
- Observed: `RETURNING output: UPDATE 0`
- Scope/limitations: Post-deletion rejection only; does not test a live epoch/revision race or signed callback auth

### Concurrent unique full-regeneration slot — **PASS**
- Command: `two concurrent INSERTs on UNIQUE(lineage_id, full_regeneration)`
- Inputs: Same synthetic lineage and full_regeneration=true
- Observed: `slot_count=1; session_exit_codes=[0, 0]`
- Scope/limitations: SQL uniqueness race only; no Manufacturing application

### Idempotent local import — **PASS**
- Command: `repeat import_command(command_id,payload_digest)`
- Inputs: Same synthetic command/local request UUID twice
- Observed: `import_count=1; duplicate_result=duplicate; changed_payload_rejected=True; import_race=[0, 0] values=['duplicate', 'imported'] count=1`
- Scope/limitations: Prototype import table; no offline client

### Integer/rational reservation and parent ceiling — **PASS**
- Command: `reserve_operation plus two concurrent reservation calls`
- Inputs: USD integer microdollars; ceil(3/7 USD); parent Job ceiling 500,000
- Observed: `rational_ceiling=428572; duplicate_result=duplicate; account_race=[0, 3] reserved=100000; parent_race=[3, 0] reserved=100000; negatives=['missing_account=PASS', 'disabled_account=PASS', 'project_account_mismatch=PASS', 'job_missing=PASS', 'job_project_mismatch=PASS', 'zero_amount=PASS', 'null_amount=PASS', 'over_cap=PASS', 'changed_operation_amount=PASS']`
- Scope/limitations: Prototype Usage tables; no provider terms or live billing

### Disposable container cleanup — **PASS**
- Command: `docker rm -f nova3d-qualification-recovery-20260914-199321; docker inspect nova3d-qualification-recovery-20260914-199321`
- Inputs: Named probe container only
- Observed: `rm_exit=0; inspect_exit=1`
- Scope/limitations: Only this disposable container is targeted; no global prune

### Raw evidence archive — **PASS**
- Command: `copytree /home/josh/.cache/nova3d-qualification-20260914/recovery/20260914T154259Z -> _bmad-output/implementation-artifacts/qualification-2026-09-14/recovery/raw/20260914T154259Z`
- Inputs: Final run database.dump, object-backup.tar, restore-exclusion-ledger.json and logs
- Observed: `byte-for-byte verification passed for dump, object snapshot and ledger`
- Scope/limitations: Small local evidence archive; no production backup

## Reproduction and cleanup

`python3 tools/qualification/recovery/probe.py --report _bmad-output/implementation-artifacts/qualification-2026-09-14/recovery/parent-verification.md`
`docker rm -f nova3d-qualification-recovery-20260914-199321` (the probe performs this cleanup; no global prune)

## Explicit blockers / not run

- **BLOCKED / outside local scope:** actual Supabase/Vercel/Railway/Upstash plan, region, retention and backup settings; no production credentials or services were used.
- **BLOCKED / outside local scope:** provider callbacks, cloud object-provider retention/restore, session/invitation auth, and measured RPO/RTO24h/active purge24h/backup expiry30d.
- **NOT RUN:** full application data model, storage gateway chunk authorization, real worker signing, deployment topology, or crash-resume windows between database, object store and external ledger. This prototype uses synthetic SQL tables and local object files only.
