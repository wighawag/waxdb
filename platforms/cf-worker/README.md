# secp256k1-db on Cloudflare Workers

This is the deployment that live apps talk to.

## The two identifiers that must not drift

```toml
name = "secp256k1-kv-db"                  # the deployed worker, and therefore the URL
id   = "198cd439a1e2498e98c4e70f0aaaa47f" # the KV namespace holding the live records
```

`https://secp256k1-kv-db.rim.workers.dev` is the URL clients use, and it follows the worker `name`: renaming the worker moves the service to a different URL and silently leaves every client talking to the old one. The KV `id` is the data: the namespace (titled `secp256k1-db-PRIVATE_STORE`) holds records written since 2021, and pointing the binding elsewhere serves an empty database rather than an error.

Both values were wrong in this repo between September 2023 and 2026, which would have published a second, dataless worker instead of updating the live one. Change them only deliberately.

`preview_id` (`a6327ec076ba42f589d1791afa537cf5`, empty) is for `wrangler dev --remote` only.

## Deploy

```bash
pnpm build          # from the repo root: the worker imports the built server
pnpm deploy         # from the repo root, or `wrangler deploy` here
```

Then verify the deployment against the contract:

```bash
LIVE_URL=https://secp256k1-kv-db.rim.workers.dev LIVE_RESET=true \
  pnpm --filter secp256k1-db-server test:live
```

That run writes throwaway records under generated namespaces. Delete them afterwards, and check the key count is back to where it started:

```bash
wrangler kv key list --namespace-id 198cd439a1e2498e98c4e70f0aaaa47f --remote > keys.json
# keep only keys matching ^(ns|a|b|we:ird)-[0-9a-z]{8}-\d+-[0-9a-z]+_0x[0-9a-f]{40}$
wrangler kv bulk delete junk.json --namespace-id 198cd439a1e2498e98c4e70f0aaaa47f --remote
```

`--remote` matters: wrangler 4 reads and writes *local* storage by default, so without it you will be told the key does not exist while the live record sits there untouched.

For a safer rollout, `wrangler versions upload` publishes without taking traffic, and `wrangler versions deploy` ramps it. `wrangler rollback` reverts.

## Secrets

`TOKEN_ADMIN` gates the `reset` method and is unset today, so `reset` answers `not admin`. Set it with `wrangler secret put TOKEN_ADMIN`. It is a secret, not a var, so it must never be added to `wrangler.toml`.

## Tests

`pnpm test` runs the shared contract on real workerd against a real (miniflare-backed) KV namespace, isolated per test and never touching the remote namespace. Because the binding is reachable from the tests, the storage-format assertions run here: this is what proves the KV adapter writes the exact bytes the live namespace already contains.

The `nodejs_compat` flag needed by `@cloudflare/vitest-pool-workers` lives in `vitest.config.ts`, deliberately not in `wrangler.toml`, so the deployed runtime keeps the flags it has always had.
