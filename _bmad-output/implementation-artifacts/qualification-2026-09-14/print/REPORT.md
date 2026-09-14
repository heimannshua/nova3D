# nova3D print qualification — Luna report

Date: 2026-09-14
Scope: G-3 / R-2 / R-3 / R-11 feasibility probes only. No printer, paid API, production service, user data, or printer control was used.

## Result

Overall G-3: **INCOMPLETE**. The independent mesh and fixture probes pass, the ratified effective-profile contract explicitly overrides stock inherited `wall_loops: "2"` to `3`, and the same effective settings produced a successful bounded BambuStudio slice of the synthetic box. No nova3D general print validator, repair engine, or R-11 lineage implementation exists in this checkout; unsupported-geometry, physical-print, and repair claims remain unverified.

The results below are software/analytic fixture evidence only. They do not prove silk-PLA printability, physical tolerances, printer accuracy, support behavior, or deployment.

Continuation evidence (2026-09-14): effective-profile JSON assertions, profile-closure digest verification, and the corrected fixture probe were rerun after the override and AppImage attempt; all contract/fixture assertions exited `0` with `unexpected: []`. The fixture probe now requires exact five-component identity/shape matching for the threshold corpus, requires both mesh and analytic gates for positive matches, and asserts that a zero-area mutation of the positive envelope fails the mesh gate. The initial AppImage launch exited `127` for a missing runtime library; after isolated container dependency resolution, the same pinned binary accepted `--help` and completed a synthetic slice with exit `0`.

## Official profile source and inheritance closure

Source: `https://github.com/bambulab/BambuStudio.git`, detached at commit `56e0ee35f0e720ba6819ec2395a17e679aa95751`; the target profile URL is the R-3 URL for `Bambu PLA Silk+ @BBL A1M`. Source retrieval used `git ls-remote` and a shallow filtered checkout. The checkout's AGPL license text is preserved; this is source metadata preservation, not a legal determination of each profile's individual licensing.

The preserved closure is in [profile-source](profile-source/), with exact SHA-256 entries in [manifest.sha256](profile-source/manifest.sha256) and source pin/raw-download metadata in [source-pin.txt](profile-source/source-pin.txt). The three chains resolve as:

```text
filament: Bambu PLA Silk+ @BBL A1M
  -> Bambu PLA Silk+ @base -> fdm_filament_pla -> fdm_filament_common
machine:  Bambu Lab A1 mini 0.4 nozzle
  -> fdm_bbl_3dp_001_common -> fdm_machine_common
process:  0.20mm Standard @BBL A1M
  -> fdm_process_single_0.20 -> fdm_process_single_common -> fdm_process_common
```

Command: `cd _bmad-output/implementation-artifacts/qualification-2026-09-14/print/profile-source && sha256sum -c <(sed -n '/^[0-9a-f]\{64\}  /p' manifest.sha256)`
Observed: all 11 closure JSON files and `LICENSE` returned `OK`. **PASS**.

Selected observed settings:

| Requirement | Observed | Result |
| --- | --- | --- |
| Filament | `Bambu PLA Silk+ @BBL A1M`, compatible with A1 mini 0.4 | PASS |
| Nozzle | `0.4` mm | PASS |
| Machine profile bed/height | `180 x 180 x 180` mm | PASS for source profile; R-3 product cap remains an external ≤90 mm validation rule |
| Process layer height | `0.2` mm | PASS |
| Process perimeters | stock `wall_loops: "2"`; effective override `3` | PASS as contract override and synthetic slice setting |
| Product envelope | ≤90 × 90 × 90 mm | Implemented only in the independent fixture probe; no app validator |

The stock mismatch is represented as an explicit, machine-readable override rather than treated as a ratification blocker. [effective-profile.json](effective-profile.json) pins the source commit and closure, sets effective `wall_loops: 3`, `layer_height_mm: 0.2`, the ≤90 mm cube, and R-3 threshold/unsupported-geometry contract values. Its structural assertions and closure digest verification both returned **PASS**. The standalone effective-profile JSON is a contract/effective-settings artifact; the separate slicer evidence below verifies that BambuStudio accepted and sliced with those effective values for the bounded synthetic-box probe.

## Independent geometry/mesh probes

Tool environment in isolated cache `/home/josh/.cache/nova3d-qualification-20260914/print/`: Python 3.14.4, NumPy 2.3.3, trimesh 4.8.3, networkx 3.5, lxml 6.0.2. `manifold3d==3.0.0` was attempted and **FAILed to build** with `ERROR: Use cmake.version instead of cmake.minimum-version with scikit-build-core >= 0.8`; it was not silently replaced. The probe uses trimesh only.

Command:

```text
/home/josh/.cache/nova3d-qualification-20260914/print/venv/bin/python tools/qualification/print/qualify_fixtures.py --out _bmad-output/implementation-artifacts/qualification-2026-09-14/print/fixtures
```

