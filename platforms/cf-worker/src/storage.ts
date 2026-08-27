import type {Storage} from 'waxdb-server';

/**
 * Cloudflare KV adapter.
 *
 * Intentionally the thinnest possible passthrough: the adapter must not prefix
 * keys, wrap values, or re-encode anything, so what is on disk is exactly what
 * the core asked for.
 *
 * NOTE: still the old string-valued seam. SPEC.md defines the real one
 * (`head`/`get`/`put`/`delete` over bytes plus metadata, reads streaming), and
 * this moves to it with the handler.
 */
export class KVStorage implements Storage {
	constructor(private readonly kv: KVNamespace) {}

	get(key: string): Promise<string | null> {
		return this.kv.get(key);
	}

	put(key: string, value: string): Promise<void> {
		return this.kv.put(key, value);
	}

	delete(key: string): Promise<void> {
		return this.kv.delete(key);
	}
}
