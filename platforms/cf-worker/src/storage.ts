import {
	StorageRateLimitError,
	type Meta,
	type Record,
	type Storage,
} from 'waxdb-server';

/**
 * Cloudflare KV adapter (SPEC.md, "The storage seam").
 *
 * ```
 * key      = `${namespace}/${owner}`
 * value    = the payload bytes, verbatim
 * metadata = {counter, signature, deleted, dataHash}
 * ```
 *
 * The payload is the value and nothing else: no envelope, no encoding, no
 * escaping. That is what makes the platform's 25 MiB value limit apply to the
 * payload directly, with no escaping step able to inflate a compliant payload
 * into a non-compliant record (DECISIONS.md #12).
 *
 * A note on consistency, since it is a property of the store rather than a bug
 * here: KV is eventually consistent, and a write can take up to a minute to
 * propagate between regions. So `head` may return a stale counter and two
 * writes inside that window can both pass. SPEC.md accepts this explicitly,
 * which is why `Expected` is documented as detecting staleness rather than
 * races.
 *
 * What is *not* acceptable, and what this adapter had to change to avoid, is
 * `list` being far staler than `get`. See `head`.
 */
export class KVStorage implements Storage {
	constructor(private readonly kv: KVNamespace) {}

	/**
	 * Metadata via `getWithMetadata`, with the payload stream discarded.
	 *
	 * **This used to be `list({prefix: key, limit: 1})`, which SPEC.md used to
	 * recommend, and it was wrong on real Cloudflare KV.** `list` is served
	 * from a different index than `get` and lags it badly. Measured against a
	 * live deployment, a freshly written record was visible to `get` after
	 * 507 ms and to `list` only after 31.5 seconds.
	 *
	 * That is not a cosmetic difference, because `head` is what the write path
	 * uses to enforce the counter rule and the precondition. With `list`, the
	 * server believed a just-written record did not exist for a further half
	 * minute, so during that window the counter was not enforced at all: an
	 * older signature could be replayed, `Expected: none` passed against a
	 * record that existed, and a tombstone did not hold its high-water mark.
	 * The counter is the protocol's only replay defence (DECISIONS.md #7), so a
	 * 30 second hole in it is a protocol failure rather than a staleness
	 * nuisance. DECISIONS.md #19.
	 *
	 * No local test could catch this: miniflare's KV is immediately consistent.
	 * The live conformance suite is what found it.
	 *
	 * The payload is still never read. `type: "stream"` hands back a lazy body
	 * which is cancelled immediately, so the value is not pulled into the
	 * isolate and a multi-megabyte record still costs no transfer to check.
	 * What it does cost, which `list` did not, is a KV read operation.
	 */
	async head(key: string): Promise<Meta | null> {
		const {value, metadata} = await this.kv.getWithMetadata<Meta>(key, {
			type: 'stream',
		});
		if (value === null) return null;
		// the whole point: take the metadata, never the bytes
		await value.cancel().catch(() => {});
		return metadata ?? null;
	}

	async get(key: string): Promise<Record | null> {
		const {value, metadata} = await this.kv.getWithMetadata<Meta>(key, {
			type: 'stream',
		});
		if (value === null || metadata === null) return null;
		return {...metadata, payload: value};
	}

	async put(key: string, payload: Uint8Array, meta: Meta): Promise<void> {
		try {
			await this.kv.put(key, payload, {metadata: meta});
		} catch (err) {
			if (isRateLimit(err)) {
				throw new StorageRateLimitError(undefined, {cause: err});
			}
			throw err;
		}
	}

	async delete(key: string): Promise<void> {
		await this.kv.delete(key);
	}
}

/**
 * KV allows one write per second to a single key, on every plan, and throws
 * `KV PUT failed: 429 Too Many Requests` inside that window.
 *
 * Recognising it here rather than in the core is what keeps the core free of
 * platform APIs: the core knows only `StorageRateLimitError`.
 */
function isRateLimit(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return err.message.includes('429') || /too many requests/i.test(err.message);
}
