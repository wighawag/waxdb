import kv from 'polystore';
import type {Store} from 'polystore';
import type {Storage} from 'secp256k1-db-server';

/**
 * Polystore adapter, used off-Cloudflare where there is no legacy data at
 * stake. Values are handed to polystore as plain strings, so whatever backing
 * store is chosen round-trips them unchanged.
 *
 * NOTE: keys contain `:` and `/`-unsafe characters (real namespaces look like
 * `conquest-0xABC…:0xDEF…`), so file-per-key backends are not safe here. The
 * CLI defaults to a single JSON file or memory for that reason.
 */
export class PolyStorage implements Storage {
	constructor(private readonly store: Store) {}

	async get(key: string): Promise<string | null> {
		const value = await this.store.get<string>(key);
		return value === undefined || value === null ? null : value;
	}

	async put(key: string, value: string): Promise<void> {
		await this.store.set(key, value, {expires: null});
	}

	async delete(key: string): Promise<void> {
		await this.store.del(key);
	}
}

export type StoreLocation = ':memory:' | string;

/**
 * `:memory:` keeps everything in a Map (offline dev, tests), anything else is
 * treated as a path to a single JSON file.
 */
export function createStorage(location: StoreLocation): PolyStorage {
	if (location === ':memory:') {
		return new PolyStorage(kv(new Map()));
	}
	const url = location.startsWith('file://')
		? location
		: `file://${location.startsWith('/') ? '' : process.cwd() + '/'}${location}`;
	return new PolyStorage(kv(url));
}
