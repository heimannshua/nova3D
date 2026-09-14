#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
stack_cache="${NOVA3D_STACK_CACHE:-/home/josh/.cache/nova3d-qualification-20260914/stack}"
mkdir -p "$stack_cache"
run_root="$(mktemp -d "$stack_cache/verify.XXXXXX")"
log_file="$stack_cache/verify-$(basename "$run_root").log"
exec > >(tee "$log_file") 2>&1

project=""
server_pid=""
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

setup_output="$(NOVA3D_STACK_CACHE="$stack_cache" NOVA3D_STACK_RUN_ROOT="$run_root" \
  "$repo_root/tools/qualification/stack/setup-stack.sh")"
printf '%s\n' "$setup_output"
project="$(printf '%s\n' "$setup_output" | sed -n 's/^staged project: //p')"
[ -n "$project" ] || { echo 'ASSERT setup: FAIL'; exit 1; }
echo 'ASSERT setup: PASS'
cd "$project"

node "$project/node_modules/typescript/bin/tsc" --noEmit -p "$project/tsconfig.json"
echo 'ASSERT typecheck: PASS'

NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
  node "$project/node_modules/next/dist/bin/next" build
echo 'ASSERT production-build: PASS'

port="$(node -e "const net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
  node "$project/node_modules/next/dist/bin/next" start --hostname 127.0.0.1 --port "$port" &
server_pid=$!
ready=0
for _ in $(seq 1 40); do
  if curl --silent --show-error --fail --max-time 1 -D "$run_root/home.headers" \
      -o "$run_root/home.html" "http://127.0.0.1:$port/"; then
    ready=1
    break
  fi
  sleep 0.25
done
[ "$ready" -eq 1 ] || { echo 'ASSERT production-home: FAIL'; exit 1; }
home_status="$(awk '$1 ~ /^HTTP\// {code=$2} END {print code}' "$run_root/home.headers")"
[ "$home_status" = '200' ] || { echo "ASSERT production-home-status: FAIL ($home_status)"; exit 1; }
rg -q 'data-stack-probe="ready"' "$run_root/home.html"
echo "ASSERT production-home: PASS (HTTP $home_status)"
curl --silent --show-error --fail --max-time 2 -D "$run_root/workflow.headers" \
  -o "$run_root/workflow.json" "http://127.0.0.1:$port/api/workflow"
workflow_status="$(awk '$1 ~ /^HTTP\// {code=$2} END {print code}' "$run_root/workflow.headers")"
[ "$workflow_status" = '200' ] || { echo "ASSERT production-workflow-route-status: FAIL ($workflow_status)"; exit 1; }
rg -q '"workflowBinding":"function"' "$run_root/workflow.json"
rg -q '"providerCall":false' "$run_root/workflow.json"
echo "ASSERT production-workflow-route: PASS (HTTP $workflow_status)"
echo 'ASSERT overall: PASS'
echo "verification artifacts: $run_root/home.html $run_root/home.headers $run_root/workflow.json $run_root/workflow.headers"
echo "verification log: $log_file"
