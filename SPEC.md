# waxdb protocol

Normative. Every rule here is checkable, and the ones that look fussy are load-bearing: the reasons live in [DECISIONS.md](DECISIONS.md).

There is one format and no version field. The reasoning is DECISIONS.md #6, and the short version is that the message text already separates this format from any other, and the namespace already partitions data, so a version number would be insurance against a change nobody can specify.

waxdb stores one record per `(namespace, owner)`. A record is an opaque **payload of bytes** plus the signature that authorises it. Reads are public. Writes carry a secp256k1 signature over a message that binds every field of the write, and a counter that must increase. The server verifies and stores; it never interprets what it stores.

**The device is the source of truth and the server is a cache.** Nothing here lets a record be recovered, migrated or re-signed by the server, because only the key holder can produce a signature. Every decision below assumes a client that can rebuild its state from local storage.

**The payload is bytes, not text.** It travels as the raw body of a request and the raw body of a response, never wrapped in JSON. Clients typically send compressed ciphertext, and base64-ing that into a JSON string would cost a third of every byte on the wire and in storage, for nothing.

## Terms

| term | meaning |
| --- | --- |
| `owner` | the ethereum address whose key authorises writes, and whose record this is |
| `namespace` | an opaque client-chosen partition. The server stores it and never parses it |
| `counter` | an unsigned integer that must strictly increase per record |
| `payload` | opaque bytes. May be ciphertext, compressed JSON, anything, including empty |

## Field forms

Every one of these is a rejection rule, never a normalisation rule. A value that is not already canonical is an error, so no client can sign one thing and store another.

| field | form |
| --- | --- |
| `namespace` | `[a-z0-9._-]{1,256}`, not `.` or `..`, not starting with `.` |
| `owner` | `0x` followed by 40 lowercase hex characters |
| `counter` | `0` or `[1-9][0-9]*`. No leading zeros, no hex, no exponent |
| `expected` | `any`, `none`, or a `counter` |
| `payloadHash` | `0x` followed by 64 lowercase hex characters, `keccak256` of the payload bytes |
| `signature` | `0x` followed by 130 hex characters |

The `owner` may be sent in any case in a URL and is lowercased before use. The signed message always uses the lowercase form, so a client that signs a checksummed spelling fails verification rather than writing something it did not intend.

The `namespace` charset is deliberately narrow, and every restriction in it is paying for something:

- **ASCII**, so the byte length of the signed message equals its character count, which makes the classic EIP-191 length-prefix bug structurally impossible rather than merely documented.
- **No `/`**, so the storage key splits into exactly two segments and decomposes uniquely.
- **URL-path-safe**, so a namespace never needs percent-encoding in a request.
- **Lowercase only.** Every segment of the key is then lowercase, since `owner` already is. Without this, a case-sensitive store and a case-insensitive filesystem would disagree about whether `Conquest` and `conquest` are one record or two, and no amount of documentation would stop a human making the same mistake.
- **No `:`**, which is illegal in filenames on Windows. It was in the predecessor's namespaces (`conquest-0xABC:0x8629…`) and nothing in waxdb depends on it. Use `.`, `-` or `_`.
- **Never `.` or `..`, and never leading `.`**, which are path traversal in any file-backed store. Cloudflare KV has the same rule for its own keys.

Together these make every key a valid, unambiguous path on every filesystem as well as a valid KV key, which is what lets a local backend store a payload as an ordinary file.

## Storage

```
key      = `${namespace}/${owner}`
value    = the payload bytes, verbatim
metadata = {"counter": "…", "signature": "0x…", "deleted": false}
```

Because `/` appears in no field, the key is exactly two `/`-separated segments and decomposes uniquely. Maximum key length is 256 + 1 + 42 = 299 bytes, inside Cloudflare KV's 512-byte limit. The metadata serialises to about 200 bytes, inside KV's 1024-byte limit.

The value is the payload and nothing else: no envelope, no encoding, no escaping. `namespace` and `owner` live in the key and `counter` and `signature` live in the metadata, so a record is fully described by a key-and-metadata listing without reading a single value.

A **tombstone** is a record with an empty value and `deleted: true`. It carries a real counter and a real signature, which is what distinguishes it from both absence and from a live record whose payload happens to be empty.

### The storage seam

The core reaches storage through one interface, and every platform supplies it. It is asymmetric because the protocol is:

