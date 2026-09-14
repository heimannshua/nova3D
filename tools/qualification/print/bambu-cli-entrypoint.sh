#!/usr/bin/env bash
set -euo pipefail

app=/probe/app/BambuStudio.AppImage
input=/probe/input
output=/probe/output
data=/probe/data
expected_sha256="${BAMBU_APPIMAGE_SHA256:?BAMBU_APPIMAGE_SHA256 is required}"

test -r "$app"
test "$(sha256sum "$app" | awk '{print $1}')" = "$expected_sha256"
test -r "$input/input.sha256"
(cd "$input" && sha256sum -c input.sha256)
mkdir -p "$output" "$data/extract" "$data/datadir/config" "$data/datadir/cache" "$data/datadir/data" "$data/datadir/tmp" "$data/datadir/runtime"
chmod 700 "$data/datadir/runtime"

cd "$data/extract"
"$app" --appimage-extract >/dev/null
bin="$data/extract/squashfs-root/bin/bambu-studio"
test -x "$bin"
export LD_LIBRARY_PATH="$(dirname "$bin")"
export XDG_CONFIG_HOME="$data/datadir/config"
export XDG_CACHE_HOME="$data/datadir/cache"
export XDG_DATA_HOME="$data/datadir/data"
export TMPDIR="$data/datadir/tmp"
export XDG_RUNTIME_DIR="$data/datadir/runtime"
export DISPLAY=
export WAYLAND_DISPLAY=
export LIBGL_ALWAYS_SOFTWARE=1

timeout --signal=TERM --kill-after=5s 60s "$bin" \
  --debug 3 \
  --datadir "$data/datadir" \
  --load-settings "$input/machine.json;$input/process-effective.json" \
  --load-filaments "$input/filament.json" \
  --slice 0 \
  --outputdir "$output" \
  --export-slicedata "$output/slicedata" \
  --export-3mf result.3mf \
  "$input/positive_envelope.stl"

test -s "$output/plate_1.gcode"
test -s "$output/result.3mf"
test -s "$output/result.json"
grep -q '"return_code": 0' "$output/result.json"
