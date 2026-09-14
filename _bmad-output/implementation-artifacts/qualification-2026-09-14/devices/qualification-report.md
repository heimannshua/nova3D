# nova3D devices qualification — G-5/G-8

Date: 2026-09-14 UTC
Status: browser/storage/runtime feasibility evidence only; the named-device and
multi-view phone acceptance gates remain **BLOCKED**.

The probe emits `overallStatus: PASS` and exits zero only when all required
local assertions pass. Required assertion failures emit `overallStatus: FAIL`,
list `failedAssertions`, and exit nonzero. Optional unavailable APIs are listed
as `UNSUPPORTED` rather than treated as required failures.

## Scope and exact reproduction

This report qualifies only the executable probe in
[`tools/qualification/devices/probe.mjs`](../../../../tools/qualification/devices/probe.mjs).
It is not the nova3D app, an image-to-3D engine, a viewer benchmark, or a
deployed-device qualification. No model weights or paid/cloud services were
used.

Use the [locked reproduction commands](../../../../tools/qualification/devices/README.md), which install from `package-lock.json` in an isolated cache. The final parent run used `NOVA3D_DEVICE_CACHE=/home/josh/.cache/nova3d-qualification-20260914/devices/repro`; the probe reads and checks actual installed package versions.

Pinned packages: Playwright 1.63.0, Three.js 0.186.0, ONNX Runtime Web
1.29.0. Runtime: Node v24.21.0. Browser: Google Chrome 153.0.8010.36,
Playwright headless, Linux x86_64. Host: Linux 7.0.0-31-generic, 4 logical
CPUs, 7.7 GiB RAM, no known physical GPU; WebGL uses SwiftShader.

Raw evidence: [`browser-probe-results.json`](browser-probe-results.json),
[`browser-probe-stderr.log`](browser-probe-stderr.log), and
[`probe-input-sha256.txt`](probe-input-sha256.txt).

## Executed results

| Probe | Observed result | Status | Scope / limitation |
| --- | --- | --- | --- |
| WebGL2 | Context created; renderer `ANGLE ... SwiftShader Device (Subzero)` | PASS | Software headless Linux only; not GPU performance or named-device evidence |
| WebGPU | `navigator.gpu` and `requestAdapter()` succeeded under `--enable-unsafe-webgpu`; adapter name null | PASS | SwiftShader/headless Linux only; no WebGPU performance or mobile claim |
| IndexedDB | Synthetic record with a 32-byte payload written and compared byte-for-byte; offline pass read the preexisting record without rewriting | PASS | Storage API fixture, not app schema/eviction/reconnect behavior |
| OPFS | Synthetic 32-byte file written and read; offline pass read the preexisting bytes without rewriting | PASS | Storage API fixture, not quota/eviction/device behavior |
| Worker | Blob worker round-trip returned `worker-fixture` | PASS | Minimal worker API check |
| Service Worker/cache offline navigation | Cached `/index.html` and 33-byte synthetic artifact remained readable after `context.setOffline(true)` and reload; controller true; fetched and cached bytes exactly match the fixture, and same-length corruption is rejected | PASS | Small local fixture only; no app shell/model bundle or conflict sync |
| Three.js fixture | Box geometry revision `186`, 24 positions, bounds `[2,3,4]`, metadata IDs `fixture.box`, `fixture.base` | PASS | Synthetic geometry and fixture metadata; not real viewer semantic-feature mapping |
| ONNX Runtime Web | Pinned 1.29.0 WASM backend executed a generated 1-element Identity model (`3.5 → 3.5`) | PASS | Tensor execution only; explicitly not image-to-3D or reconstruction evidence |
| Offline Three.js/ONNX execution | Assets were not cached in the offline pass | NOT RUN | Deliberately separated from persistence; no offline inference claim |
| Small viewport API contexts | Mobile viewport contexts only (`393×852 @3`, `412×915 @2.625`) | NOT RUN | Viewport/capability emulation on Linux Chrome; no iPhone/Pixel hardware, Safari, thermal, memory, or latency claim |
| MacBook Air M2 / Windows 11 Iris Xe | No target hardware/OS/browser available | BLOCKED | G-5 named-device matrix cannot be accepted here |
| 100k-triangle / ≤5 s / ≤33 ms viewer target | No app/viewer exists and no timing benchmark was run | BLOCKED | G-5 remains open |
| Multi-view image-to-3D quality, ≤500 MiB bundle, ≤1 GiB working memory, ≤120 s phone conversion | No compliant engine/weights were available or downloaded | BLOCKED | G-8 release-blocking gap remains |

