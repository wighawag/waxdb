/**
 * The storage seam.
 *
 * Deliberately a *string* key-value store, not a typed/serialising one: the
 * live Cloudflare KV namespace holds 2594 records written since 2021, and the
 * server owns their exact serialisation (see `record.ts`). A platform adapter
 * must persist and return these strings byte-for-byte, adding no wrapper, no
 * re-encoding and no key mangling.
 */
export interface Storage {
	/** the stored string, or null when the key is absent */
	get(key: string): Promise<string | null>;
	put(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}
