
- source_spec: `_bmad-output/implementation-artifacts/spec-architecture-qualification.md`
  summary: Qualify application support/overhang/bridge behavior and invalid geometry through the selected slicer.
  evidence: Blind review finding 10; only one positive box was sliced, and no general nova3D print validator exists.

- source_spec: `_bmad-output/implementation-artifacts/spec-architecture-qualification.md`
  summary: Exercise cross-store deletion crash/resume windows in the implemented recovery service.
  evidence: Blind review finding 19; local rollback and ledger replay do not test interruption between database commit, object deletion and ledger completion.
- source_spec: `_bmad-output/implementation-artifacts/spec-mock-first-vercel-supabase-deployment.md`
  summary: Restore the existing Supabase project and activate Google sign-in for the two approved email identities.
  evidence: The project is INACTIVE and the installed CLI has no restore subcommand; the documented Management API restore attempt returned HTTP 401 because no SUPABASE_ACCESS_TOKEN is available in this environment.