The emulated mobile runs reproduced the same API capability results and passed
the same synthetic geometry/runtime fixture, but they must not be interpreted
as iPhone or Pixel qualification.

## Image-to-3D engine feasibility review

This is a source review, not a downloaded-weight or execution qualification.
Only official repositories/model cards were checked; no large weight was
downloaded. [Immutable source pins](model-source-pins.json) retain capture time,
GitHub commits/README hashes and Hugging Face revisions. Published upstream
configurations exceed the target; quantized/adapted variants were not evaluated.

| Candidate | Official evidence | Fit against R-8/G-8 |
| --- | --- | --- |
| TripoSR | [Official repo](https://github.com/VAST-AI-Research/TripoSR) says MIT covers source and pretrained models, accepts image paths, and reports about 6 GB VRAM for default single-image inference. [Official model card](https://huggingface.co/stabilityai/TripoSR/tree/main) lists a 1.68 GB checkpoint. | **FAIL** for the adopted target: exceeds 500 MiB before runtime, exceeds 1 GiB working-memory intent by the published VRAM figure, and is a single-image LRM rather than a qualified multi-view phone engine. |
| InstantMesh | [Official repo](https://github.com/TencentARC/InstantMesh) is Apache-2.0, describes single-image sparse-view generation, recommends Python 3.10/PyTorch 2.1/CUDA 12.1, and supports model variants plus Zero123++. [Official model card](https://huggingface.co/TencentARC/InstantMesh) lists 1.25–1.51 GB checkpoint files and a 7.27 GB repository. | **FAIL**: package/checkpoint exceeds 500 MiB by a wide margin and the CUDA/PyTorch stack is not a browser/phone qualification path. |
| TRELLIS-image-large | [Microsoft official repo](https://github.com/microsoft/TRELLIS) states NVIDIA GPU with at least 16 GB memory and lists the image model at 1.2B parameters. [Official model card files](https://huggingface.co/microsoft/TRELLIS-image-large/tree/main/ckpts) include 1.13–1.2 GB flow weights and a 3.3 GB model repository; the card marks MIT. | **FAIL**: published GPU requirement and model artifacts exceed phone/1 GiB/500 MiB constraints; no browser or multi-view-phone proof. |
| Hunyuan3D-2 / 2mv | [Official repo](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) lists 1.1B-parameter multiview shape models and 6 GB VRAM for shape / 16 GB for shape+texture. [Official model license](https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE) is a territory-limited community license with additional restrictions. | **FAIL**: memory exceeds the adopted target; license/territory terms require legal review and are not a clean globally supported offline bundle. |

Conclusion: ONNX Runtime Web 1.29.0 is executable on this host, but no reviewed
candidate satisfies the adopted licensed, multi-view, ≤500 MiB, ≤1 GiB,
≤120-second phone/offline target. G-8 stays **BLOCKED** until a compliant
model bundle is selected, adapted, pinned and tested on the named devices with
held-out multi-view shape/coverage fixtures.

## Files created

- `tools/qualification/devices/package.json`
- `tools/qualification/devices/README.md`
- `tools/qualification/devices/probe.mjs`
- `tools/qualification/devices/fixture/index.html`
- `tools/qualification/devices/fixture/sw.js`
- `tools/qualification/devices/fixture/artifact.bin`
- `browser-probe-results.json`, `browser-probe-stderr.log`, `probe-input-sha256.txt`
