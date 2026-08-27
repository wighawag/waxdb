# waxdb

An authenticated key-value store for ethereum addresses. Only the holder of the key can write a record, and unless the deployment opens reads up, only that same holder can read it.

A record is an opaque **payload of bytes** plus the secp256k1 signature that authorises it, stored under `(namespace, owner)`. A counter that must increase stops an old write being replayed. Reads need a short-lived token signed by the owner, unless the deployment is configured for public reads. The payload is never interpreted by the server, and in practice it is compressed ciphertext, so the host cannot read it either.

**The device is the source of truth and waxdb is a cache.** A record cannot be recovered, migrated or re-signed by the server, because only the key holder can sign. Clients are expected to hold their own copy and treat a read as input to a merge rather than as an authority, which is what makes losing the server copy a re-push rather than a loss.

- **[SPEC.md](SPEC.md)** is the protocol: the wire, the signed message, the storage layout, the limits.
- **[DECISIONS.md](DECISIONS.md)** is why it is shaped that way, and what each decision cost.

## Status

The protocol is specified. The implementation is not written: every route answers `not_implemented` in the error shape the spec defines. What exists is the platform skeleton, the storage seam and the two adapters, inherited from the predecessor.

One protocol decision is still open, marked in SPEC.md: which hash covers the payload.

## Layout

```
packages/
  server/            the service, no platform APIs, storage behind an interface
platforms/
  cf-worker/         Cloudflare Workers: Storage -> KV
  nodejs/            CLI: Storage -> a local store
```

The core never touches a platform API. It receives `getStorage` and `getEnv` callbacks and each platform supplies its own, which is what lets the same code, and the same tests, run on Workers and on Node.

## Using it locally, offline

```bash
npx waxdb --port 2000 --db ./waxdb-data
```

The local server is not a mock. It answers what the deployed service answers, because one contract suite runs against both, and it is what makes a consumer's offline development real rather than approximate.

## Development

```bash
pnpm install
pnpm test          # the contract, on every platform
pnpm dev:cf        # wrangler dev
pnpm dev:node      # the CLI against a local store
pnpm build
pnpm run deploy    # note the `run`: `pnpm deploy` is a pnpm builtin
```

## The predecessor

waxdb replaces [etherplay/secp256k1-db](https://github.com/etherplay/secp256k1-db), which is archived, still deployed, and still serving apps that cannot be rebuilt. waxdb shares no code path, no deployment and no storage with it, and neither can read the other's records. The reasoning is DECISIONS.md #1, and the operational rules for the frozen service are at the end of that file.

## License

See the [LICENSE](LICENSE) file for details.
