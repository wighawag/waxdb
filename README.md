# secp256k1-db

An authenticated key-value database using secp256k1 signatures (compatible with Ethereum wallets).

Data is stored per Ethereum address, and only the holder of the private key can write it: every write carries a signature over the value, and a counter prevents replaying an older write. Reads are public.

The service runs on Cloudflare Workers (the deployment live apps talk to) and as a local Node process, from the same platform-agnostic core.

## Layout

```
packages/
  server/            core service, no platform APIs, storage behind an interface
    src/api/         the JSON-RPC handler
    src/record.ts    the on-disk format (frozen: live data depends on it)
    src/storage.ts   the storage seam
    test/contract/   the behavioural contract, run against every platform
platforms/
  cf-worker/         Cloudflare Workers: Storage -> KV namespace
  nodejs/            CLI: Storage -> polystore (memory or a JSON file)
```

The core never touches a platform API. It receives `getStorage` and `getEnv` callbacks, and each platform supplies its own, which is what makes the same code (and the same tests) run on Workers and on Node.

## Using it locally (offline)

```bash
npx secp256k1-db --port 2000 --db ./secp256k1-db.json
```

`--db :memory:` (the default) keeps everything in memory, any other value is a path to a JSON file it persists to. `--clear` empties the store before starting, and `--token-admin <token>` enables the `reset` method for requests carrying that value in a `TOKEN` header.

## Development

```bash
pnpm install
pnpm test          # the contract, on all platforms
pnpm dev:cf        # wrangler dev
pnpm dev:node      # the CLI against a local store
pnpm build
pnpm run deploy    # note the `run`: `pnpm deploy` is a pnpm builtin
```

## API

All methods are JSON-RPC 2.0 over `POST`. The path is ignored, so any path works.

### `wallet_getString`

Reads the record for an address in a namespace. Returns `{data, counter, signature}`, or `{data: "", counter: "0", signature: ""}` when nothing is stored.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "wallet_getString",
  "params": ["0x1234567890123456789012345678901234567890", "my-namespace"]
}
```

### `wallet_putString`

Writes a record. Parameters are `address`, `namespace`, `counter`, `data`, `signature`, where the signature is over the message `put:${namespace}:${counter}:${data}` and the counter is a millisecond timestamp that must be greater than the stored one and not in the future.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "wallet_putString",
  "params": [
    "0x1234567890123456789012345678901234567890",
    "my-namespace",
    "1632146788123",
    "Hello, world!",
    "0x123...signature"
  ]
}
```

### `reset`

Deletes a record. Requires the `TOKEN` header to match `TOKEN_ADMIN`, and is inert when that is unset.

## Deployment

See [platforms/cf-worker/README.md](platforms/cf-worker/README.md). Read it before deploying: the worker name and KV namespace id in `wrangler.toml` are not interchangeable, they identify the live service and its data.

## Behaviour is pinned by tests

`packages/server/test/contract/` holds one suite that every platform runs, plus an opt-in run against a deployed instance. It documents the current behaviour, quirks included, because live apps depend on the exact responses. Read [packages/server/test/README.md](packages/server/test/README.md) before changing anything user-visible.

The behaviour being pinned is not the same as the behaviour being right. [KNOWN-ISSUES.md](KNOWN-ISSUES.md) lists what is wrong with it and what fixing each thing would break.

## License

See the [LICENSE](LICENSE) file for details.
