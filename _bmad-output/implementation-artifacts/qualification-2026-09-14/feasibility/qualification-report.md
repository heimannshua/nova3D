# nova3D feasibility qualification — CadQuery / G-1 and bounded G-2

Date: 2026-09-14
Fixture: `synthetic-middot-altar-ramp-v1` — deliberately synthetic, not approved historical geometry.
Scope: native CadQuery generation, parameter correction, snapshot round-trip, bounded cancellation, and coarse equivalence/error corpus.

## Toolchain evidence

The pinned environment was built from `python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea` using the assigned [CadQuery.Dockerfile](../../../../tools/qualification/feasibility/CadQuery.Dockerfile). Native Debian 13/trixie GL/X runtime packages were installed inside the image; no host libraries are used by the qualifying run. The Python closure is resolved in [cadquery-requirements.lock](../../../../tools/qualification/feasibility/cadquery-requirements.lock), matching the observed freeze. APT package versions are recorded, but APT repository state is not hash-locked; no stronger reproducibility claim is made.

Observed final image: `nova3d-cadquery-qualification@sha256:6dfef397d06d25a7d6ca1b648c8393d51fcd4a48f5c24e7dc5bc9976cdd6536a`. This is the built image identity, distinct from the pinned base digest.

Pinned/observed core versions: Python 3.12.14, CadQuery 2.8.0, cadquery-ocp 7.9.3.1.1, VTK 9.6.2, NumPy 2.5.3. Complete evidence is in [pip-freeze.txt](pip-freeze.txt), [dpkg-packages.txt](dpkg-packages.txt), and [image-inspect.txt](image-inspect.txt). Source hashes are in [source-hashes-v2.txt](source-hashes-v2.txt).

Build command:

```text
docker build --network host --file tools/qualification/feasibility/CadQuery.Dockerfile --tag nova3d-cadquery-qualification:20260914-v2 --progress plain tools/qualification/feasibility
```

The first default-network build failed to fetch Debian indexes; the successful build used Docker host networking for the build transport only. This is recorded evidence of the local build environment, not a Railway deployment test.

## Executed probe

Command (bounded to 2 CPUs and 2048 MiB):

```text
/usr/bin/time -v docker run --rm --cpus=2 --memory=2048m \
  -v /home/josh/repos/nova3D:/workspace:ro \
  -v /home/josh/.cache/nova3d-qualification-20260914/feasibility/results-v2:/opt/qualification/results \
  nova3d-cadquery-qualification:20260914-v2 \
  /workspace/tools/qualification/feasibility/cadquery_probe.py \
  --output-dir /opt/qualification/results
```

Inputs were a declarative mm/Z-up recipe: 80 × 50 × 6 mm base, 55 × 38 × 8 mm lower step, 35 × 28 × 8 mm upper step, 30 × 30 × 16 mm triangular ramp, and one 8 × 8 × 2 mm `user_added` plaque. Stable semantic IDs and the full recipe are in [recipe.json](recipe.json).

Observed output: one valid solid (`ShapeType=Compound`, `solids=1`), bounds 80 × 50 × 22 mm, volume 52,888 mm³, 26 faces / 65 edges / 43 vertices. The wrapper/container invocation maximum RSS was 32,592 kB and wall time 3.62 s; this is not a native worker peak-RSS measurement. See [probe-time.log](probe-time.log).

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Repeated generation (3 runs, coarse metrics) | PASS | Same validity, topology counts, bounds and volume |
| Recipe digest and per-feature repeat equality | PASS | Both repeats matched recipe digest and every feature's coarse metrics |
| Translated ramp/plaque placement and full bbox min/max | PASS | Expected and observed feature bounds matched exactly |
| Controlled correction (`upper_step_height` 8 → 10 mm) | PASS | Affected feature changed; base, lower step, ramp and plaque remained within coarse tolerance |
| Corrected final union validation | PASS | One valid solid; observed volume delta matched expected 1,960 mm³ |
| STEP export and restore | PASS | 77,454 bytes; restored validity/topology/bounds/volume matched |
| BREP export and restore | PASS | 14,656 bytes; restored validity/topology/bounds/volume matched |
| Deliberate dimension/thin/scale/unit/NaN/∞ parameter rejection | PASS | Actual local validate/build boundary rejected each case |
| Translated ramp/plaque envelope rejection | PASS | Actual generated bounds exceed 90 mm although base-only parameter checks pass; build boundary rejects both |
| Deliberate through-hole coarse mismatch | PASS | Topology differed; relative volume delta 1.1761% |
| Temporary round-trip data deletion | PASS | `tmp_roundtrip` was removed; only fixture temp data was targeted |
| Bounded cancellation | PASS | Child alive immediately before exact SIGTERM; return code -15; 1,500 ms readiness + 750 ms cancellation budgets |

Machine-readable full results: [cadquery-results.json](cadquery-results.json). Export snapshots: [synthetic-altar-ramp.step](synthetic-altar-ramp.step) and [synthetic-altar-ramp.brep](synthetic-altar-ramp.brep).

## Qualification boundary

G-1 is substantively evidenced for this synthetic fixture and disposable local worker process: pinned Python/CadQuery/OCP image, generation, personalization, correction, snapshot restore, resource bound and post-first-geometry cancellation all passed.

G-2 is only partially evidenced. The probe applies topology, validity, bounds and volume signals against R-2 thresholds and includes dimensional, thin-feature, hole, unit and scale negatives. The ratified bidirectional surface-distance comparator, certified approximation/error bound, boolean semantic correspondence, correspondence across final-print transform, rotations, and a production regression corpus were **NOT RUN**. Bounding-box/volume checks must not be treated as that certified comparator. Scale/unit negatives prove parameter rejection/coarse mismatch only; they do not prove full normalization.

Not proven: historical Middot geometry, production worker fencing/late-commit rejection, native worker peak RSS, printer accuracy, slicing/support checks, provenance/approval flows, Railway deployment, or physical printing. Production operation-graph coverage and a disconnected-geometry corpus remain deferred acceptance work. The separate Next/React stack scratch qualification was delegated to another agent and is not claimed here.

Final parent verification reran the retained image with the mounted final probe after adding generated-envelope negatives. All 10 status groups passed; canonical JSON/snapshots above now correspond to that run. [Parent stdout](parent-stdout.log) and [parent timing](parent-time.log) retain its execution evidence. The earlier wrapper timing remains in `probe-time.log`. No image dependency changed.
