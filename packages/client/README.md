# @waxdb/client

The client for [waxdb](../../README.md): an authenticated key-value store for ethereum addresses.

**MIT, unlike the rest of this repository, which is AGPL-3.0-only.** A client library that cannot be embedded freely is not much of a client library. See [DECISIONS.md #20](../../DECISIONS.md).

```bash
npm i @waxdb/client
```

## Using it

```ts
import {WaxdbClient} from '@waxdb/client';
import {Wallet} from 'ethers';

const client = new WaxdbClient({
	endpoint: 'https://waxdb.example.workers.dev',
	namespace: 'my.app',
	signer: wallet, // anything with signMessage(string)
});

await client.put(new TextEncoder().encode('hello'));

const read = await client.get();
if (read.found && !read.notModified) {
	console.log(new TextDecoder().decode(read.payload));
}
```

The signer is anything exposing `signMessage(message: string)`. An ethers `Wallet` or `Signer` works as-is, and so does a local key or a session key. Nothing here needs a wallet prompt: a write happens on every debounced sync, so the signer is expected to be a key the app holds.

## The shapes are the point

The result types refuse to collapse distinctions the protocol makes deliberately.

**Absence is not an error.** `get()` returns `{found: false}` rather than throwing. On a deployment with authenticated reads it also returns `{found: false}` for a token that was wrong, expired or missing, because the server makes those indistinguishable: telling them apart would confirm that a record exists, which is exactly what the token protects.

**A tombstone is not absence.** A deleted record still arrives as `{found: true, deleted: true}` with an empty payload, because it has a real counter that the caller needs in order to write again.

**A rejected write is not a failure.** `put()` and `delete()` return `{ok: false, error, current}` for the two conflicts, since two devices disagreeing is the normal case in a sync protocol and `current` is what lets you converge without another round trip. Everything else throws a `WaxdbError`.

```ts
const written = await client.put(payload, {counter, expected: 'none'});
if (!written.ok) {
	// written.error.code is 'counter_not_increasing' | 'precondition_failed'
	// written.current tells you what to merge against
}
```

## Counters

`counter` defaults to `Date.now()`. It must strictly exceed the stored counter, and must not exceed the server's clock by more than 60 seconds. A millisecond timestamp and a plain `stored + 1` both satisfy the rules and interoperate, so the choice is yours.

Non-canonical counters are rejected **here**, before signing, rather than by the server. A counter of `"0123"` would otherwise be signed into the message and come back as `signature_mismatch`, which tells you nothing about what you actually did wrong.

## Polling cheaply

```ts
const meta = await client.head(); // metadata, no payload transfer
if (meta.found && meta.counter !== lastSeen) {
	const read = await client.get({ifNoneMatch: lastSeen});
}
```

`get({ifNoneMatch})` returns `{found: true, notModified: true}` with no body when nothing changed.

## Rate limits

The store allows one write per second to a single key, and every record is one key. The client retries a `429` with exponential backoff (`retry: {attempts, baseDelayMs}`), but the real fix is a debounce comfortably above one second. `WaxdbRateLimitError` is thrown only once the retries are exhausted.

## Compression

Compress **before** encrypting, never after. With one encrypted payload there is no such thing as a delta, so every change re-uploads everything, and compression is the only lever that makes that cheap. Compressing ciphertext achieves nothing.

## Secure contexts

The payload hash is SHA-256 via `crypto.subtle`, which is **undefined in a browser outside a secure context** (plain `http://` on anything but localhost). Serve over https, or pass your own:

```ts
new WaxdbClient({...options, sha256: async (bytes) => '0x…'});
```

## Why this duplicates the server

`src/protocol.ts` implements the wire format again rather than importing `@waxdb/server`, for two reasons that happen to point the same way.

The licence forbids it: importing AGPL code into an MIT package would push the AGPL onto every consumer.

And an independent implementation is the only kind that can catch an encoding bug. If both sides built messages with the same function, an error in it would cancel out and every test would pass while nothing interoperated. [`vectors.json`](../../vectors.json) is what holds the two implementations to the same answer, and `test/vectors.test.ts` is where that is checked on every run. `test/licensing.test.ts` fails the build if anything under `src/` ever imports the server.
