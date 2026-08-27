# Which hash covers the payload

This measured the one protocol decision that was left open in SPEC.md, and the answer is written up as [DECISIONS.md #17](../DECISIONS.md). It is kept because the decision was made on numbers, and a number nobody can reproduce is an opinion.

```bash
cd bench && npm install && ./run.sh
```

It is deliberately outside the pnpm workspace: nothing in the service depends on it, and `pnpm install` at the root should not pull an esbuild and a workerd for it.

## What it measures, and why it is shaped this way

Three things make a naive benchmark wrong inside a Worker, and each one is a design constraint here.

**A Worker's clock does not advance during compute.** `Date.now()` and `performance.now()` move only on I/O, which is a Spectre mitigation. Timing inside the isolate reports zero. So `drive.mjs` times whole HTTP requests from outside, and subtracts a separately measured `alg=none` request at the same size and iteration count to remove the fixed overhead.

**Allocation would dominate.** A 10 MiB `Uint8Array` costs real time to fill, so payloads are generated once per isolate and cached. A warm request pays for hashing and nothing else.

**workerd is not miniflare-in-vitest.** This runs the actual `workerd` binary with a hand-written `workerd.capnp`, so nothing in the test pool is between the measurement and the runtime.

`min` is the headline rather than the median, because the work is CPU-bound and the fastest sample is the one least polluted by the scheduler. The median is printed next to it, so a noisy run is obvious instead of quietly wrong. Every keccak implementation is checked against the others before any timing runs; if they disagree the run aborts.

## The WASM column is not an option, and that is the finding

workerd refuses to compile WebAssembly at runtime:

```
CompileError: WebAssembly.compile(): Wasm code generation disallowed by embedder
```

`hash-wasm`, and every other npm WASM hashing package, compiles an embedded base64 blob when it loads. All of them fail outright in a Worker. The only legal path is a `.wasm` declared as a module in the worker config, so `extract-keccak-wasm.mjs` intercepts `WebAssembly.compile` under Node to capture hash-wasm's blob, and `src/worker.js` drives its private ABI (`Hash_Init` / `Hash_Update` / `Hash_Final` over a 16 KB heap window, with a magic `0x01` padding byte) by hand.

That column therefore measures a vendored fork against an undocumented interface, not something anyone would take a dependency on. It is included so keccak is judged at its best case rather than its convenient one, and it still loses.

The extracted `keccak.wasm` is not committed: it is a build artifact of an MIT-licensed dependency and `run.sh` regenerates it.

## Reading the output

`ms / hash` is the number that matters, since a write hashes the whole payload before it can verify anything. `keccak-message` and `recover` are the two constant costs: the EIP-191 digest is a few hundred bytes whatever the payload, and every authenticated read pays one secp256k1 recovery.

Results land in `results.json` next to the numbers quoted in DECISIONS.md #17.

One caveat worth keeping in mind when re-running on other hardware: `crypto.subtle`'s SHA-256 uses the CPU's SHA extensions where they exist. Both the machine these numbers came from and Cloudflare's fleet have them, so the ratio holds, but a machine without `sha_ni` will show a much smaller gap.
