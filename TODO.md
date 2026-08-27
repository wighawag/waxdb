# TODO

Ordered. [SPEC.md](SPEC.md) is the target, [DECISIONS.md](DECISIONS.md) is why.

## Done

- [x] **Settle the payload hash.** Measured on real workerd (`bench/`): SHA-256 is 35x faster than the fastest installable keccak, and it is what makes a 10 MiB write fit inside the free plan's 10 ms budget. `Data:` carries SHA-256; keccak stays for the EIP-191 digest only. DECISIONS.md #17.

- [x] **Implement the protocol.** The storage seam, both adapters, and the handler. Validation, message construction, verification, counter and precondition checks, then storage, in that order.

- [x] **Replace polystore in `platforms/nodejs`** with a `Map` backend and a directory backend (DECISIONS.md #14). `--db` is now a directory, not a JSON file.

- [x] **The contract suite**, one `runContractTests(harness)` against the in-process server, real workerd, and both Node backends, each in both read modes, plus `vectors.json` and a CLI smoke test that survives a restart.

## Next

- [ ] **Decide on `?since=<counter>`.** Its justification in SPEC.md was retracted on 2026-08-26 (preflight results are cached per URL, so `If-None-Match` does not cost a preflight per poll) but the feature and the stale reasoning are still in the spec. **It is currently not implemented**: conditional reads are `If-None-Match` only. Either delete it from SPEC.md and add the decision, or say so and it goes back in as about five lines.

- [ ] **Create the KV namespaces** and fill in `platforms/cf-worker/wrangler.toml`. Not the frozen namespace: see that file's warning.

- [ ] **Bump `@cloudflare/vitest-pool-workers`.** It pins an older workerd, so the worker contract currently runs against compatibility date `2024-12-30` while `wrangler.toml` asks for `2026-08-01`, and miniflare warns about the gap on every run. The tests pass on both, but they are not verifying the runtime a deploy would get.

- [ ] **Publish, server first.** `waxdb` depends on `waxdb-server` via `workspace:*`, which pnpm rewrites to a real version at publish time, so publishing the CLI first leaves `npm i waxdb` unresolvable. Both names are held by `0.0.0` placeholders.

- [ ] **Run the live conformance suite** once there is a deployment: `LIVE_URL=… pnpm test:live`. It writes, and it spends a few hundred KV writes, so not against a free-tier deployment that matters.

- [ ] **Move the consumers over.** `synqable`'s adapter (`sync/adapters/secp256k1-db`) speaks the old JSON-RPC protocol and needs a waxdb sibling. Its `Secp256k1Signer` interface stays as-is, since waxdb kept `signMessage(string)`. The client needs SHA-256 for the payload now as well as keccak for the digest, and `vectors.json` is what it should test against.

- [ ] **Compression in the consumer.** `jolly-roger`'s serializer is plain `JSON.stringify`; `stratagems` compresses before encrypting. The new consumer should do the same, and it matters more than any server-side limit (DECISIONS.md #13).

## Known gaps, deliberate

- **`Expected` is best-effort**, because Cloudflare KV has no compare-and-swap and reads are eventually consistent. It detects staleness, not races (DECISIONS.md #8), and the contract pins it that way.
- **No rate limiting or quotas** beyond the platform's own. `rate_limited` surfaces KV's one-write-per-second-per-key, nothing more.
- **`Storage.delete` is never called by the protocol.** A `DELETE` writes a tombstone. The method exists for operators and platform teardown.
