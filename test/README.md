# Behavioural contract

These tests exist for one reason: this service is depended on by live apps, and it is about to be rewritten on top of `template-agnostic-server`. Everything the current implementation does, including its quirks, is pinned here **first**, so the rewrite can be proven identical rather than assumed identical.

## Layout

- `support/contract.ts` is the contract itself: one `runContractTests(harness)` function containing every assertion. It is transport-agnostic, so the same suite runs against any implementation.
- `support/memory-kv.ts` is an in-memory stand-in for the `KVNamespace` subset the handler uses.
- `support/rpc.ts` builds signed JSON-RPC requests and computes storage keys.
- `handler.contract.test.ts` runs the contract in-process against `src/handler.ts` with an in-memory KV, twice: with and without `TOKEN_ADMIN`. Because the KV is visible, this is the layer that pins the **exact bytes written to storage**.
- `worker.contract.test.ts` runs the same contract on workerd via `wrangler unstable_dev`, pinning runtime-level details (status codes, header values, the body the Workers runtime produces for a `Response` built from an `Error`). Storage-level cases are skipped here, since the dev worker's KV is not reachable from the test.
- `live.conformance.test.ts` runs the contract against a deployed instance. Opt-in, and it **writes** to that instance (random addresses, unique namespaces).
- `handler.test.ts` is the original smoke test, kept as-is.

## Running

```bash
pnpm test          # in-process + workerd contract
pnpm test:watch
LIVE_URL=https://secp256k1-kv-db.rim.workers.dev pnpm test:live
```

`LIVE_RESET=true` additionally asserts that the deployment implements the `reset` method (see below).

## Storage compatibility (the part that must not break)

The live KV already contains records written over several years. The contract pins the format:

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

## Known divergence: HEAD vs the live deployment

Read-only probes against `https://secp256k1-kv-db.rim.workers.dev/` match this contract byte-for-byte, with one exception: the live worker answers `"reset" not supported`, i.e. it predates commit `b7b11d5` ("add reset capabilities"). The live deployment is therefore **older than this repo's HEAD**, which matters when deciding what "same behaviour after redeploy" means for the `reset` method.
