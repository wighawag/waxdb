# Behavioural contract

These tests exist for one reason: this service is depended on by live apps, and it was rewritten on top of the `template-agnostic-server` layout. Everything the pre-rewrite implementation did, including its quirks, was pinned here **first**, and the rewrite then had to satisfy it unchanged. The same suite now guards every platform.

## Layout

- `contract/contract.ts` is the contract itself: one `runContractTests(harness)` function containing every assertion. It is transport-agnostic, so the same suite runs against any implementation.
- `contract/memory-storage.ts` is an in-memory `Storage`, doubling as the reference for what a platform adapter must do.
- `contract/rpc.ts` builds signed JSON-RPC requests and computes storage keys. It deliberately re-implements the key layout rather than importing it, so a bug in the real one cannot hide.
- `server.contract.test.ts` runs the contract in-process against `createServer`, twice: with and without `TOKEN_ADMIN`.
- `../../../platforms/cf-worker/test/worker.contract.test.ts` runs it on real workerd against a real (miniflare-backed) KV binding, so the storage-byte assertions run there too.
- `../../../platforms/nodejs/test/nodejs.contract.test.ts` runs it over polystore, both in memory and against a JSON file on disk.
- `live.conformance.test.ts` runs the contract against a deployed instance. Opt-in, and it **writes** to that instance (random addresses, unique namespaces).

## Running

```bash
pnpm test          # from the repo root: every platform
pnpm test:watch
LIVE_URL=https://secp256k1-kv-db.rim.workers.dev LIVE_RESET=true pnpm test:live
```

`LIVE_RESET=true` additionally asserts that the deployment implements the `reset` method (see below).

## Storage compatibility (the part that must not break)

The live KV already contains 2594 records written over several years. Every one of them matches the layout below, verified by listing the whole namespace. The contract pins it:

- key: `` `${namespace}_${address.toLowerCase()}` `` (no separator prefix when the namespace is empty, though an empty namespace is rejected upstream by validation)
- value: `JSON.stringify({data, counter, signature})`, with `counter` as a decimal string
- reads are a raw `JSON.parse` passthrough: records written before April 2021 have **no** `signature` field and are returned without one, and any unknown field is returned untouched
- a missing key reads back as `{data: '', counter: '0', signature: ''}`

## Quirks that are part of the contract

These look like bugs. They are also observable behaviour, so the rewrite must reproduce them unless a deliberate decision says otherwise.

1. Validation errors reach the client as **strings** shaped `"Error: <message>" + usage hint`, because the error is interpolated into a template literal. But errors raised without a usage hint (storage failures, and every `reset` validation error) are `JSON.stringify`'d as raw `Error` objects, which yields `{}`.
2. The `wallet_getString` usage hint is missing its closing brace: `{"method":"wallet_getString", "params":["<address>","<namespace>"]`.
3. `BigInt()` failures leak the raw engine `SyntaxError` message to the client.
4. The counter is normalised through `BigInt`, so a counter of `"0123"` is verified against the message `put:<ns>:123:<data>` and stored as `"123"`.
5. Counter `0` can never be written: the empty record's counter is `"0"` and the check is `counter <= current`.
6. The "older/same counter" rejection returns **both** a `result` (`{success: false, currentData}`) and an `error` string.
7. Response key order is `jsonrpc, id, result, error`, `error` is omitted entirely on success, and `id` is omitted when the request had none. Byte-exact tests pin this.
8. Non-POST/OPTIONS requests get `please use jsonrpc POST request` as `text/plain` with **no** CORS headers; malformed JSON gets a 400 whose body is the raw parser error text.
9. `Content-Type` is never checked.

10. The service ignores the request path and the query string entirely, so clients may post to any URL on the host.

## History

The deployment was, for a while, older than this repo: it answered `"reset" not supported`, predating commit `b7b11d5`. That gap was closed by redeploying before the rewrite started, so the contract, `master` and production now describe the same service. Set `LIVE_RESET=true` when running against a deployment that has the `reset` method.
