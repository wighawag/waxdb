import type {Storage} from 'secp256k1-db-server';

/**
 * Cloudflare KV adapter.
 *
 * Intentionally the thinnest possible passthrough: this namespace already holds
 * the live records, so the adapter must not prefix keys, wrap values, or
 * re-encode anything. `KVNamespace.get` returns the stored text or null, which
 * is exactly the `Storage` contract.
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
