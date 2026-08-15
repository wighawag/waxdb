import type {Storage} from '../../src/storage.js';

/**
 * In-memory `Storage`, used both as a test double and as the reference for what
 * a platform adapter must do: keep the string it was given, byte for byte.
 */
export class MemoryStorage implements Storage {
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
