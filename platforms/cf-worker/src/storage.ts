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
 * propagate. So `head` may return a stale counter and two writes inside that
 * window can both pass. SPEC.md accepts this explicitly, which is why
 * `Expected` is documented as detecting staleness rather than races.
 */
export class KVStorage implements Storage {
	constructor(private readonly kv: KVNamespace) {}

	/**
	 * Metadata via `list`, never `get`.
	 *
	 * A key listing returns metadata without values, so checking a counter
	 * costs nothing even when the record is multiple megabytes. Using `get`
	 * here would transfer the whole payload to compare a number, on every
	 * single write.
	 */
	async head(key: string): Promise<Meta | null> {
		const listing = await this.kv.list<Meta>({prefix: key, limit: 1});
		const first = listing.keys[0];
		// `prefix` is a prefix, not an equality test. No valid key can extend
		// another (the owner is a fixed 42 characters and terminates the key),
		// but relying on that would make this correct by luck.
		if (first === undefined || first.name !== key) return null;
		return first.metadata ?? null;
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
