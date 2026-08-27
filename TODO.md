# TODO

Ordered. [SPEC.md](SPEC.md) is the target, [DECISIONS.md](DECISIONS.md) is why.

- [ ] **Settle the payload hash** (SPEC.md, "Under review"). keccak matches the EIP-191 digest and needs no second primitive; SHA-256 is native in a Worker and roughly an order of magnitude faster, which is what decides whether a free-tier deployment is usable. Measure both in workerd before choosing. This must land before any signature exists, because it changes the signed message.

- [ ] **Implement the protocol.** The storage seam first (`head`/`get`/`put`/`delete` over bytes plus metadata, reads streaming, SPEC.md), then the two adapters, then the handler. Every route currently answers `not_implemented`.

- [ ] **Replace polystore in `platforms/nodejs`** with a `Map` backend and a directory backend (DECISIONS.md #14).

- [ ] **Write the contract suite** against the new protocol, running on both platforms as before, plus `vectors.json` pinning `(inputs → message → digest)` so a client and the server cannot drift silently.

- [ ] **Create the KV namespaces** and fill in `platforms/cf-worker/wrangler.toml`. Not the frozen namespace: see that file's warning.

- [ ] **Publish, server first.** `waxdb` depends on `waxdb-server` via `workspace:*`, which pnpm rewrites to a real version at publish time, so publishing the CLI first leaves `npm i waxdb` unresolvable. Both names are held by `0.0.0` placeholders.

- [ ] **Move the consumers over.** `synqable`'s adapter (`sync/adapters/secp256k1-db`) speaks the old JSON-RPC protocol and needs a waxdb sibling. Its `Secp256k1Signer` interface stays as-is, since waxdb kept `signMessage(string)`.

- [ ] **Compression in the consumer.** `jolly-roger`'s serializer is plain `JSON.stringify`; `stratagems` compresses before encrypting. The new consumer should do the same, and it matters more than any server-side limit (DECISIONS.md #13).
