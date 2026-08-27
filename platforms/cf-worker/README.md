# waxdb on Cloudflare Workers

## Before the first deploy

`wrangler.toml` ships with placeholder KV ids on purpose. Create the namespaces and paste them in:

```bash
npx wrangler kv namespace create RECORDS
npx wrangler kv namespace create RECORDS --preview
```

**Do not point this at the frozen `secp256k1-db` namespace** (`198cd439a1e2498e98c4e70f0aaaa47f`). That service is still running and still serving apps that cannot be rebuilt, waxdb shares no storage with it by design (DECISIONS.md #1), and the two use incompatible record formats. Pointing at it would not merge the data, it would write records the old service cannot read into a namespace it is still reading.

Two identifiers then matter, permanently:

```toml
name = "waxdb"   # the deployed worker, and therefore the URL
id   = "…"       # the KV namespace holding the records
```

Renaming the worker moves the service to a different URL and silently leaves every client talking to the old one. Repointing the binding serves an empty database rather than an error. A custom domain is worth setting up early for exactly this reason: it makes the next rename a DNS change instead of a client change.

## Deploy

```bash
pnpm run deploy     # from the repo root: builds the server, then deploys
```

Note the `run`: `pnpm deploy` is a pnpm builtin that prepares a deployable package folder and will not execute this script.

For a safer rollout, `wrangler versions upload` publishes without taking traffic, `wrangler versions deploy` ramps it, and `wrangler rollback` reverts.

When reading or writing KV from the command line, `--remote` matters: wrangler 4 uses *local* storage by default, so without it you will be told a key does not exist while the live record sits there untouched.

## Plan

Reads are streamed and never hashed, so they are cheap at any size, give or take the one signature recovery that verifying a read token costs. Writes hash the whole payload before they can verify it, so their CPU cost is linear in payload size, and that is what decides which plan a deployment can run on. Workers Free allows 10 ms of CPU per request and 1,000 KV writes per day across all keys. Set `MAX_PAYLOAD_BYTES` accordingly: the 10 MiB default assumes a paid plan.

## Secrets

None. waxdb has no admin path and no shared secret: deletion is an owner-signed tombstone like any other write (DECISIONS.md #7). If you ever need to clear a record out of band, overwrite it rather than deleting the key, so the counter high-water mark survives and old signatures stay below it.

## Tests

`pnpm test` runs the shared contract on real workerd against a miniflare-backed KV namespace, isolated per test and never touching the remote namespace. Because the binding is reachable from the tests, the storage-layout assertions run here, which is what proves the adapter writes the bytes the spec says it does.

The `nodejs_compat` flag needed by `@cloudflare/vitest-pool-workers` lives in `vitest.config.ts` rather than in `wrangler.toml`, so the deployed runtime is not silently given flags the tests need.
