# TODO

Ordered. [SPEC.md](SPEC.md) is the target, [DECISIONS.md](DECISIONS.md) is why.

## Next

- [ ] **Bootstrap the two new npm names.** Releases go through changesets and npm Trusted Publishing (OIDC, no token) via `.github/workflows/release.yml`, but that setting lives *on a package*, so `@waxdb/server` and `@waxdb/client` have to exist before they can hold it. Publish each once by hand, then register the trusted publisher for all three. [PUBLISHING.md](PUBLISHING.md) has the steps. `waxdb` itself is already on npm at `0.0.0`.

  Publish order needs no thought once that is done: `waxdb` depends on `@waxdb/server` through `workspace:*`, and changesets publishes in dependency order.

- [ ] **Move the consumers over.** `synqable`'s adapter (`sync/adapters/secp256k1-db`) speaks the old JSON-RPC protocol and needs a waxdb sibling. `@waxdb/client` is the replacement and its `Signer` is structural, so `Secp256k1Signer` satisfies it unchanged: waxdb kept `signMessage(string)`.

- [ ] **Compression in the consumer.** `jolly-roger`'s serializer is plain `JSON.stringify`; `stratagems` compresses before encrypting. The new consumer should do the same, and it matters more than any server-side limit (DECISIONS.md #13).

- [ ] **Run the live conformance suite before each deploy**, not only after. `wrangler versions upload` gives a preview URL to point `LIVE_URL` at without taking traffic. This is the only harness that runs against real KV, and it is what caught DECISIONS.md #19 after 163 local worker assertions passed against a simulator. It writes, and it spends a few hundred KV writes, so not against a free-tier deployment that matters.

## Open questions, not yet worth acting on

- **Should miniflare's KV be made to lie less?** Its local KV is immediately consistent where the real one is not, which is what let the `list`/`get` divergence through a fully green local suite. An adapter-level test that injects propagation delay would catch that class locally, at the cost of a fake whose fidelity is itself unverifiable. The live suite catches it for real, so this is a question of how early rather than whether.

- **`Expected` is best-effort and always will be on KV.** Real compare-and-swap means leaving Cloudflare KV, which was chosen for its price (DECISIONS.md #8). Revisit only if silent clobbering shows up in practice rather than in theory.

## Known gaps, deliberate

- **The counter rule is only as strong as the store's consistency.** The check is a read then a write with no atomicity between them, so it enforces "greater than what this server could see". Bounded, and decision 2 makes the next sync correct it (SPEC.md, Counter rules).
- **No rate limiting or quotas** beyond the platform's own. `rate_limited` surfaces KV's one-write-per-second-per-key, nothing more.
- **`Storage.delete` is never called by the protocol.** A `DELETE` writes a tombstone. The method exists for operators and platform teardown.
- **A deployment is all-authenticated or all-open.** Mixing would need the choice inside the signed message, and there is no cheap way to add a line later (DECISIONS.md #6, #16).

## Done

- [x] **Settle the payload hash.** Measured on real workerd (`bench/`): SHA-256 is 35x faster than the fastest installable keccak, and it is what makes a 10 MiB write fit inside the free plan's 10 ms budget. DECISIONS.md #17.
- [x] **Implement the protocol.** Storage seam, both adapters, handler. Signature verified before storage is consulted; read failures indistinguishable from absence.
- [x] **Replace polystore** with a `Map` backend and a directory backend (DECISIONS.md #14). `--db` is a directory now.
- [x] **The contract suite**, one `runContractTests(harness)` across the in-process server, real workerd, both Node backends and a live deployment, each in both read modes, plus `vectors.json` and a CLI restart smoke test.
- [x] **Drop `?since`** and the retracted claim that justified it (DECISIONS.md #18).
- [x] **Create the KV namespaces** and deploy. Live at `waxdb.rim.workers.dev`.
- [x] **Fix `head` on Cloudflare.** It was answered from `kv.list`, which lags `kv.get` by ~30 s on real KV, leaving the counter rule unenforced for that window. Verified fixed in production (DECISIONS.md #19).
- [x] **Bump the worker test toolchain.** `@cloudflare/vitest-pool-workers` 0.22 and vitest 4, so the local worker tests run a workerd that supports the deployed compatibility date instead of silently falling back.
- [x] **The client**, MIT, with no runtime dependencies and its own implementation of the wire format, held to `vectors.json` (DECISIONS.md #20).
- [x] **Fix the licence contradiction.** The root `LICENSE` was still the predecessor's MIT text while every `package.json` said `AGPL-3.0-only`.
