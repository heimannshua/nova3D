#!/usr/bin/env python3
"""Local, synthetic G-9 recovery qualification probe.

This is an integration prototype only. It is not the nova3D application,
Supabase policy evidence, or a deployment qualification.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


IMAGE = "postgres:16-alpine"
IMAGE_DIGEST = "sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685"
PINNED_IMAGE = f"{IMAGE}@{IMAGE_DIGEST}"
ACCOUNT = "acct-synthetic-001"
ACCOUNT_RACE = "acct-race-001"
PROJECT_DELETE = "proj-delete-001"
PROJECT_SURVIVE = "proj-survive-001"
PROJECT_OTHER = "proj-other-001"
ARTIFACT_DELETE = "artifact-delete-001"
ARTIFACT_SURVIVE = "artifact-survive-001"

SCHEMA = r"""
CREATE TABLE accounts (
  id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('active','disabled','tombstoned')),
  authorization_epoch integer NOT NULL
);
CREATE TABLE projects (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  status text NOT NULL CHECK (status IN ('active','tombstoned')),
  revision integer NOT NULL,
  UNIQUE (account_id, id)
);
CREATE TABLE artifacts (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  object_key text NOT NULL UNIQUE,
  content_digest text NOT NULL,
  committed boolean NOT NULL
);
CREATE TABLE jobs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  expected_account_epoch integer NOT NULL,
  expected_project_revision integer NOT NULL,
  status text NOT NULL,
  result text
);
CREATE TABLE deletion_tombstones (
  project_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  deleted_at timestamptz NOT NULL,
  opaque_ledger_id text NOT NULL UNIQUE
);
CREATE TABLE dispatch_outbox (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  job_id text NOT NULL,
  payload_digest text NOT NULL
);
CREATE TABLE local_imports (
  command_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  local_request_id text NOT NULL,
  payload_digest text NOT NULL,
  project_id text NOT NULL,
  UNIQUE (account_id, local_request_id)
);
CREATE TABLE regeneration_slots (
  lineage_id text NOT NULL,
  full_regeneration boolean NOT NULL,
  command_id text NOT NULL UNIQUE,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lineage_id, full_regeneration)
);
CREATE TABLE usage_periods (
  account_id text NOT NULL REFERENCES accounts(id),
  period text NOT NULL,
  ceiling_microdollars bigint NOT NULL,
  reserved_microdollars bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, period)
);
CREATE TABLE usage_jobs (
  job_id text PRIMARY KEY REFERENCES jobs(id),
  project_id text NOT NULL REFERENCES projects(id),
  ceiling_microdollars bigint NOT NULL,
  reserved_microdollars bigint NOT NULL DEFAULT 0
);
CREATE TABLE usage_operations (
  operation_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  account_id text NOT NULL,
  project_id text NOT NULL,
  job_id text NOT NULL,
  max_microdollars bigint NOT NULL
);

