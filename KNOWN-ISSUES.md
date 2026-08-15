# Known issues

Everything here is *current, deployed behaviour*, pinned by the contract in `packages/server/test/contract/`. That is deliberate: live apps depend on these responses, so the tests encode what the service does, not what it should do. Fixing anything below therefore means changing a test on purpose, and thinking about clients that already rely on the old behaviour.

Ordered by how much they matter, not by how hard they are.

---

## 1. `reset` lets old writes be replayed

`src/api/jsonrpc.ts`, still carrying the original `// TODO fix replayability, use counter`.

`reset` deletes the record outright. The counter goes back to `0`, and the counter is the *only* thing stopping a replay: a write is accepted when `counter > storedCounter`.

Signatures are public. `wallet_getString` returns the `signature` alongside the data, so anyone can harvest a valid `(namespace, counter, data, signature)` tuple for any address, keep it, and re-submit it after a reset. The service will accept it, because from its point of view the counter went from `0` to something larger. Stale data comes back, attributed to the owner's address, without the owner doing anything.

**Fix**: do not delete. Write a tombstone that keeps the counter high-water mark:

```ts
{data: '', counter: <the counter at reset time>, signature: ''}
```

Reads still report an empty record, and every old signature stays below the mark, so replay dies. The visible change is that a reset record reports its real counter instead of `"0"`, which the contract currently asserts, so that assertion has to move with the fix.

**Also worth doing while in there**: `request.headers.get('TOKEN') === env.TOKEN_ADMIN` is a non-constant-time comparison, and the admin token authorises deleting *anyone's* record with no signature from the owner and no audit trail. A signed admin request (`reset:<namespace>:<address>:<counter>` with its own monotonic counter) would fix both the replay and the audit problem at once.

**Status**: `TOKEN_ADMIN` is unset in production, so `reset` currently answers `not admin` and none of this is reachable. It becomes real the moment the secret is set.

---

## 2. The signed message is ambiguously encoded

The message is built by concatenation, with no escaping and no lengths:

```
put:${namespace}:${counter}:${data}
```

The server *constructs* this string, it never parses it, so nothing forces a client's `(namespace, counter, data)` to be the only triple that produces a given message. When `data` contains a colon preceded by a run of digits, the same signature is valid for a different namespace:

```
message : put:app-ns:1786793052791:12345:the victim blob
intended: ns="app-ns"                counter=1786793052791  data="12345:the victim blob"
also    : ns="app-ns:1786793052791"  counter=12345          data="the victim blob"
```

Both reconstruct the identical string, so one signature authorises both writes. The second namespace is fresh, so its stored counter is `0` and the low counter `12345` sails through. Verified against the current implementation: the attack write returns `success: true`.

An attacker can therefore copy a user's data into namespaces derived from the user's own, signed by the user's address, without the key. It is a spoofing and spam vector rather than a way to corrupt existing records, since the target namespace differs from the original.

**Current exposure is nil, and that is luck rather than design.** The counter segment must re-parse as a normalised decimal (`BigInt(c).toString() === c`), which rules out the colons that appear in real namespaces (`conquest-0xABC:0x8629…`, since `0x8629…` normalises to decimal and stops matching). I scanned 20 live records for alternative valid splits and found zero, and none of their `data` values contains a colon at all. So today's data is fine, and the day an app stores `"<timestamp>:<payload>"` it is not.

**Fix**: a message encoding that cannot be re-split, e.g. length-prefixed fields, a hash of the fields, or EIP-712 typed data (which also gives wallets something readable to show). Any of these changes every signature, so it needs a new method name (`wallet_putString2`) with the old one accepted during migration, or a version marker in the params.

---

## 3. Errors reach clients in two different shapes

`wrapRequest` puts the thrown value straight into the JSON-RPC `error` field. What the client sees depends on whether the call site passed a usage hint:

- **with** a hint, the `Error` is interpolated into a template literal, so it arrives as the string `"Error: invalid address length\n{...usage...}"`
- **without** one (storage failures, and *every* `reset` validation error), `JSON.stringify(new Error(...))` produces `{}`, an empty object with no message at all

So a client cannot tell a corrupt record from a validation failure, and half the errors are unreadable. Raw engine messages leak too: an unparseable counter returns the V8 `SyntaxError` text verbatim.

**Fix**: normalise to `{code, message}`. It is a breaking change for anything currently string-matching on the error text, which is exactly why it is written down here rather than done.

---

## 4. The `wallet_getString` usage hint is missing its closing brace

```
{"method":"wallet_getString", "params":["<address>","<namespace>"]
```

Trivially wrong, harmless, and pinned by the contract because it is what production emits. Fix it whenever error shapes are touched anyway (see 3).

---

## 5. Counters are normalised through `BigInt`, silently

`BigInt("0123")` is `123n`, and `BigInt("0x10")` is `16n`. The server verifies the signature against the *normalised* decimal, so `"0123"` is signed and stored as `"123"`. A client that pads or hex-encodes its counter gets a confusing `invalid signature`, and a client that sends `"1e9"` gets a raw `SyntaxError`.

**Fix**: reject anything that is not already `/^[0-9]+$/`.

---

## 6. Counter `0` can never be written

The empty record reports `counter: "0"` and the check is `counter <= stored`, so the first write must use a counter of at least `1`. Harmless in practice (counters are millisecond timestamps) but it means "no record" and "record at counter 0" are indistinguishable, which is the same conflation that makes issue 1 possible.

---

## 7. A rejected write returns both a result and an error

Writing with an older or equal counter returns `result: {success: false, currentData}` *and* `error: "cannot override with older/same counter"`. JSON-RPC says one or the other. Clients checking `error` first and clients checking `result.success` first both work today, so any change here breaks one of them.

---

## 8. No size limit, no rate limit, no read authentication

Reads are public by design, but writes have no ceiling. The largest live record is 74 kB, and Cloudflare KV would accept up to 25 MB per value. Anyone with any key pair can create unlimited namespaces (see also issue 2). There is no per-address quota and no rate limiting.

**Fix**: a maximum `data` length is the cheap 90% of it, and it is a genuinely breaking change if any client is already over the chosen limit, so measure the live distribution before picking a number.

---

## 9. `TOKEN` is a bare shared secret

No expiry, no rotation story, no per-operation scoping, sent as a plain header on every admin call. Fine while unset. See issue 1 for the signed-request alternative.

---

## Storage-format constraints (not issues, but do not break them)

The live namespace holds 2594 records written since 2021. These are frozen, and `packages/server/src/record.ts` is the only place that should know about them:

- key `` `${namespace}_${address.toLowerCase()}` ``
- value `JSON.stringify({data, counter, signature})`, field order included
- `counter` is a decimal string
- reads are a raw `JSON.parse` passthrough: records written before April 2021 have no `signature` field and must come back without one, and unknown fields must survive a round trip

This is why the Cloudflare adapter talks to KV directly instead of going through polystore, which would wrap every value as `{expires, value}`.
