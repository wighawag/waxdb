/**
 * The storage seam (SPEC.md, "The storage seam").
 *
 * One interface, supplied by every platform. It contains no platform API and
 * never will: `ReadableStream` and `Uint8Array` are web standards present in
 * Workers and in Node, which is what lets one contract suite run everywhere.
 *
 * It is **asymmetric on purpose**. Reads hand back a stream because nothing
 * inspects them, so a read is bounded only by the store. Writes take bytes
 * because verification has to see every one of them before anything is stored,
 * which is why writes carry a size cap and reads do not.
 */

/**
 * Everything about a record except its payload.
 *
 * `dataHash` is the SHA-256 of the payload, as signed on the `Data:` line. It
 * is stored rather than recomputed because both paths that need it forbid
 * recomputing it: a read streams and is never hashed, and `head` must never
 * touch the payload at all. It is also not derivable from what else is here,
 * since a signature yields a public key given a digest and never the reverse.
 * Storing it is what makes a key-and-metadata listing genuinely describe a
 * record: without it the stored signature cannot be checked without
 * transferring the payload.
 *
 * **Invariant:** `dataHash` is present exactly when `deleted` is false. A
 * tombstone is authorised by the `waxdb delete` message, which has no `Data:`
 * line, so a tombstone has no signed payload hash and storing one would mean
 * inventing a hash nobody signed.
 */
export type Meta = {
	/** canonical decimal, no leading zeros */
	counter: string;
	/** `0x` + 130 hex, exactly as the client submitted it */
	signature: string;
	deleted: boolean;
	/** `0x` + 64 lowercase hex. Absent on a tombstone, present otherwise */
	dataHash?: string;
};

export type Record = Meta & {payload: ReadableStream};

export interface Storage {
	/**
	 * Metadata only, never the payload.
	 *
	 * **This is a rule, not an optimisation.** Every write needs the stored
	 * counter and deleted flag to check monotonicity and the precondition, and
	 * fetching a multi-megabyte value to compare a number, on every write, is
	 * the difference between a check and a transfer. `HEAD` uses the same call.
	 */
	head(key: string): Promise<Meta | null>;

	/** the record, payload as a stream that the caller pipes without buffering */
	get(key: string): Promise<Record | null>;

	/**
	 * Stores a payload and its metadata under one key.
	 *
	 * Must throw {@link StorageRateLimitError} when the backing store refuses
	 * the write *rate*, so the handler can answer `429 rate_limited` instead of
	 * a misleading `500 storage_error`. Detecting that is the adapter's job,
	 * because the way it surfaces is platform-specific and the core holds no
	 * platform API.
	 */
	put(key: string, payload: Uint8Array, meta: Meta): Promise<void>;

	/**
	 * Removes a key entirely.
	 *
	 * **The protocol never calls this.** A `DELETE` request writes a tombstone
	 * through `put`, because erasing a key would take the counter back to
	 * absence and re-enable every harvested signature for that record
	 * (DECISIONS.md #7). It exists for operators and for a platform's own
	 * teardown, and an adapter must still implement it correctly.
	 */
	delete(key: string): Promise<void>;
}

/**
 * The backing store refused the write rate.
 *
 * Cloudflare KV allows one write per second to a single key on every plan, and
 * every record for one `(namespace, owner)` is one key by construction, so a
 * sync client's debounce is directly exposed to it. Adapters translate their
 * platform's version of this into this error; the handler maps it to `429`.
 */
export class StorageRateLimitError extends Error {
	constructor(
		message = 'the store refused the write rate',
		options?: {cause?: unknown},
	) {
		super(message, options);
		this.name = 'StorageRateLimitError';
	}
}