CREATE OR REPLACE FUNCTION reserve_operation(
  p_operation_id text, p_idempotency_key text, p_account_id text,
  p_project_id text, p_job_id text, p_max bigint
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_period usage_periods%ROWTYPE; v_job usage_jobs%ROWTYPE;
        v_existing usage_operations%ROWTYPE; v_account_status text;
        v_project_account text; v_job_project text;
BEGIN
  IF p_max <= 0 OR p_max > 1000000 THEN
    RAISE EXCEPTION 'operation_cap_or_positive';
  END IF;
  IF p_max IS NULL THEN
    RAISE EXCEPTION 'operation_cap_or_positive';
  END IF;
  SELECT status INTO v_account_status FROM accounts WHERE id = p_account_id;
  IF v_account_status IS NULL THEN
    RAISE EXCEPTION 'account_missing';
  END IF;
  IF v_account_status <> 'active' THEN
    RAISE EXCEPTION 'account_not_active';
  END IF;
  SELECT account_id INTO v_project_account FROM projects WHERE id = p_project_id;
  IF v_project_account IS NULL THEN
    RAISE EXCEPTION 'project_missing';
  END IF;
  IF v_project_account <> p_account_id THEN
    RAISE EXCEPTION 'project_account_mismatch';
  END IF;
  SELECT project_id INTO v_job_project FROM jobs WHERE id = p_job_id;
  IF v_job_project IS NULL THEN
    RAISE EXCEPTION 'job_missing';
  END IF;
  IF v_job_project <> p_project_id THEN
    RAISE EXCEPTION 'job_project_mismatch';
  END IF;
  SELECT * INTO v_existing FROM usage_operations
    WHERE idempotency_key = p_idempotency_key OR operation_id = p_operation_id
    FOR UPDATE;
  IF FOUND THEN
    IF v_existing.operation_id <> p_operation_id
       OR v_existing.account_id <> p_account_id
       OR v_existing.project_id <> p_project_id
       OR v_existing.job_id <> p_job_id
       OR v_existing.max_microdollars <> p_max THEN
      RAISE EXCEPTION 'operation_identity_or_amount_mismatch';
    END IF;
    RETURN 'duplicate';
  END IF;
  SELECT * INTO v_period FROM usage_periods
    WHERE account_id = p_account_id AND period = '2026-09' FOR UPDATE;
  IF v_period.account_id IS NULL THEN
    RAISE EXCEPTION 'account_missing';
  END IF;
  SELECT * INTO v_job FROM usage_jobs WHERE job_id = p_job_id FOR UPDATE;
  IF v_job.job_id IS NULL THEN
    RAISE EXCEPTION 'job_missing';
  END IF;
  IF v_period.reserved_microdollars + p_max > v_period.ceiling_microdollars THEN
    RAISE EXCEPTION 'account_ceiling';
  END IF;
  IF v_job.reserved_microdollars + p_max > v_job.ceiling_microdollars THEN
    RAISE EXCEPTION 'parent_job_ceiling';
  END IF;
  INSERT INTO usage_operations VALUES (p_operation_id, p_idempotency_key,
    p_account_id, p_project_id, p_job_id, p_max);
  UPDATE usage_periods SET reserved_microdollars = reserved_microdollars + p_max
    WHERE account_id = p_account_id AND period = '2026-09';
  UPDATE usage_jobs SET reserved_microdollars = reserved_microdollars + p_max
    WHERE job_id = p_job_id;
  RETURN 'reserved';
END $$;

CREATE OR REPLACE FUNCTION import_command(
  p_command_id text, p_account_id text, p_local_request_id text,
  p_payload_digest text, p_project_id text
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_payload text;
BEGIN
  INSERT INTO local_imports VALUES (p_command_id, p_account_id, p_local_request_id,
    p_payload_digest, p_project_id) ON CONFLICT DO NOTHING;
  IF FOUND THEN
    RETURN 'imported';
  END IF;
  SELECT payload_digest INTO v_payload FROM local_imports
    WHERE command_id = p_command_id
       OR (account_id = p_account_id AND local_request_id = p_local_request_id)
    FOR UPDATE;
  IF FOUND THEN
    IF v_payload <> p_payload_digest THEN
      RAISE EXCEPTION 'command_payload_mismatch';
    END IF;
    RETURN 'duplicate';
  END IF;
  RAISE EXCEPTION 'import_race_resolution_failed';
END $$;
"""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Probe:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.logs = self.root / "logs"
        self.logs.mkdir(exist_ok=True)
        self.container = f"nova3d-qualification-recovery-20260914-{os.getpid()}"
        self.results: list[dict[str, object]] = []
        self.started = time.monotonic()
        self.container_started = False

    def record(self, name: str, command: str, inputs: str, output: str,
               status: str, scope: str) -> None:
        self.results.append({"name": name, "command": command, "inputs": inputs,
                             "output": output.strip(), "status": status,
                             "scope": scope})

    def run(self, args: list[str], *, stdin: str | None = None,
            check: bool = True, timeout: int = 60,
            log_name: str | None = None) -> subprocess.CompletedProcess[str]:
        cp = subprocess.run(args, input=stdin, text=True, capture_output=True,
                            timeout=timeout, check=False)
        if log_name:
            (self.logs / log_name).write_text(
                f"$ {' '.join(args)}\nstdout:\n{cp.stdout}\nstderr:\n{cp.stderr}\n")
        if check and cp.returncode != 0:
            raise RuntimeError(f"command failed ({cp.returncode}): {' '.join(args)}\n{cp.stderr}")
        return cp

    def docker(self, args: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
        return self.run(["docker", *args], **kwargs)

    def psql(self, db: str, sql: str, *, check: bool = True,
             log_name: str | None = None) -> str:
        return self.psql_cp(db, sql, check=check, log_name=log_name).stdout.strip()

    def psql_cp(self, db: str, sql: str, *, check: bool = True,
                log_name: str | None = None) -> subprocess.CompletedProcess[str]:
        cp = self.docker(["exec", "-i", self.container, "psql", "-X", "-U", "postgres", "-v",
                          "ON_ERROR_STOP=1", "-At", "-d", db], stdin=sql,
                         check=check, log_name=log_name)
        return cp

    def start(self) -> None:
        self.docker(["run", "-d", "--rm", "--name", self.container,
                     "--cpus=2", "--memory=2g", "-e", "POSTGRES_PASSWORD=synthetic",
                     "-e", "POSTGRES_DB=app", PINNED_IMAGE])
        self.container_started = True
        for _ in range(60):
            cp = self.docker(["exec", self.container, "psql", "-X", "-U", "postgres", "-At",
                              "-d", "postgres", "-c", "SELECT 1 FROM pg_database WHERE datname='app'"], check=False)
            if cp.returncode == 0 and cp.stdout.strip() == "1":
                return
            time.sleep(0.5)
        raise RuntimeError("Postgres did not become ready")

    def stop(self) -> None:
        self.docker(["logs", self.container], check=False, log_name="container.log")
        if not self.container_started:
            return
        removed = self.docker(["rm", "-f", self.container], check=False)
        inspected = self.docker(["inspect", self.container], check=False)
        cleanup_pass = removed.returncode == 0 and inspected.returncode != 0
        self.record("Disposable container cleanup", f"docker rm -f {self.container}; docker inspect {self.container}",
                    "Named probe container only", f"rm_exit={removed.returncode}; inspect_exit={inspected.returncode}",
                    "PASS" if cleanup_pass else "FAIL", "Only this disposable container is targeted; no global prune")
        self.container_started = False

    def seed(self, object_store: Path) -> dict[str, str]:
        deleted = b"synthetic deleted artifact bytes\n"
        survivor = b"synthetic survivor artifact bytes\n"
        (object_store / "objects").mkdir(parents=True, exist_ok=True)
        (object_store / "objects" / "deleted.bin").write_bytes(deleted)
        (object_store / "objects" / "survivor.bin").write_bytes(survivor)
        ddel, dsurv = digest(deleted), digest(survivor)
        sql = SCHEMA + f"""
INSERT INTO accounts VALUES ('{ACCOUNT}', 'active', 7);
INSERT INTO accounts VALUES ('{ACCOUNT_RACE}', 'active', 2);
INSERT INTO accounts VALUES ('acct-disabled-001', 'disabled', 3);
INSERT INTO projects VALUES ('{PROJECT_DELETE}', '{ACCOUNT}', 'active', 3);
INSERT INTO projects VALUES ('{PROJECT_SURVIVE}', '{ACCOUNT}', 'active', 4);
INSERT INTO projects VALUES ('{PROJECT_OTHER}', '{ACCOUNT_RACE}', 'active', 1);
INSERT INTO artifacts VALUES ('{ARTIFACT_DELETE}', '{PROJECT_DELETE}', 'objects/deleted.bin', '{ddel}', true);
INSERT INTO artifacts VALUES ('{ARTIFACT_SURVIVE}', '{PROJECT_SURVIVE}', 'objects/survivor.bin', '{dsurv}', true);
INSERT INTO jobs VALUES ('job-delete-001', '{PROJECT_DELETE}', 7, 3, 'running', NULL);
INSERT INTO jobs VALUES ('job-survive-001', '{PROJECT_SURVIVE}', 7, 4, 'completed', 'survivor-ok');
INSERT INTO jobs VALUES ('job-parent-race-001', '{PROJECT_SURVIVE}', 7, 4, 'waiting', NULL);
INSERT INTO jobs VALUES ('job-account-race-001', '{PROJECT_OTHER}', 2, 1, 'waiting', NULL);
INSERT INTO jobs VALUES ('job-other-001', '{PROJECT_OTHER}', 2, 1, 'waiting', NULL);
INSERT INTO dispatch_outbox VALUES ('outbox-delete-001', 'dispatch-delete-001', 'job-delete-001', 'input-digest-delete');
INSERT INTO usage_periods VALUES ('{ACCOUNT}', '2026-09', 1000000, 0);
INSERT INTO usage_periods VALUES ('{ACCOUNT_RACE}', '2026-09', 150000, 0);
INSERT INTO usage_jobs VALUES ('job-survive-001', '{PROJECT_SURVIVE}', 500000, 0);
INSERT INTO usage_jobs VALUES ('job-parent-race-001', '{PROJECT_SURVIVE}', 150000, 0);
INSERT INTO usage_jobs VALUES ('job-account-race-001', '{PROJECT_SURVIVE}', 200000, 0);
"""
        self.psql("app", sql, log_name="seed.log")
        return {"deleted": ddel, "survivor": dsurv}

    def dump(self, dump_path: Path) -> str:
        # pg_dump and pg_restore are both executed inside the pinned image.
        cp = subprocess.run(["docker", "exec", self.container, "pg_dump", "-U", "postgres",
                             "-Fc", "-d", "app"], capture_output=True, check=False)
        (self.logs / "pg_dump.log").write_text(
            "$ docker exec " + self.container + " pg_dump -U postgres -Fc -d app\n"
            f"exit={cp.returncode}; stderr:\n{cp.stderr.decode(errors='replace')}\n")
        if cp.returncode != 0:
            raise RuntimeError(f"pg_dump failed: {cp.stderr.decode(errors='replace')}")
        dump_path.write_bytes(cp.stdout)
        if not dump_path.stat().st_size:
            raise RuntimeError("pg_dump produced an empty archive")
        return digest(dump_path.read_bytes())

    def write_backup_manifest(self, manifest_path: Path, dump_path: Path,
                              snapshot_path: Path) -> dict[str, str]:
        manifest = {
            "schema": "backup-manifest.v1",
            "database_dump_sha256": digest(dump_path.read_bytes()),
            "object_snapshot_sha256": digest(snapshot_path.read_bytes()),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self._write_ledger(manifest_path, manifest)
        return manifest

    def verify_backup_inputs(self, dump_path: Path, snapshot_path: Path,
                             manifest_path: Path) -> dict[str, str]:
        manifest = json.loads(manifest_path.read_text())
        observed = {
            "database_dump_sha256": digest(dump_path.read_bytes()),
            "object_snapshot_sha256": digest(snapshot_path.read_bytes()),
        }
        for key, actual in observed.items():
            if actual != manifest[key]:
                raise ValueError(f"backup_digest_mismatch:{key}")
        return observed

    def copy_objects_snapshot(self, object_store: Path, snapshot: Path) -> str:
        with tarfile.open(snapshot, "w") as tf:
            tf.add(object_store / "objects", arcname="objects")
        return digest(snapshot.read_bytes())

    def _write_ledger(self, ledger_path: Path, ledger: dict[str, object]) -> None:
        ledger_path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=f".{ledger_path.name}.", dir=ledger_path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(json.dumps(ledger, indent=2) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, ledger_path)
            parent_fd = os.open(ledger_path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def deletion(self, ledger_path: Path, object_store: Path) -> None:
        # Persist deletion intent outside the database *before* the transaction.
        # A deliberate rollback injection proves the intent survives a DB crash.
        started = datetime.now(timezone.utc).isoformat()
        ledger = {
            "schema": "recovery-ledger.v1",
            "status": "intent",
            "created_at": started,
            "entries": [{
                "opaque_target": "ledger-opaque-delete-001",
                "project_id": PROJECT_DELETE,
                "artifact_id": ARTIFACT_DELETE,
                "object_keys": ["objects/deleted.bin"],
                "database_tables": ["projects", "artifacts", "jobs", "dispatch_outbox"],
                "deletion_started_at": started,
            }],
        }
        self._write_ledger(ledger_path, ledger)
        injected = self.psql("app", f"""
BEGIN;
UPDATE projects SET status='tombstoned', revision=revision+1 WHERE id='{PROJECT_DELETE}' AND status='active';
INSERT INTO deletion_tombstones(project_id, artifact_id, deleted_at, opaque_ledger_id)
VALUES ('{PROJECT_DELETE}', '{ARTIFACT_DELETE}', now(), 'ledger-opaque-delete-001');
ROLLBACK;
""", log_name="delete-failure-injection-rollback.log")
        if self.psql("app", f"SELECT count(*) FROM projects WHERE id='{PROJECT_DELETE}';") != "1":
            raise AssertionError("rollback injection unexpectedly changed live DB")
        if json.loads(ledger_path.read_text())["status"] != "intent":
            raise AssertionError("pre-commit deletion intent was not durable")

        # The SQL transaction revokes/hides first, then purges private rows.
        self.psql("app", f"""
BEGIN;
UPDATE projects SET status='tombstoned', revision=revision+1 WHERE id='{PROJECT_DELETE}' AND status='active';
UPDATE jobs SET status='cancelled', result='cancelled-by-deletion' WHERE project_id='{PROJECT_DELETE}' AND status <> 'completed';
INSERT INTO deletion_tombstones(project_id, artifact_id, deleted_at, opaque_ledger_id)
VALUES ('{PROJECT_DELETE}', '{ARTIFACT_DELETE}', now(), 'ledger-opaque-delete-001');
DELETE FROM dispatch_outbox WHERE job_id='job-delete-001';
DELETE FROM jobs WHERE project_id='{PROJECT_DELETE}';
DELETE FROM artifacts WHERE project_id='{PROJECT_DELETE}';
DELETE FROM projects WHERE id='{PROJECT_DELETE}';
COMMIT;
""", log_name="delete.log")
        deleted_object = object_store / "objects" / "deleted.bin"
        if deleted_object.exists():
            deleted_object.unlink()
        if deleted_object.exists():
            raise AssertionError("active deleted object purge failed")
        ledger["status"] = "committed_and_active_purged"
        ledger["committed_at"] = datetime.now(timezone.utc).isoformat()
        self._write_ledger(ledger_path, ledger)

    def restore(self, dump_path: Path, restored_objects: Path,
                snapshot: Path, ledger_path: Path, manifest_path: Path,
                digests: dict[str, str]) -> None:
        # Verify both stores against the persisted manifest before creating the
        # restored DB or extracting any object bytes.
        self.verify_backup_inputs(dump_path, snapshot, manifest_path)
        self.psql("postgres", "DROP DATABASE IF EXISTS app_restored; CREATE DATABASE app_restored;",
                   log_name="create-restored-db.log")
        # Copy archive into container through stdin, then restore with image-native pg_restore.
        self.docker(["cp", str(dump_path), f"{self.container}:/tmp/app.dump"], log_name="copy-dump.log")
        self.docker(["exec", self.container, "pg_restore", "-U", "postgres", "-d", "app_restored",
                     "/tmp/app.dump"], log_name="pg_restore.log")
        restored_objects.mkdir(parents=True, exist_ok=True)
        with tarfile.open(snapshot) as tf:
            tf.extractall(restored_objects)
        pre = self.psql("app_restored", f"SELECT count(*) FROM projects WHERE id='{PROJECT_DELETE}';",
                        log_name="restore-before-ledger.log")
        if pre != "1":
            raise AssertionError(f"restore did not contain deleted project before ledger replay: {pre}")

        ledger = json.loads(ledger_path.read_text())
        entry = ledger["entries"][0]
        self.psql("app_restored", f"""
BEGIN;
INSERT INTO deletion_tombstones(project_id, artifact_id, deleted_at, opaque_ledger_id)
VALUES ('{entry['project_id']}', '{entry['artifact_id']}', now(), '{entry['opaque_target']}')
ON CONFLICT DO NOTHING;
DELETE FROM dispatch_outbox WHERE job_id='job-delete-001';
DELETE FROM jobs WHERE project_id='{entry['project_id']}';
DELETE FROM artifacts WHERE project_id='{entry['project_id']}';
DELETE FROM projects WHERE id='{entry['project_id']}';
COMMIT;
""", log_name="replay-ledger.log")
        for key in entry["object_keys"]:
            path = restored_objects / key
            if path.exists():
                path.unlink()
        deleted_rows = self.psql("app_restored", f"""
SELECT (SELECT count(*) FROM projects WHERE id='{PROJECT_DELETE}') || ':' ||
       (SELECT count(*) FROM artifacts WHERE id='{ARTIFACT_DELETE}') || ':' ||
       (SELECT count(*) FROM jobs WHERE id='job-delete-001') || ':' ||
       (SELECT count(*) FROM deletion_tombstones WHERE project_id='{PROJECT_DELETE}') || ':' ||
       (SELECT count(*) FROM projects WHERE id='{PROJECT_SURVIVE}') || ':' ||
       (SELECT count(*) FROM artifacts WHERE id='{ARTIFACT_SURVIVE}');
""", log_name="post-replay-assertions.log")
        if deleted_rows != "0:0:0:1:1:1":
            raise AssertionError(f"restore ledger assertion failed: {deleted_rows}")
        if (restored_objects / "objects" / "deleted.bin").exists():
            raise AssertionError("deleted object resurrected")
        if digest((restored_objects / "objects" / "survivor.bin").read_bytes()) != digests["survivor"]:
            raise AssertionError("survivor object digest changed")

    def stale_callback(self) -> str:
        # Old worker token/epoch/revision is attempted after deletion. No row can publish.
        out = self.psql("app", f"""
UPDATE jobs j SET result='STALE_CALLBACK_PUBLISHED', status='completed'
FROM projects p, accounts a
WHERE j.id='job-delete-001' AND p.id='{PROJECT_DELETE}' AND a.id='{ACCOUNT}'
  AND j.project_id=p.id AND p.status='active'
  AND j.expected_account_epoch=7 AND j.expected_project_revision=3
RETURNING j.id;
""", log_name="stale-callback.log")
        return out

    def concurrent(self, sql: str, prefix: str) -> list[subprocess.CompletedProcess[str]]:
        procs = [subprocess.Popen(["docker", "exec", "-i", self.container, "psql", "-X", "-U", "postgres",
                                   "-v", "ON_ERROR_STOP=1", "-At", "-d", "app"],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True) for _ in range(2)]
        # Submit both inputs before waiting on either process. The caller's
        # pg_sleep makes overlap observable; unique/row locks then arbitrate.
        for proc in procs:
            assert proc.stdin is not None
            proc.stdin.write(sql)
            proc.stdin.close()
        results = []
        for i, proc in enumerate(procs, 1):
            proc.wait(timeout=30)
            assert proc.stdout is not None and proc.stderr is not None
            out, err = proc.stdout.read(), proc.stderr.read()
            cp = subprocess.CompletedProcess(proc.args, proc.returncode, out, err)
            (self.logs / f"{prefix}-{i}.log").write_text(f"$ {' '.join(proc.args)}\nstdout:\n{out}\nstderr:\n{err}\n")
            results.append(cp)
        return results

    def concurrency_checks(self) -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
        # Both sessions race for the same immutable full-regeneration slot.
        slot_sql = "SELECT pg_sleep(0.25); INSERT INTO regeneration_slots(lineage_id,full_regeneration,command_id) VALUES ('lineage-001',true,md5(random()::text)) ON CONFLICT DO NOTHING RETURNING command_id;\n"
        slot_results = self.concurrent(slot_sql, "regen-race")
        slot_count = self.psql("app", "SELECT count(*) FROM regeneration_slots WHERE lineage_id='lineage-001' AND full_regeneration=true;")
        slot_pass = sum(r.returncode == 0 for r in slot_results) == 2 and slot_count == "1"

        # Same local import UUID is idempotent: replay cannot create another Project.
        import_sql = f"SELECT import_command('cmd-import-001','{ACCOUNT}','local-request-001','payload-digest-001','{PROJECT_SURVIVE}');\n"
        self.psql("app", import_sql)
        import_duplicate = self.psql("app", import_sql)
        import_count = self.psql("app", "SELECT count(*) FROM local_imports WHERE command_id='cmd-import-001';")
        changed_import = self.psql_cp("app", f"SELECT import_command('cmd-import-001','{ACCOUNT}','local-request-001','changed-payload','{PROJECT_SURVIVE}');\n", check=False)
        import_race_sql = f"SELECT pg_sleep(0.25); SELECT import_command('cmd-import-race','{ACCOUNT}','local-request-race','payload-race','{PROJECT_SURVIVE}');\n"
        import_race = self.concurrent(import_race_sql, "import-race")
        import_race_count = self.psql("app", "SELECT count(*) FROM local_imports WHERE command_id='cmd-import-race';")
        import_race_values = sorted(r.stdout.strip().splitlines()[0] for r in import_race if r.stdout.strip())
        import_pass = (import_count == "1"
                       and import_duplicate == "duplicate"
                       and "command_payload_mismatch" in changed_import.stderr
                       and import_race_count == "1"
                       and import_race_values == ["duplicate", "imported"]
                       and all(r.returncode == 0 for r in import_race))

        # Integer microdollar boundary: ceil(3/7 USD) = 428,572 microdollars.
        rational = self.psql("app", "SELECT ceil((3::numeric * 1000000) / 7)::bigint;")
        reservation_sql = f"SELECT reserve_operation('op-boundary-001','idem-boundary-001','{ACCOUNT}','{PROJECT_SURVIVE}','job-survive-001',428572);\n"
        self.psql("app", reservation_sql)
        reservation_duplicate = self.psql("app", reservation_sql)
        reservation_pass = rational == "428572" and reservation_duplicate == "duplicate"

        # Account ceiling race: both are individually valid, but only one fits
        # the 150,000 remaining account allowance.
        account_race_sql = f"SELECT pg_sleep(0.25); SELECT reserve_operation('op-acct-race-' || substr(md5(random()::text),1,8), 'idem-acct-race-' || substr(md5(random()::text),1,8), '{ACCOUNT_RACE}', '{PROJECT_OTHER}', 'job-account-race-001', 100000);\n"
        account_race = self.concurrent(account_race_sql, "reservation-account-race")
        account_reserved = self.psql("app", f"SELECT reserved_microdollars FROM usage_periods WHERE account_id='{ACCOUNT_RACE}';")
        account_ok = sum(r.returncode == 0 for r in account_race) == 1 and sum("account_ceiling" in r.stderr for r in account_race) == 1 and account_reserved == "100000"

        # Parent Job ceiling race: both are individually valid for the account,
        # but only one fits the 150,000 lineage/job ceiling.
        parent_race_sql = f"SELECT pg_sleep(0.25); SELECT reserve_operation('op-parent-race-' || substr(md5(random()::text),1,8), 'idem-parent-race-' || substr(md5(random()::text),1,8), '{ACCOUNT}', '{PROJECT_SURVIVE}', 'job-parent-race-001', 100000);\n"
        parent_race = self.concurrent(parent_race_sql, "reservation-parent-race")
        parent_reserved = self.psql("app", "SELECT reserved_microdollars FROM usage_jobs WHERE job_id='job-parent-race-001';")
        parent_ok = sum(r.returncode == 0 for r in parent_race) == 1 and sum("parent_job_ceiling" in r.stderr for r in parent_race) == 1 and parent_reserved == "100000"
        reservation_pass = reservation_pass and account_ok and parent_ok

        # Negative validation cases are rejected before any row mutation.
        negatives = []
        for label, sql, marker in [
            ("missing_account", f"SELECT reserve_operation('op-missing-account','idem-missing-account','acct-nope','{PROJECT_SURVIVE}','job-survive-001',1);", "account_missing"),
            ("disabled_account", f"SELECT reserve_operation('op-disabled-account','idem-disabled-account','acct-disabled-001','{PROJECT_SURVIVE}','job-survive-001',1);", "account_not_active"),
            ("project_account_mismatch", f"SELECT reserve_operation('op-project-mismatch','idem-project-mismatch','{ACCOUNT_RACE}','{PROJECT_SURVIVE}','job-survive-001',1);", "project_account_mismatch"),
            ("job_missing", f"SELECT reserve_operation('op-missing-job','idem-missing-job','{ACCOUNT}','{PROJECT_SURVIVE}','job-nope',1);", "job_missing"),
            ("job_project_mismatch", f"SELECT reserve_operation('op-job-project-mismatch','idem-job-project-mismatch','{ACCOUNT}','{PROJECT_SURVIVE}','job-other-001',1);", "job_project_mismatch"),
            ("zero_amount", f"SELECT reserve_operation('op-zero','idem-zero','{ACCOUNT}','{PROJECT_SURVIVE}','job-survive-001',0);", "operation_cap_or_positive"),
            ("null_amount", f"SELECT reserve_operation('op-null','idem-null','{ACCOUNT}','{PROJECT_SURVIVE}','job-survive-001',NULL);", "operation_cap_or_positive"),
            ("over_cap", f"SELECT reserve_operation('op-over-cap','idem-over-cap','{ACCOUNT}','{PROJECT_SURVIVE}','job-survive-001',1000001);", "operation_cap_or_positive"),
            ("changed_operation_amount", f"SELECT reserve_operation('op-boundary-001','idem-boundary-001','{ACCOUNT}','{PROJECT_SURVIVE}','job-survive-001',428573);", "operation_identity_or_amount_mismatch"),
        ]:
            cp = self.psql_cp("app", sql, check=False)
            negatives.append(f"{label}={'PASS' if marker in cp.stderr else 'FAIL'}")
        reservation_pass = reservation_pass and all("=PASS" in item for item in negatives)
        slot_observed = f"slot_count={slot_count}; session_exit_codes={[r.returncode for r in slot_results]}"
        import_observed = f"import_count={import_count}; duplicate_result={import_duplicate}; changed_payload_rejected={'command_payload_mismatch' in changed_import.stderr}; import_race={[r.returncode for r in import_race]} values={import_race_values} count={import_race_count}"
        reservation_observed = f"rational_ceiling={rational}; duplicate_result={reservation_duplicate}; account_race={[r.returncode for r in account_race]} reserved={account_reserved}; parent_race={[r.returncode for r in parent_race]} reserved={parent_reserved}; negatives={negatives}"
        return (
            {"passed": slot_pass, "observed": slot_observed},
            {"passed": import_pass, "observed": import_observed},
            {"passed": reservation_pass, "observed": reservation_observed},
        )

    def archive_raw(self, destination: Path) -> Path:
        """Retain the exact run inputs/outputs beside the canonical report."""
        if destination.exists():
            raise FileExistsError(destination)
        shutil.copytree(self.root, destination)
        for name in ("database.dump", "object-backup.tar", "restore-exclusion-ledger.json"):
            source, retained = self.root / name, destination / name
            if source.read_bytes() != retained.read_bytes():
                raise AssertionError(f"raw archive mismatch: {name}")
        return destination

    def write_report(self, report: Path, *, dump_path: Path, snapshot: Path,
                     ledger_path: Path, run_id: str, overall: str,
                     retained_root: Path, manifest_path: Path) -> None:
        elapsed = time.monotonic() - self.started
        def file_meta(path: Path) -> str:
            if not path.exists():
                return "not created"
            return f"`{path}` ({path.stat().st_size} bytes), SHA-256 `{digest(path.read_bytes())}`"

        lines = [
            "# Recovery qualification evidence — G-9 prototype",
            "",
            f"- Run: `{run_id}`; generated UTC: `{datetime.now(timezone.utc).isoformat()}`",
            f"- Overall: **{overall}; NOT a deployed nova3D/Supabase qualification**",
            f"- Duration: `{elapsed:.2f}s`; disposable container: `{self.container}`",
            f"- Image: `{IMAGE}@{IMAGE_DIGEST}`; limits: `--cpus=2 --memory=2g`; no host port published",
            f"- Retained raw evidence: `{retained_root}`; backup archive: {file_meta(dump_path)}; object snapshot: {file_meta(snapshot)}",
            f"- Persisted backup manifest: {file_meta(manifest_path)}",
            f"- Independent restore-exclusion ledger: {file_meta(ledger_path)}",
            "",
            "## Results",
            "",
        ]
        for result in self.results:
            lines.extend([
                f"### {result['name']} — **{result['status']}**",
                f"- Command: `{result['command']}`",
                f"- Inputs: {result['inputs']}",
                f"- Observed: `{result['output']}`",
                f"- Scope/limitations: {result['scope']}",
                "",
            ])
        lines += [
            "## Reproduction and cleanup",
            "",
            f"`python3 tools/qualification/recovery/probe.py --report {report}`",
            f"`docker rm -f {self.container}` (the probe performs this cleanup; no global prune)",
            "",
            "## Explicit blockers / not run",
            "",
            "- **BLOCKED / outside local scope:** actual Supabase/Vercel/Railway/Upstash plan, region, retention and backup settings; no production credentials or services were used.",
            "- **BLOCKED / outside local scope:** provider callbacks, cloud object-provider retention/restore, session/invitation auth, and measured RPO/RTO24h/active purge24h/backup expiry30d.",
            "- **NOT RUN:** full application data model, storage gateway chunk authorization, real worker signing, deployment topology, or crash-resume windows between database, object store and external ledger. This prototype uses synthetic SQL tables and local object files only.",
        ]
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text("\n".join(lines) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", default="_bmad-output/implementation-artifacts/qualification-2026-09-14/recovery/recovery-report.md")
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    root = Path(os.environ.get("NOVA3D_RECOVERY_AREA", "/home/josh/.cache/nova3d-qualification-20260914/recovery")) / stamp
    object_store = root / "object-store"
    snapshot = root / "object-backup.tar"
    restored_objects = root / "restored-object-store"
    dump_path = root / "database.dump"
    corrupt_dump_path = root / "database-corrupt.dump"
    manifest_path = root / "backup-manifest.json"
    ledger_path = root / "restore-exclusion-ledger.json"
    report = Path(args.report)
    probe = Probe(root)
    status = 0
    try:
        probe.start()
        digests = probe.seed(object_store)
        probe.record("Pinned Postgres startup", f"docker run -d --rm --name {probe.container} --cpus=2 --memory=2g -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=app {PINNED_IMAGE}",
                     "Synthetic database; no host port; unique disposable container", "ready; PostgreSQL 16", "PASS", "Container execution only; no deployment claim")
        dump_digest = probe.dump(dump_path)
        snapshot_digest = probe.copy_objects_snapshot(object_store, snapshot)
        manifest = probe.write_backup_manifest(manifest_path, dump_path, snapshot)
        probe.record("Independent database/object backup", f"docker exec {probe.container} pg_dump -U postgres -Fc -d app > {dump_path}",
                     f"DB rows for two synthetic projects; object files with digests {digests}",
                     f"database.dump={dump_path.stat().st_size} bytes SHA-256={dump_digest}; object snapshot SHA-256={snapshot_digest}; manifest={manifest_path}",
                     "PASS", "Local backup files only; no managed backup retention evidence")
        corrupt_bytes = bytearray(dump_path.read_bytes())
        corrupt_bytes[-1] ^= 0x01
        corrupt_dump_path.write_bytes(corrupt_bytes)
        try:
            probe.verify_backup_inputs(corrupt_dump_path, snapshot, manifest_path)
            corrupt_rejected = False
        except ValueError as exc:
            corrupt_rejected = str(exc).startswith("backup_digest_mismatch:")
        probe.record("Corrupted backup rejected before restore", f"verify {corrupt_dump_path} against {manifest_path}",
                     "One-byte-mutated synthetic pg_dump; object snapshot unchanged", f"rejected={corrupt_rejected}",
                     "PASS" if corrupt_rejected else "FAIL", "Negative digest check only; no corruption recovery claim")
        if not corrupt_rejected:
            raise AssertionError("corrupted backup was not rejected")
        probe.deletion(ledger_path, object_store)
        probe.record("Deletion transaction and external ledger", "durably write intent; injected SQL ROLLBACK; then BEGIN; tombstone/hide; cancel; purge; COMMIT; active object purge",
                     "Synthetic delete project/artifact plus job/outbox and object key", "intent survived injected rollback; live DB rows and deleted object purged; committed ledger retained", "PASS", "Prototype ordering and ledger shape; fsync plus rollback injection, no actual power-loss simulation or production deletion service")
        probe.restore(dump_path, restored_objects, snapshot, ledger_path, manifest_path, digests)
        probe.record("Restore with intervening deletion", f"createdb app_restored; pg_restore -d app_restored {dump_path}; replay {ledger_path} before opening access",
                     "Pre-delete pg_dump plus post-delete external ledger and object snapshot",
                     "deleted project/artifact/job absent; tombstone retained; survivor project/artifact/object digest intact", "PASS", "Synthetic Postgres/local object store; no cloud cross-provider path")
        stale = probe.stale_callback()
        stale_pass = stale.strip() == "UPDATE 0"
        probe.record("Stale worker callback rejected after deletion", "UPDATE ... WHERE deleted project is absent/status=active and expected account epoch/revision RETURNING id",
                     "Old job token with account_epoch=7/project_revision=3 after deletion", f"RETURNING output: {stale or '<empty>'}",
                     "PASS" if stale_pass else "FAIL", "Post-deletion rejection only; does not test a live epoch/revision race or signed callback auth")
        slot, imp, reservation = probe.concurrency_checks()
        probe.record("Concurrent unique full-regeneration slot", "two concurrent INSERTs on UNIQUE(lineage_id, full_regeneration)",
                     "Same synthetic lineage and full_regeneration=true", str(slot["observed"]), "PASS" if slot["passed"] else "FAIL",
                     "SQL uniqueness race only; no Manufacturing application")
        probe.record("Idempotent local import", "repeat import_command(command_id,payload_digest)", "Same synthetic command/local request UUID twice",
                     str(imp["observed"]), "PASS" if imp["passed"] else "FAIL", "Prototype import table; no offline client")
        probe.record("Integer/rational reservation and parent ceiling", "reserve_operation plus two concurrent reservation calls",
                     "USD integer microdollars; ceil(3/7 USD); parent Job ceiling 500,000", str(reservation["observed"]),
                     "PASS" if reservation["passed"] else "FAIL", "Prototype Usage tables; no provider terms or live billing")
    except Exception as exc:
        status = 1
        probe.record("Probe execution", "see retained command logs", "synthetic local inputs", repr(exc), "FAIL", "Failure requires review; later checks may be absent")
    finally:
        probe.stop()
        retained_root = probe.root
        try:
            retained_root = probe.archive_raw(report.parent / "raw" / root.name)
            probe.record("Raw evidence archive", f"copytree {probe.root} -> {retained_root}",
                         "Final run database.dump, object-backup.tar, restore-exclusion-ledger.json and logs",
                         "byte-for-byte verification passed for dump, object snapshot and ledger", "PASS",
                         "Small local evidence archive; no production backup")
        except Exception as exc:
            status = 1
            probe.record("Raw evidence archive", "copytree final run into recovery/raw/<run-id>",
                         "Final run evidence", repr(exc), "FAIL", "Canonical report remains pointed at isolated cache")
        status = 1 if any(result["status"] == "FAIL" for result in probe.results) else status
        overall = "PASS for local executable assertions" if status == 0 else "FAIL in local executable assertions"
        report_dump = retained_root / "database.dump" if (retained_root / "database.dump").exists() else dump_path
        report_snapshot = retained_root / "object-backup.tar" if (retained_root / "object-backup.tar").exists() else snapshot
        report_manifest = retained_root / "backup-manifest.json" if (retained_root / "backup-manifest.json").exists() else manifest_path
        report_ledger = retained_root / "restore-exclusion-ledger.json" if (retained_root / "restore-exclusion-ledger.json").exists() else ledger_path
        probe.write_report(report, dump_path=report_dump, snapshot=report_snapshot, ledger_path=report_ledger,
                           run_id=root.name, overall=overall, retained_root=retained_root,
                           manifest_path=report_manifest)
    print(report)
    return status


if __name__ == "__main__":
    raise SystemExit(main())