The command exited `0`; assertions were `status: pass`, `unexpected: []`. Full machine-readable output is [probe-results.json](fixtures/probe-results.json), the final rerun output is retained in [qualification-rerun-final.log](fixtures/qualification-rerun-final.log), and the fixture source/output hashes are in [fixtures-sha256.txt](fixtures/fixtures-sha256.txt). The reproducible source is [qualify_fixtures.py](../../../../tools/qualification/print/qualify_fixtures.py).

Observed fixture outcomes:

| Fixture | Mesh gate | Analytic gate | Evidence |
| --- | --- | --- | --- |
| `positive_envelope.stl` | PASS | PASS, max bound 40 mm ≤90 | positive envelope |
| `positive_thresholds.stl` | PASS | PASS: 1.2 mm wall, 0.8 mm feature, 0.4 mm gap, 0.6 mm relief | positive threshold fixture |
| `negative_bounds_90_01mm.stl` | PASS as a valid mesh | FAIL, observed 90.010002 mm | deliberate bounds violation |
| `negative_thresholds.stl` | PASS as a valid mesh | FAIL: 1.19/0.79/0.39/0.59 mm | deliberate threshold violations |
| `malformed_nonmanifold.stl` | FAIL: not watertight / not a volume | not applicable | deliberate coincident internal face |
| `malformed_zero_area_face.stl` | FAIL: zero-area face / not watertight | not applicable | deliberate degenerate triangle |

STL and 3MF round-trips both returned `status: pass`, with observed max bounds delta `0.0 mm` and relative volume delta `0.0`. The probe merges exact duplicate STL vertices while retaining zero-area faces; binary STL quantization tolerance is 0.001 mm. This is a round-trip probe, not R-2's semantic-feature/canonical-to-repair equivalence implementation.

The positive threshold fixture is measured as exactly five uniquely positioned components (wall, isolated feature, mating A, mating B, and relief), with each component's expected origin and extents checked directly; no index-order sorting assumption is used. Positive `expected_match` requires both `mesh_gate == pass` and `analytic_gate.pass == true`. The malformed-positive mutation appends one zero-area triangle to `positive_envelope.stl`; the source mesh passes and the mutated mesh fails, with `integrity_mutation.status: pass`.

## Official BambuStudio release attempt and unsupported geometry

The official BambuStudio release page documents Linux AppImages. A pinned stable Ubuntu 24.04 asset was downloaded from the official release URL, SHA-256 verified, and retained only in the isolated cache (230,025,720 bytes): `v02.08.02.61 / BambuStudio_ubuntu24.04-v02.08.02.61-20260820225108.AppImage`, SHA-256 `d501b103fac5424513ec0e8d6bc145fb30719de2c7d94d7320d723740c81a7fd`. Evidence is in [slicer-attempt](slicer-attempt/).

Initial command: `timeout --signal=TERM --kill-after=5s 25s taskset -c 0,1 env -i PATH=/usr/bin:/bin XDG_CONFIG_HOME=... XDG_CACHE_HOME=... XDG_DATA_HOME=... TMPDIR=... DISPLAY= WAYLAND_DISPLAY= BambuStudio.AppImage --appimage-extract-and-run --help`
Observed exit `127`: `libgstvideo-1.0.so.0` missing. A disposable Ubuntu 24.04 container then installed the required GTK/GStreamer/WebKit runtime packages with `--cpus=2 --memory=2g`; `ldd` showed no unresolved libraries after setting the AppImage's bundled `bin` directory in `LD_LIBRARY_PATH`. The same binary's `--help` exited `0` and identified `BambuStudio-02.08.02.61`; `--version` is not a supported option and exited `254`.

The reusable slice command was run with the pinned AppImage and isolated cache paths (the script owns AppImage extraction and does not expose its extracted path):

```bash
CACHE=/home/josh/.cache/nova3d-qualification-20260914/print/bambu-cli-attempt
BAMBU_APPIMAGE="$CACHE/BambuStudio.AppImage" \
BAMBU_INPUT_DIR="_bmad-output/implementation-artifacts/qualification-2026-09-14/print/slicer-attempt/recipe-run/input" \
BAMBU_OUTPUT_DIR="$CACHE/recipe-run-output-6" \
BAMBU_DATA_DIR="$CACHE/recipe-run-data-6" \
tools/qualification/print/run_bambu_cli_slice.sh
```

The lower-level direct-container invocation and runtime diagnostics are retained under [runtime-retry](slicer-attempt/runtime-retry/); the command above is the reusable reproduction path.

The effective process input was generated reproducibly with:

```text
/home/josh/.cache/nova3d-qualification-20260914/print/venv/bin/python tools/qualification/print/prepare_cli_process.py --profile-root _bmad-output/implementation-artifacts/qualification-2026-09-14/print/profile-source/resources/profiles/BBL/process --output /home/josh/.cache/nova3d-qualification-20260914/print/bambu-cli-attempt/cli-input/process-effective-repro.json
```

