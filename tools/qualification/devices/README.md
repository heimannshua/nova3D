# Browser/runtime qualification

Run from the repository root with Node 24.21.0 and an installed Linux Chrome. The qualified browser was Chrome 153.0.8010.36 under software rendering.

```bash
export NOVA3D_DEVICE_CACHE="$HOME/.cache/nova3d-qualification-20260914/devices/repro"
mkdir -p "$NOVA3D_DEVICE_CACHE"
cp tools/qualification/devices/package.json tools/qualification/devices/package-lock.json "$NOVA3D_DEVICE_CACHE/"
npm ci --prefix "$NOVA3D_DEVICE_CACHE" --ignore-scripts --no-audit --no-fund
NOVA3D_CHROME=/usr/bin/google-chrome node tools/qualification/devices/probe.mjs > "$NOVA3D_DEVICE_CACHE/results.json"
```

The probe checks installed versions and fails on required assertions. PASS covers WebGL2, storage/Worker/Service Worker primitives, a Three box and ONNX WASM identity model. Optional WebGPU is separate. Offline reload compares original IndexedDB data and OPFS/cache bytes; it does not execute offline Three/ONNX assets.

Small viewports exercise API behavior only. They establish no phone layout, accessibility, latency, memory, thermal or hardware acceptance. G-5/G-8 remain blocked; see the [device report](../../../_bmad-output/implementation-artifacts/qualification-2026-09-14/devices/qualification-report.md).
