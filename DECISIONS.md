# Decisions

Why [SPEC.md](SPEC.md) is shaped the way it is. Each entry records what was decided, what it closes from the predecessor's `KNOWN-ISSUES.md`, and what it costs, because a decision with no cost written down is usually one that was not made.

The `KNOWN-ISSUES.md` referred to throughout is the predecessor's, catalogued at [etherplay/secp256k1-db](https://github.com/etherplay/secp256k1-db). It documented the deployed behaviour of that service, quirks included, and it stays there with the service it describes.

waxdb began as a fork of `etherplay/secp256k1-db`, which is why the history predates this file. That service is frozen, still running, and still serving its existing apps. See [The frozen predecessor](#the-frozen-predecessor) at the end.

---

## 1. waxdb is a new service, not a migration

The predecessor keeps its worker, its KV namespace, its URL and its data. waxdb gets new ones. No record is shared, no request is dual-dispatched, and no code is carried forward that only exists to serve the old wire format.

**Why.** The old protocol's clients cannot be rebuilt (several are unmaintained), so the old service can never be switched off in any plan. Once that is accepted, keeping both protocols in one codebase buys nothing: it is not a migration window, because the window never closes. The alternative, sharing the record store between both protocols, was the right answer only while there were active users whose data would fork between an updated and a non-updated device. There are none.

**Costs.** An app that moves from the old service to waxdb starts with an empty record. That is acceptable only because of decision 2, and it is the reason decision 2 is written down as a load-bearing assumption rather than a nice property.

## 2. The device is the source of truth, the server is a cache

**Why.** It is already true of every existing client: they keep a full local copy and treat a pull as input to a merge, not as an authority. Naming it makes several other decisions cheap. Losing the server copy is a re-push rather than a data loss. A clobbered write is a temporary regression that the next sync corrects. And no migration tooling is needed, ever.

**Costs.** Data that exists on exactly one device, was pushed, was clobbered, and whose device never returns is genuinely gone. Judged acceptable for account data; it would not be for anything the user cannot reproduce.

Note that server-side migration is not merely undesirable here, it is **impossible**: a waxdb record needs a waxdb signature, and only the device holds the key. Any migration is client-side by construction.

## 3. The signed message is labelled text with a hashed payload, not EIP-712

**Closes `KNOWN-ISSUES.md` #2**, the ambiguous encoding, which is the reason this project exists.

**Why.** EIP-712 was the leading candidate for two benefits: something readable for a wallet to show, and a domain a wallet could match against a page origin to auto-sign. Both evaporated on inspection. A write happens on every debounced sync, so prompting a human is out of the question, which means the signer is always a local or delegated key, which means nothing is ever displayed. And if the wallet is never in the write path, there is no prompt for origin matching to skip.

What remained of EIP-712's value, structural unambiguity and separation between apps, are properties of the encoding rather than of the standard, and labelled text with fixed line counts and newline-free fields provides both. It also matches the house pattern in `etherplay-delegation`, keeps `signMessage(string)` as the only signer capability required, and keeps the signer's input constant-size by hashing `data`.

**Costs.** A third-party wallet can never auto-sign a waxdb write, because there is no domain for it to scope against. If that becomes desirable it is a different message format, which per decision 6 means a different service or a namespace the client moves to, at a price known in advance: a client-side re-push.

## 4. The counter keeps its ceiling, with T = 60 seconds

**Why.** The ceiling looks like an arbitrary restriction and is doing two jobs. It keeps counters comparable across devices that never talk to each other, which is what makes "larger counter, later write" true for a whole-blob last-writer-wins sync. And it bounds the damage from a client that writes an absurd counter: without it, one buggy write bricks a record permanently, for everybody including the owner.

The tolerance exists because the previous value was effectively zero, and a device whose clock is slightly ahead poisons the stored counter for its correctly-clocked siblings until real time catches up.

**Costs.** T is simultaneously the maximum skew a device may have and the maximum outage a fast clock can inflict. Sixty seconds of both. There is no setting that gives a large skew tolerance and a short outage, because they are the same number.

## 5. One opaque namespace, not an app plus a scope

**Why.** The split existed only to feed an EIP-712 domain with an origin. Decision 3 removed that consumer. One field is simpler, and it is more honest about what the server does with it, which is nothing.

**Costs.** The server has no notion of an "app", so per-app policy has nothing to key on. Quotas would sensibly key on the owner address anyway, and if it ever matters the convention of an app prefix inside the namespace is recoverable without a format change.

## 6. There is no version field

**Why.** An earlier draft of this document argued for one: a server-owned segment in the key and in the message, so that a future signing-scheme change would partition cleanly instead of colliding. That is insurance against a change nobody can specify, and everything it was buying is already bought:

- **Separation between formats** comes from the message text. It begins `waxdb store`, so a different format has different bytes there and its signatures cannot be mistaken for these. A number adds nothing that the labels do not already do.
- **Partitioning** comes from the namespace, which is an arbitrary client-chosen string. A client that changes format changes its namespace, and it is the party that knows when it has done so.

There is also evidence rather than theory here. This project's actual response to a breaking protocol change was to freeze `secp256k1-db` and start waxdb. A version field would not have helped, because the problem was clients that could not be rebuilt, and no server-side number fixes that.

**Costs.** If the message format ever does change, records written under the old one become unverifiable rather than verifiable-under-old-rules, since nothing in the record says which rules applied. That is acceptable *because of decision 2*: the server is a cache, every record is rewritten on the next sync, and a record old enough for this to matter is stale anyway. It would not be acceptable for an archive.

A reader who genuinely needs to check an old record still has everything required, since the signature is stored, and can try the formats it might have been written under.

## 7. There is no admin path. Delete is an owner-signed tombstone

**Closes `KNOWN-ISSUES.md` #1** (reset enables replay) **and #9** (a bare shared secret).

**Why.** The predecessor's `reset` deleted the record, which took the counter back to zero, which re-enabled every harvested signature for that record, since the counter is the only replay defence. It also let a single shared token delete anyone's data with no signature and no audit trail.

Both problems dissolve at once if deletion is just a write: a tombstone at a higher counter, signed by the owner, verified like any other write. No token, no privileged path, no constant-time comparison to get wrong, and the high-water mark survives.

**Costs.** An operator can no longer erase a record on request through the API. That was used once, to clear data that broke a client, and the replacement is a direct store edit. Which comes with a rule: **overwrite with a tombstone, never delete the key**, because deleting it in the dashboard has exactly the same replay consequence as the API method that was removed.

## 8. Preconditions are optional, and signed

**Why.** The counter check alone does not catch a client that pushes on top of a ten-minute-old pull: its counter is still larger, so the write lands and silently replaces newer data. That is not a storage problem and would happen on any database. `Expected` gives the client a way to say what it believed, and costs the server nothing, since it already reads the record to check the counter.

Signing it prevents a proxy or a client bug from quietly downgrading a conditional write into an unconditional one. Optional keeps blind last-writer-wins available for clients that genuinely want it.

**Costs.** It detects staleness, not races: the read and the write are not atomic, so a true concurrent pair can still both pass. It is never worse than omitting it. Real compare-and-swap would mean leaving Cloudflare KV, which was chosen for its price, and is deferred as a storage-seam change that needs no wire change.

## 9. Errors are structured, and a conflict is not one of them

**Closes `KNOWN-ISSUES.md` #3** (two error shapes, one of them an empty object), **#4** (a malformed usage hint) and **#7** (a response carrying both a result and an error).

**Why.** The predecessor put thrown values straight into the response, so half of them arrived as `{}` with no message and the rest as interpolated strings carrying engine text. A client could not tell a corrupt record from a validation failure.

Separately, a rejected write is not an error in a sync protocol, it is the normal outcome of two devices disagreeing, and the client needs the current counter to converge. So the outcome lives in the HTTP status and the `ok` discriminant, and the current record rides along in the read shape.

**Costs.** None here, since there is no deployed client to break. The cost was paid by deciding not to fix this in the predecessor.

## 10. Canonical forms are rejected, never normalised

**Closes `KNOWN-ISSUES.md` #5.**

**Why.** The predecessor pushed counters through `BigInt`, so `"0123"` was signed and stored as `"123"` and a client that padded its counter got an unexplained `invalid signature`. Any normalisation creates a gap between what a client signed and what the server verified, and that gap is a bug generator.

**Costs.** A client sending a non-canonical counter now gets an explicit rejection instead of a silent fix-up. That is the point.

## 11. Absence is a distinct state from counter zero

**Closes `KNOWN-ISSUES.md` #6.**

**Why.** The predecessor reported a missing record as `counter: "0"` and gated writes on `counter > stored`, so counter zero could never be written and "no record" was indistinguishable from "a record at zero". That conflation is what made the deletion replay of decision 7 possible. With a fresh store and no legacy records to imitate, absence is `{"found": false}`, a tombstone is a real record, and zero is a legal counter.

**Costs.** None. This was only ever a constraint imposed by the frozen on-disk format.

## 12. The payload is bytes on the wire, not a string in JSON

**Why.** The predecessor made `data` a JSON string, and the clients that need it most are storing ciphertext. `stratagems/web/src/lib/account/account-db.ts` compresses, encrypts, then base64url-encodes the result purely to satisfy that string requirement. Base64 costs a third of every byte, on every upload, in every stored record, forever, and the cost is imposed by the protocol rather than wanted by the client.

For a payload of N bytes, a JSON-string transport puts 1.33N on the wire, stores 1.33N, and materialises about 2.67N in the Worker because JavaScript strings are UTF-16, with several copies live at once during a write. Raw bytes are N everywhere. That is roughly 25% off bandwidth and storage and 4x off memory, and the beneficiaries are precisely the clients with the largest payloads.

Storing the payload verbatim as the KV value, with the record's own fields in KV metadata, also means the platform's 25 MiB value limit applies to the payload directly. There is no longer an escaping step that can inflate a compliant payload into a non-compliant record, so that whole class of confusing failure disappears.

**Costs.** Absence has to become a `404`, since the success body is the payload and cannot also carry `{"found": false}`. The `Storage` seam changes from strings to bytes plus metadata, touching both platform adapters. And the offline JSON dev store has to base64 its values, so `--db ./file.json` is less readable, which matters least for exactly the encrypted payloads that motivated the change.

Writes still cannot stream, because verification has to precede the write and the hash is only known once the body is consumed. Reads can and do, so read size is bounded only by the store while writes carry a cap.

## 13. Compression is the client's job, and it is the lever that matters

**Why.** With one encrypted payload there is no such thing as a delta: changing one byte of plaintext changes the whole ciphertext, so every change re-uploads everything. Nothing on the server can fix that. What can is compressing before encrypting, which typically shrinks account-style JSON several-fold and which `stratagems` already does. `jolly-roger`'s serializer is currently plain `JSON.stringify`, so the new consumer should adopt the same pipeline before anyone reasons about server-side sizes.

The order matters: compressing ciphertext achieves nothing. The known risk of compress-then-encrypt is the CRIME/BREACH family, which needs an attacker who can inject chosen plaintext and observe ciphertext lengths repeatedly. That is not the threat model for account data.

**Costs.** None to this protocol, which is the point: it is recorded here because the temptation when payloads grow is to raise the server's cap, and the cap is a backstop rather than a budget.

If a payload ever genuinely outgrows the blob approach, the escape hatch needs no protocol change: because `scope`-style namespaces are part of the key, a client can store many small independently-signed records instead of one, trading the consistent snapshot and leaking item count and sizes to the server.

## 14. Each platform owns its store. The Node one is not polystore

**Why.** The predecessor delegated the Node backend to `polystore`, whose value type is `Serializable` and whose only per-entry side-channel is a TTL. Once a record is bytes plus metadata (decision 12), that shape forces two things: base64 for the payload, a third larger on disk, and an envelope object to carry the metadata. The persistent backend is also a single JSON file, so every write rewrites the entire store, which on multi-megabyte payloads is far worse than the encoding overhead. polystore is a good key-value store for JSON values with expiry. This is a blob store.

There was already precedent for not delegating: the Cloudflare adapter bypasses polystore too, because it would wrap every value as `{expires, value}`.

Purpose-built is two small backends. A `Map` for `:memory:`, and a directory where each record is the payload as an ordinary file plus a small JSON sidecar at a path mirroring the key. That gives streaming reads, a `head` that touches only the sidecar, writes that touch one record instead of the whole store, and no base64. It is also **more** inspectable than the JSON file it replaces, since the payload is a file you can open, so the concession made earlier about the dev store getting less readable was a property of polystore rather than of the design.

This is what drove the namespace charset to lowercase, `:`-free, and never `.` or `..`. A file-backed store makes those latent problems real: `:` is illegal in Windows filenames, `.` and `..` are path traversal, and a case-sensitive key space on a case-insensitive filesystem means two records the server thinks are distinct become one. Cloudflare KV already forbids keys of `.` and `..` for its own reasons, so the rule was half there.

**Costs.** Roughly a hundred lines per backend that we now own and test. The marginal test cost is near zero because the contract suite already runs against every platform, which is what the seam was built for. SQLite was considered and declined: it would bring real atomicity, and therefore an exact `Expected` where Cloudflare can only manage best effort, but a native dependency is a heavy thing to put inside a CLI whose entire job is to be runnable offline with `npx`.

## 15. Limits are set now, while they are free

**Closes `KNOWN-ISSUES.md` #8** in part.

**Why.** A size cap is a breaking change the day after a client exceeds it, and free on the day the store is empty. The same is true of the namespace charset and length, which are additionally doing work for the key layout and the message encoding.

The write cap is **deployment configuration rather than protocol**, because raising one is always safe and lowering one breaks whatever is already over it. Freezing a number into the wire format would mean the only way to raise it later is a new format, and per decision 6 there is no version mechanism to make that cheap.

The default of 4 MiB is set by the Worker, not by the store. A Worker isolate has 128 MB shared across the concurrent requests it is serving, and with decision 12 a write holds the payload roughly once while hashing and verifying it. CPU is the tighter constraint: hashing several megabytes is on the order of a hundred milliseconds, fine against the paid plan's 30 seconds and impossible against the free plan's 10 ms. Reads carry no cap at all, because they stream.

**Costs.** The default is a judgement rather than a measurement, and a whole-store blob that never prunes will eventually meet it. When it does the write fails and sync stops, so the failure needs to be legible: that is why it is its own error code rather than a generic rejection. Rate limiting and quotas are deliberately absent, since they are platform concerns and belong outside a core that must stay free of platform APIs.

---

## The frozen predecessor

`etherplay/secp256k1-db`, archived. Its deployment is still running and still serving apps that cannot be rebuilt.

- worker `secp256k1-kv-db`, KV namespace `198cd439a1e2498e98c4e70f0aaaa47f`
- **never set `TOKEN_ADMIN`** on it: that is what makes the `reset` replay hole unreachable
- to clear a corrupted record, **overwrite it with a tombstone at its current counter**, never delete the key:
  `{"data":"","counter":"<current counter>","signature":""}`
