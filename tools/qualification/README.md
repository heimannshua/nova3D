# nova3D qualification probes

These standalone probes are local feasibility evidence, not the nova3D application or production migrations. Read the [consolidated report](../../_bmad-output/implementation-artifacts/qualification-2026-09-14/REPORT.md) for acceptance boundaries.

Run from the repository root on Linux x86_64 with Docker, Node 24.21.0/npm and Python. Dependency installation uses network access; no real credentials are needed. Native probes are bounded to 2 CPUs/2 GiB. Browser checks use headless software rendering.

| Area | Reproduction | Scope |
| --- | --- | --- |
| Stack | `bash tools/qualification/stack/verify-stack.sh` | Locked install, typecheck, production build and loopback HTTP assertions. |
| Browser | [devices/README.md](devices/README.md) | API/storage primitives, retained bytes, Three and ONNX identity execution. |
| CAD | [Build/run commands](../../_bmad-output/implementation-artifacts/qualification-2026-09-14/feasibility/qualification-report.md) | Native fixture generation, coarse comparison, restore and cancellation. |
| Print | [Fixture and slice commands](../../_bmad-output/implementation-artifacts/qualification-2026-09-14/print/REPORT.md) | Mesh/threshold fixtures and verified official BambuStudio CLI inputs/outputs. Python dependencies: [requirements-fixtures.txt](print/requirements-fixtures.txt). |
| Recovery | `python3 tools/qualification/recovery/probe.py --report /path/to/local-recovery-report.md` | Synthetic Postgres/object backup, deletion replay, corruption rejection, concurrency and cleanup. |

Area reports distinguish executed commands from preserved rebuild recipes. CAD apt versions are observations, not an immutable OS snapshot. Upstream image/package availability can change; preserve the recorded local images/downloads for historical replay.

Small evidence files are in `_bmad-output/implementation-artifacts/qualification-2026-09-14/`. Large dependencies and AppImages stay in `~/.cache/nova3d-qualification-20260914/`. The repository ignores generated dependencies/build directories. Print outputs are synthetic evidence and were not sent to a printer.