```ts
type Meta = {counter: string; signature: string; deleted: boolean};

interface Storage {
  head(key: string): Promise<Meta | null>;
  get(key: string): Promise<(Meta & {payload: ReadableStream}) | null>;
  put(key: string, payload: Uint8Array, meta: Meta): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Reads hand back a stream because nothing inspects them. Writes take bytes because verification has to see every one of them before anything is stored. `ReadableStream` is a web standard available in Workers and in Node, so this does not put a platform API in the core.

**`head` is not an optimisation, it is a rule: the write path must never read the payload.** It needs the counter and the deleted flag to check monotonicity and the precondition, and fetching a multi-megabyte value to compare a number, on every single write, is the difference between a cheap check and a transfer. The `HEAD` verb uses the same call.

How each platform satisfies it:

| | Cloudflare | Node |
| --- | --- | --- |
| `head` | `list({prefix: key, limit: 1})`, metadata without values | read the sidecar |
| `get` | `getWithMetadata(key, {type: "stream"})` | `createReadStream` plus the sidecar |
| `put` | `put(key, bytes, {metadata})` | write the payload file, then the sidecar |

The Node backend stores a record as two ordinary files, the payload verbatim and a small JSON sidecar, at a path that mirrors the key. The charset rules above are what make that path safe on every filesystem, and what let the payload stay raw bytes rather than base64 inside an envelope.

## The signed message

Store:

```
waxdb store
Namespace: <namespace>
Owner: <owner>
Counter: <counter>
Expected: <expected>
Data: <payloadHash>
```

Delete:

```
waxdb delete
Namespace: <namespace>
Owner: <owner>
Counter: <counter>
Expected: <expected>
```

Lines are joined with `\n` and there is no trailing newline.

**Why this cannot be re-split.** The line count is fixed (six for a store, five for a delete), the labels are fixed, and no field can contain a newline because every charset excludes one. The message therefore determines exactly one tuple, and there is no second `(namespace, counter, payload)` producing the same bytes. This is the reason waxdb exists as a separate protocol: the predecessor joined its fields with `:` and a payload containing an ISO-8601 timestamp could be re-read as a different namespace.

The two headers give the two intents different bytes, so a store signature can never be replayed as a delete. The `waxdb` header is also what separates this format from any other that might ever sign with the same key: change the format and that line and its labels change with it, so signatures cannot cross over. That is the job a version field would otherwise be doing, done by bytes that have to exist anyway.

The message binds a **hash of the payload bytes** and says nothing about how those bytes were transported. A future transport is therefore an extension, not a new signing scheme.

## Digest and verification

EIP-191 `personal_sign`:

```
digest = keccak256(0x19 || "Ethereum Signed Message:\n" || byteLength(message) || message)
```

`byteLength` is the UTF-8 byte length in decimal ASCII. The message is ASCII by construction so this equals the character count, but implementations should still compute bytes so the invariant survives any future charset change.

The signer is recovered from the digest and the signature and must equal `owner`, compared case-insensitively.

Signature malleability is not rejected. `(r, s, v)` and `(r, -s, v')` recover the same address for the same message, so both authorise the same write, and the record keeps whichever form was submitted.

## Counter rules

1. If no record exists, any `counter` is acceptable, including `0`.
2. If a record exists, `counter` must be strictly greater than the stored one. A tombstone is a record, so a delete raises the bar for everything after it.
3. `counter` must not exceed the server's clock, in milliseconds, plus **T = 60000**.

Rule 3 has two meanings and they are the same number:

- a device may be up to 60 seconds ahead of the server and still write
- a device with a fast clock can make its siblings unwritable for at most 60 seconds

The rule keeps counters comparable across devices that have never talked to each other, which is what makes "the larger counter is the later write" true for a whole-payload last-writer-wins sync, and it turns a client that writes an absurd counter into a bounded outage rather than a permanently bricked record.

The counter's *meaning* is a client convention. A millisecond timestamp and a plain `stored + 1` both satisfy these rules and interoperate.

## Preconditions

`Expected` is part of the signed message, so it cannot be stripped in transit.

| value | meaning |
| --- | --- |
| `any` | no precondition |
| `none` | the write applies only if no record exists |
| `<counter>` | the write applies only if the stored counter is exactly this |

`none` is what stops two devices' first pushes from silently clobbering each other, which is the one moment where neither has anything to merge from.

**This detects staleness, not races.** The check is a read followed by a write with no atomicity between them, so two writes inside the same window can both pass, and on a stale read the write is accepted exactly as `any` would have been. It is never worse than omitting it, and it converts the common case, a client pushing on top of a ten-minute-old pull, from a silent overwrite into a reported conflict.

## HTTP API

All requests and responses carry:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,HEAD,PUT,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type,If-None-Match,Waxdb-Counter,Waxdb-Expected,Waxdb-Signature,Waxdb-Data-Hash
Access-Control-Expose-Headers: ETag,Waxdb-Counter,Waxdb-Signature,Waxdb-Data-Hash,Waxdb-Deleted,Waxdb-Server-Time
Access-Control-Max-Age: 86400
```

`Expose-Headers` is not optional: without it, browser JavaScript cannot read a single one of the response headers below, which is where the entire record lives.

### Read

```
GET  /records/{namespace}/{owner}
GET  /records/{namespace}/{owner}?since=<counter>
HEAD /records/{namespace}/{owner}
```

`200` with the **payload as the body**, `Content-Type: application/octet-stream`, and:

```
ETag: "<counter>"
Cache-Control: no-cache
Waxdb-Counter: <counter>
Waxdb-Signature: 0x…
Waxdb-Data-Hash: 0x…
Waxdb-Deleted: false
```

A tombstone is also `200`, with an empty body and `Waxdb-Deleted: true`. It is a record, not a failure, and a client needs its counter to write again, so it must arrive through ordinary success-path code. `410 Gone` was considered and rejected for that reason.

Absence is `404` with `Content-Type: application/json` and the body `{"found": false}`. There is no `error` field: absence is an answer, not a failure. The status code is forced by the body being the payload, which leaves nowhere else to say it.

`If-None-Match` with a matching ETag returns `304` and no body. `?since=<counter>` is the same conditional as a query parameter, answering `304` when the stored counter is less than or equal to it, and it exists because `If-None-Match` is not a CORS-safelisted request header, so the idiomatic form costs a preflight on every poll and this one does not.

`HEAD` returns the headers with no body, which is the cheap way to poll for a counter change before deciding to transfer a payload. An implementation should answer it from a key listing rather than by reading the value, so a multi-megabyte record costs nothing to check.

**Reads stream.** The server pipes the stored value straight to the response and never buffers it, so read size is bounded only by the store.

### Write

```
PUT /records/{namespace}/{owner}
Content-Type: application/octet-stream
Waxdb-Counter: <counter>
Waxdb-Expected: any | none | <counter>
Waxdb-Data-Hash: 0x…
Waxdb-Signature: 0x…

<payload bytes>
```

```
DELETE /records/{namespace}/{owner}
Waxdb-Counter: <counter>
Waxdb-Expected: any | none | <counter>
Waxdb-Signature: 0x…
```

The verb is the intent, and it must match the intent in the signed message: `PUT` verifies against the `store` message, `DELETE` against the `delete` one.

`Waxdb-Data-Hash` is required on `PUT` and is not what the server hashes. The server computes the hash from the body it received and builds the signed message from *that*; the header exists so a truncated or corrupted upload is reported as `data_hash_mismatch` rather than as a misleading `signature_mismatch`.

**Writes buffer, and cannot stream.** Verification has to precede the write and the payload hash is only known once the body is consumed, so the server holds the payload once, hashes it, verifies, checks the counter and the precondition, and only then stores. This is why writes have a size cap and reads do not.

`200` on success and `409` on a rejected write, both with `Content-Type: application/json`:

```json
{"ok": true,  "counter": "…", "deleted": false}
```

```json
{"ok": false, "error": {"code": "counter_not_increasing", "message": "…"},
 "current": {"found": true, "counter": "…", "deleted": false}}
```

`current` describes the record that blocked the write, or `{"found": false}`, so a client can converge without a second round trip. A response never carries both a success result and an error.

## Errors

Every non-2xx response except `304` and the `404` above has `Content-Type: application/json` and the body:

```json
{"ok": false, "error": {"code": "…", "message": "…"}}
```

| status | code | |
| --- | --- | --- |
| 400 | `invalid_namespace` | charset or length |
| 400 | `invalid_owner` | not a 20-byte hex address |
| 400 | `invalid_counter` | missing or not canonical decimal |
| 400 | `invalid_expected` | not `any`, `none` or canonical decimal |
| 400 | `invalid_signature_format` | not 65 bytes of hex |
| 400 | `invalid_data_hash` | missing or malformed on a `PUT` |
| 400 | `data_hash_mismatch` | the body does not hash to `Waxdb-Data-Hash`. Usually a truncated upload |
| 400 | `counter_in_future` | above the ceiling. Carries `Waxdb-Server-Time` so a client can measure its own skew |
| 401 | `signature_mismatch` | recovered signer is not `owner` |
| 405 | `method_not_allowed` | anything outside the verbs above |
| 409 | `counter_not_increasing` | with `current` |
| 409 | `precondition_failed` | `expected` did not match, with `current` |
| 413 | `payload_too_large` | above the deployment's cap |
| 429 | `rate_limited` | the store refused the write rate. See below |
| 500 | `storage_error` | anything else |

Messages are written for a human reading a log. No engine text, no stack traces, no parser exception reaching a client.

### `rate_limited` is a real path, not a theoretical one

Cloudflare KV allows **one write per second to the same key** on every plan, and a write inside that window throws `KV PUT failed: 429 Too Many Requests`. Every record for one `(namespace, owner)` is one key by construction, so a sync client's debounce is directly exposed to it.

The server must map that exception to `rate_limited` rather than letting it become `storage_error`. Clients must retry with exponential backoff, and should keep their debounce comfortably above one second rather than relying on the retry.

## Limits

| | |
| --- | --- |
| `namespace` | 256 bytes |
| payload on write | deployment policy, default 10 MiB. Not a protocol constant |
| payload on read | unbounded, streamed |
| stored value | 25 MiB, platform limit, applies to the payload directly |
| storage key | 512 bytes, platform limit, never reachable given the above |
| writes to one key | 1 per second, platform limit, surfaced as `rate_limited` |

The write cap is **configuration, not protocol**: a deployment reads it from the environment, and the offline CLI may differ from the public one. Raising a cap is always safe; lowering one breaks whatever client is already over it. Freezing a number into the wire format would mean the only way to raise it is a new format, and there is no version mechanism to make that cheap.

Because the payload is stored verbatim, the platform's 25 MiB value limit applies to it directly, with no JSON escaping able to inflate a compliant payload into a non-compliant record.

The default of 10 MiB is set by the Worker rather than the store. A write holds the payload once while hashing and verifying it, so memory is roughly one to two times the payload against a 128 MB isolate shared across the concurrent requests it is serving.

**CPU is what decides which plan a deployment can run on**, and it applies to writes only. A read is streamed and never hashed, so reads are cheap at any size on any plan. A write must hash the whole payload before it can verify anything, so its cost is linear in payload size:

| | Workers Free | Workers Paid |
| --- | --- | --- |
| CPU per request | 10 ms | 30 s default |
| KV writes | 1,000/day, all keys | unlimited |
| requests | 100,000/day | unlimited |

A free-tier deployment should therefore set a much lower cap than the default, sized by measurement rather than by hope, and should expect the daily write ceiling to bind before the CPU one for anything with real users. Everything else in this specification behaves identically on both plans.

Clients should compress before encrypting, which typically shrinks account-style JSON several-fold and is the only lever that makes a whole-payload sync cheap. Compressing after encryption does nothing.

## Cross-implementation vectors

The message encoding is the only thing keeping a client and the server in agreement, and it has no external standard to fall back on. `vectors.json` pins `(inputs → message → digest)` and is exercised by the server tests and by every client implementation. A change to the encoding that does not update the vectors in the same commit will surface only as `signature_mismatch` in production.

## Deferred, by design and without a break

- **Delegated writes**, where the signer is a session key and `owner` is a user account. Non-breaking because `Owner` is already in the signed message: only the authorisation rule changes, and the delegation proof rides as an unsigned header.
- **EIP-712 signing**, if a third-party wallet should ever auto-sign writes scoped to an origin. That is a different message format, so it is a different service or a namespace the client moves to, at a cost known in advance: a client-side re-push.
- **Streaming writes**, which need a content-addressed two-phase design (upload a blob under its own hash, then point a small signed record at it). That also brings deduplication and orphan collection. Additive: a new endpoint, no change to the message.
- **Per-item records** instead of one payload, using `scope`-style namespaces such as `app.ops-<id>`. Already possible with no protocol change. It trades away the consistent snapshot and leaks item count and sizes to the server.
- **Compare-and-swap.** A `Storage` seam change rather than a wire change.
- **Rate limiting and quotas** beyond the platform's own. Platform-layer concerns, outside the core.

## Open

- **Which hash covers the payload.** See the note below: it is the one remaining decision that changes the signed message.

## Under review: the payload hash

`Data:` currently carries `keccak256` of the payload, which matches the EIP-191 digest and needs no second primitive. It is also the slowest option available in a Worker by a wide margin, since keccak has no native implementation there and runs in JavaScript or WebAssembly at tens of megabytes per second, while `crypto.subtle.digest("SHA-256", …)` is native and roughly an order of magnitude faster.

That difference is the difference between a 10 MiB write costing hundreds of milliseconds of billed CPU and costing tens, and between a free-tier deployment handling a megabyte and handling almost nothing. Clients benefit identically, since WebCrypto is native in browsers and in Node.

The cost is a second hash function in one protocol: keccak for the EIP-191 message digest, which is a few hundred bytes and therefore free, and SHA-256 for the payload, which is the only part that scales. This must be settled before any signature exists, and needs measurement rather than the estimates above.
