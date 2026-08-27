# waxdb

An authenticated key-value store for ethereum addresses. Only the holder of the key can write a record, and unless the deployment opens reads up, only that same holder can read it.

A record is an opaque **payload of bytes** plus the secp256k1 signature that authorises it, stored under `(namespace, owner)`. A counter that must increase stops an old write being replayed. Reads need a short-lived token signed by the owner, unless the deployment is configured for public reads. The payload is never interpreted by the server, and in practice it is compressed ciphertext, so the host cannot read it either.

**The device is the source of truth and waxdb is a cache.** A record cannot be recovered, migrated or re-signed by the server, because only the key holder can sign. Clients are expected to hold their own copy and treat a read as input to a merge rather than as an authority, which is what makes losing the server copy a re-push rather than a loss.

- **[SPEC.md](SPEC.md)** is the protocol: the wire, the signed message, the storage layout, the limits.
- **[DECISIONS.md](DECISIONS.md)** is why it is shaped that way, and what each decision cost.

## Status

The protocol is specified and implemented. One contract suite runs against the core in-process, the worker on real workerd, and both Node backends, in both read modes.

The protocol has no open questions. The last one, which hash covers the payload, was settled by measurement in `bench/` and recorded as DECISIONS.md #17.

Not deployed: `platforms/cf-worker/wrangler.toml` still carries placeholder KV ids. See [TODO.md](TODO.md).

## Layout

```
packages/
  server/            the service, no platform APIs, storage behind an interface
  client/            the client library. MIT, and independent of the server
platforms/
  cf-worker/         Cloudflare Workers: Storage -> KV
  nodejs/            CLI: Storage -> a local store
bench/               what hashing costs in a Worker (DECISIONS.md #17)
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

pnpm --filter waxdb-server run vectors   # regenerate vectors.json
cd bench && npm install && ./run.sh      # re-measure the hash decision
```

[`vectors.json`](vectors.json) pins `(inputs -> message -> digest)` for every intent. It is what stops a client and the server drifting apart silently, since a change to the encoding that does not update it surfaces only as `signature_mismatch` in production.

## The predecessor

waxdb replaces [etherplay/secp256k1-db](https://github.com/etherplay/secp256k1-db), which is archived, still deployed, and still serving apps that cannot be rebuilt. waxdb shares no code path, no deployment and no storage with it, and neither can read the other's records. The reasoning is DECISIONS.md #1, and the operational rules for the frozen service are at the end of that file.

## Using it from an app

```bash
npm i waxdb-client
```

```ts
const client = new WaxdbClient({endpoint, namespace: 'my.app', signer: wallet});
await client.put(bytes);
const read = await client.get();
```

See [packages/client](packages/client/README.md). It carries its own implementation of the wire format rather than importing the server's, and `vectors.json` is what holds the two to the same answer.

## License

**[AGPL-3.0-only](LICENSE)**, except the client.

**[packages/client](packages/client/LICENSE) is MIT**, because a client library that cannot be embedded freely is not much of a client library. The service is something you run, where the AGPL keeps a hosted fork's improvements available; the client is something you embed, where copyleft would just stop people adopting it. DECISIONS.md #20.
