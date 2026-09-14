#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
stack_cache="${NOVA3D_STACK_CACHE:-/home/josh/.cache/nova3d-qualification-20260914/stack}"
mkdir -p "$stack_cache"
run_root="${NOVA3D_STACK_RUN_ROOT:-$(mktemp -d "$stack_cache/run.XXXXXX")}"
project="$run_root/project"

mkdir -p "$project/app" "$stack_cache/npm-cache"
cp -a "$repo_root/tools/qualification/stack/app/." "$project/app/"
cp "$repo_root/tools/qualification/stack/package.json" \
  "$repo_root/tools/qualification/stack/package-lock.json" \
  "$repo_root/tools/qualification/stack/tsconfig.json" \
  "$repo_root/tools/qualification/stack/next-env.d.ts" \
  "$repo_root/tools/qualification/stack/postcss.config.mjs" "$project/"
npm ci --prefix "$project" --cache "$stack_cache/npm-cache" --no-audit --no-fund

echo "staged project: $project"
echo "dependencies: $project/node_modules"
