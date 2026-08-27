# TODO

Ordered. [SPEC.md](SPEC.md) is the target, [DECISIONS.md](DECISIONS.md) is why.

- [x] **Settle the payload hash.** Measured on real workerd (`bench/`): SHA-256 is 35x faster than the fastest installable keccak, and it is what makes a 10 MiB write fit inside the free plan's 10 ms budget. `Data:` carries SHA-256; keccak stays for the EIP-191 digest only. DECISIONS.md #17.

- [ ] **Implement the protocol.** The storage seam first (`head`/`get`/`put`/`delete` over bytes plus metadata, reads streaming, SPEC.md), then the two adapters, then the handler. Every route currently answers `not_implemented`.

- [ ] **Replace polystore in `platforms/nodejs`** with a `Map` backend and a directory backend (DECISIONS.md #14).

- [ ] **Write the contract suite** against the new protocol, running on both platforms as before, plus `vectors.json` pinning `(inputs → message → digest)` so a client and the server cannot drift silently.

- [ ] **Create the KV namespaces** and fill in `platforms/cf-worker/wrangler.toml`. Not the frozen namespace: see that file's warning.

- [ ] **Publish, server first.** `waxdb` depends on `waxdb-server` via `workspace:*`, which pnpm rewrites to a real version at publish time, so publishing the CLI first leaves `npm i waxdb` unresolvable. Both names are held by `0.0.0` placeholders.

- [ ] **Move the consumers over.** `synqable`'s adapter (`sync/adapters/secp256k1-db`) speaks the old JSON-RPC protocol and needs a waxdb sibling. Its `Secp256k1Signer` interface stays as-is, since waxdb kept `signMessage(string)`.

- [ ] **Compression in the consumer.** `jolly-roger`'s serializer is plain `JSON.stringify`; `stratagems` compresses before encrypting. The new consumer should do the same, and it matters more than any server-side limit (DECISIONS.md #13).
