
- source_spec: `_bmad-output/implementation-artifacts/spec-architecture-qualification.md`
  summary: Qualify application support/overhang/bridge behavior and invalid geometry through the selected slicer.
  evidence: Blind review finding 10; only one positive box was sliced, and no general nova3D print validator exists.

- source_spec: `_bmad-output/implementation-artifacts/spec-architecture-qualification.md`
  summary: Exercise cross-store deletion crash/resume windows in the implemented recovery service.
  evidence: Blind review finding 19; local rollback and ledger replay do not test interruption between database commit, object deletion and ledger completion.
