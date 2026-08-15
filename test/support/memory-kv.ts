/**
 * Minimal in-memory stand-in for the subset of `KVNamespace` that the handler uses.
 *
 * Only `get`, `put` and `delete` are exercised by `src/handler.ts`.
 * Values are stored verbatim as strings, exactly like Cloudflare KV does for
 * string values, so tests can assert on the exact bytes that get persisted.
 */
export class MemoryKV {
	readonly store = new Map<string, string>();

	async get(key: string): Promise<string | null> {
		const value = this.store.get(key);
		return value === undefined ? null : value;
	}

	async put(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}

	keys(): string[] {
		return [...this.store.keys()];
	}
}
