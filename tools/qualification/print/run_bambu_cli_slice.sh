#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
appimage=${BAMBU_APPIMAGE:?Set BAMBU_APPIMAGE to the pinned official AppImage}
expected_sha256=${BAMBU_APPIMAGE_SHA256:-d501b103fac5424513ec0e8d6bc145fb30719de2c7d94d7320d723740c81a7fd}
input_dir=${BAMBU_INPUT_DIR:?Set BAMBU_INPUT_DIR to a directory containing machine.json, process-effective.json, filament.json, and positive_envelope.stl}
output_dir=${BAMBU_OUTPUT_DIR:?Set BAMBU_OUTPUT_DIR to an isolated writable output directory}
data_dir=${BAMBU_DATA_DIR:?Set BAMBU_DATA_DIR to an isolated writable data directory}
image=${BAMBU_DOCKER_IMAGE:-nova3d/bambu-cli:v02.08.02.61-ubuntu24.04}

test "$(sha256sum "$appimage" | awk '{print $1}')" = "$expected_sha256"
mkdir -p "$output_dir" "$data_dir"
docker build --pull=false --rm -f "$script_dir/Dockerfile.bambustudio-cli" -t "$image" "$script_dir"
docker run --rm --name nova3d-bambu-cli-slice \
  --network=none --cpus=2 --memory=2g --pids-limit=512 \
  -e "BAMBU_APPIMAGE_SHA256=$expected_sha256" \
  -v "$appimage:/probe/app/BambuStudio.AppImage:ro" \
  -v "$input_dir:/probe/input:ro" \
  -v "$output_dir:/probe/output:rw" \
  -v "$data_dir:/probe/data:rw" \
  "$image"