It resolved the four-process chain, produced 198 keys, and the generated digest matched the retained CLI input (`bef1438c3cc6af1eba0de8afb131be5a349293fd067fa6ad56fca10350331e33`). Observed slice exit was `0`; `result.json` reports `return_code: 0`, `error_string: "Success."`, `layer_height: 0.20000000298`, `wall_loops: 3`; G-code contains `layer_height = 0.2`, `wall_loops = 3`, `nozzle_diameter = 0.4`, `filament_settings_id = "Bambu PLA Silk+ @BBL A1M"`, and the A1 mini compatible printer. Outputs were `plate_1.gcode` (445,399 bytes), `result.3mf` (38,479 bytes), and `result.json` (2,060 bytes). The run logged a nonfatal Wayland thumbnail/display error; the slice and 3MF export still succeeded.

This is actual software slicing evidence for one 40 mm watertight box under the effective settings, not a general validator or physical qualification. The box exercises no >45° unsupported overhang or >5 mm bridge, and the emitted G-code/3MF does not prove the R-3 wall/feature/clearance/relief thresholds or silk-PLA physical behavior.

### Reusable dependency-resolved slice recipe

The reproducible recipe is [Dockerfile.bambustudio-cli](../../../../tools/qualification/print/Dockerfile.bambustudio-cli), [bambu-cli-entrypoint.sh](../../../../tools/qualification/print/bambu-cli-entrypoint.sh), [run_bambu_cli_slice.sh](../../../../tools/qualification/print/run_bambu_cli_slice.sh), [prepare_cli_profiles.py](../../../../tools/qualification/print/prepare_cli_profiles.py), and [requirements-fixtures.txt](../../../../tools/qualification/print/requirements-fixtures.txt). The image is based on Ubuntu 24.04 digest `ubuntu@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254`; the built local image was `nova3d/bambu-cli:v02.08.02.61-ubuntu24.04`, digest `sha256:cfb0da2781e1885463fcbd163e5bc6784d562be3a08c65354d425aa758b71a14`. Direct runtime packages are pinned in the Dockerfile and observed versions are retained in [package-versions.txt](slicer-attempt/recipe-run/package-versions.txt). The recipe verifies the official AppImage digest and a relative SHA-256 manifest covering all three flattened machine/filament/process inputs plus `positive_envelope.stl` before extraction and slicing. The machine and filament inputs are materialized from their full pinned inheritance chains by `prepare_cli_profiles.py`; all three input JSONs have no `inherits` key.

The rerun used `--network=none`, `--cpus=2`, `--memory=2g`, `--pids-limit=512`, read-only AppImage/input mounts, writable isolated output/data mounts, and Docker `--rm`; no printer or loopback control was exposed. The exact rerun evidence is [recipe-run](slicer-attempt/recipe-run/), including the command log, input manifest, AppImage/package/base-image digests, G-code, 3MF, and `result.json`. It returned **PASS** (`return_code: 0`, `wall_loops: 3`, `layer_height: 0.20000000298`). Docker reported no running container afterward. Build-time apt retrieval requires Docker's normal network and signature verification; the slice container itself has no network.

Negative bounds/threshold slicing, overhang slicing, bridge slicing, and support-analysis probes: **NOT RUN**. Only the positive 40 mm box was passed to the official slicer.

The initial executable inventory also found no installed slicer CLI (`command -v` over Docker, BambuStudio, Prusa/SuperSlicer, Blender, OpenSCAD and mesh utilities); local Docker images were only `python:3.12-slim` and `postgres:16-alpine`.

## Unsupported implementation claims

- General geometric wall, isolated-feature, mating-clearance, relief, bounds, overhang, bridge, and support validator: **NOT RUN / absent**. Fixture geometry and the BambuStudio slice do not count as this implementation.
- Nonconsequential repair restrictions and R-2 topology/geometry equivalence: **NOT RUN / absent**.
- Consequential-change classification: **NOT RUN / absent**.
- R-11 immutable validation-lineage ID, atomic one-retry slot, simultaneous-trigger deduplication, and failed-dispatch/retry tests: **NOT RUN / absent**.
- Physical A1 mini or silk PLA validation: **NOT RUN**; no hardware/material was used.

## Files created

- [REPORT.md](REPORT.md)
- [effective-profile.json](effective-profile.json)
- [qualify_fixtures.py](../../../../tools/qualification/print/qualify_fixtures.py)
- [prepare_cli_process.py](../../../../tools/qualification/print/prepare_cli_process.py)
- [fixtures](fixtures/) including STL/3MF fixtures, `fixtures.json`, `probe-results.json`, final rerun output, and hashes
- [profile-source](profile-source/) including the 11-file inheritance closure, source commit pin, SHA-256 manifest, and AGPL license metadata
- [slicer-attempt](slicer-attempt/) containing the pinned release, digest, dependency-resolution logs, effective CLI inputs, G-code, 3MF, slice results, and the reusable recipe rerun
- [Dockerfile.bambustudio-cli](../../../../tools/qualification/print/Dockerfile.bambustudio-cli), [bambu-cli-entrypoint.sh](../../../../tools/qualification/print/bambu-cli-entrypoint.sh), [run_bambu_cli_slice.sh](../../../../tools/qualification/print/run_bambu_cli_slice.sh), [prepare_cli_profiles.py](../../../../tools/qualification/print/prepare_cli_profiles.py), and [requirements-fixtures.txt](../../../../tools/qualification/print/requirements-fixtures.txt)
