#!/usr/bin/env bash
#
# The whole measurement, end to end: extract the wasm, bundle the worker, start
# real workerd, drive it, stop it.
#
#   cd bench && npm install && ./run.sh
#
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
	echo "run \`npm install\` in bench/ first" >&2
	exit 1
fi

PORT="${PORT:-8787}"

echo "==> extracting keccak.wasm from hash-wasm"
node extract-keccak-wasm.mjs

echo "==> bundling the worker"
./node_modules/.bin/esbuild src/worker.js \
	--bundle --format=esm --platform=browser \
	--external:keccak.wasm \
	--outfile=bundle.js --log-level=warning

cleanup() {
	if [ -n "${WORKERD_PID:-}" ]; then
		kill -9 "$WORKERD_PID" 2>/dev/null || true
	fi
}
trap cleanup EXIT

echo "==> starting workerd on :$PORT"
./node_modules/.bin/workerd serve workerd.capnp > workerd.log 2>&1 &
WORKERD_PID=$!

for _ in $(seq 1 50); do
	if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/?alg=none&size=16&iters=1" \
		>/dev/null 2>&1; then
		break
	fi
	sleep 0.2
done

if ! curl -fsS --max-time 5 "http://127.0.0.1:$PORT/?alg=none&size=16&iters=1" >/dev/null; then
	echo "workerd did not come up:" >&2
	cat workerd.log >&2
	exit 1
fi

echo "==> measuring (this takes a couple of minutes)"
BENCH_URL="http://127.0.0.1:$PORT" node drive.mjs
