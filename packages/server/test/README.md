# The contract

One suite, run against every implementation. That is the point of the `getStorage` / `getEnv` seam: if the core held a platform API there could be no such suite, and "the CLI is not a mock" would be a claim rather than a check.

## Layout

- `contract/contract.ts` is the contract: one `runContractTests(harness)` containing every assertion, transport-agnostic.
- `contract/harness.ts` is the shape an implementation has to present: a `fetch`, whether it runs with `PUBLIC_READS`, and its write cap.
- `contract/client.ts` is a minimal waxdb client. It **re-implements the signed message rather than importing it**, and signs with ethers rather than `@noble/curves`, so the two sides of every assertion share no code. If the tests built their messages with `src/protocol/message.ts`, a bug in that file would cancel out and the suite would pass while every real client failed.
- `contract/memory-storage.ts` is an in-memory `Storage`, doubling as the reference for what an adapter must do.
- `protocol.test.ts` covers the field rules at the unit level, including the ones that are **not reachable over HTTP** but still load-bearing.
- `vectors.test.ts` checks the repo-root `vectors.json`.
- `live.conformance.test.ts` runs the contract against a deployment. Opt-in, and it writes.

Who runs it:

| harness                                            | what it proves                               |
| -------------------------------------------------- | -------------------------------------------- |
| `server.contract.test.ts`                          | the core, in-process over an in-memory store |
| `platforms/cf-worker/test/worker.contract.test.ts` | the KV adapter, on real workerd              |
| `platforms/nodejs/test/nodejs.contract.test.ts`    | both Node backends                           |
| `platforms/nodejs/test/cli.smoke.test.ts`          | the built CLI, and survival across a restart |

Each runs twice, once with authenticated reads and once with `PUBLIC_READS`, because they are different code paths and the default is the one that ships.

## Running

```bash
pnpm test                 # from the repo root: every harness
pnpm --filter @waxdb/server run vectors    # regenerate vectors.json

LIVE_URL=https://… pnpm test:live
```

## Things the suite pins that are easy to break

- **The signature is verified before storage is consulted.** A bad signature against an existing record and against an absent one must produce byte-identical responses, or the write path leaks existence that the read path refuses to reveal.
- **A wrong, expired, absent or wrongly-scoped read token answers `404` with `{"found": false}`**, identical to absence. Only a _malformed_ token gets a `400`, because that is decided before any storage lookup. Never `401`.
- **Canonical forms are rejected, never normalised.** `0123` is an error.
- **`head` never reads the payload**, so checking a counter never transfers a record.
- **`Access-Control-Expose-Headers` lists every `Waxdb-*` header plus `ETag`**, or browser JavaScript can read none of them.
- **A tombstone is a `200`**, with an empty body and no `Waxdb-Data-Hash`, and it raises the counter high-water mark.
- **Payloads round trip byte for byte**, including all 256 byte values and an empty payload.

## Two facts about the transport, pinned deliberately

Both look like missing validation and are neither.

- **The URL layer eats `.` and `..`**, percent-encoded or not, before a request is made. So those namespaces answer `404 not_found` rather than `400 invalid_namespace`: they never reach the handler. The rule that rejects them protects the _storage key_, and is unit-tested in `protocol.test.ts` where the directory backend actually depends on it.
- **HTTP trims whitespace around header values**, so a counter of `" 5"` arrives as `"5"` and gets as far as signature verification. That is the transport normalising, not the server. Pinned so nobody later "fixes" it by trimming in the handler, which would be the normalisation the protocol forbids.
