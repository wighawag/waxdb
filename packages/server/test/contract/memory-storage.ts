import type {Meta, Record, Storage} from '../../src/storage.js';

/**
 * In-memory `Storage`, used by the in-process harness and doubling as the
 * reference for what a platform adapter must do: keep the payload byte for
 * byte, keep the metadata beside it, and never let `head` touch the payload.
 */
export class MemoryStorage implements Storage {
	readonly records = new Map<string, {payload: Uint8Array; meta: Meta}>();

	/** counts calls, so a test can prove `head` was used instead of `get` */
	getCalls = 0;

	async head(key: string): Promise<Meta | null> {
		return this.records.get(key)?.meta ?? null;
	}

	async get(key: string): Promise<Record | null> {
		this.getCalls += 1;
		const found = this.records.get(key);
		if (found === undefined) return null;
		const payload = found.payload;
		return {
			...found.meta,
			payload: new ReadableStream({
				start(controller) {
					controller.enqueue(payload);
					controller.close();
				},
			}),
		};
	}

	async put(key: string, payload: Uint8Array, meta: Meta): Promise<void> {
		this.records.set(key, {payload: payload.slice(), meta: {...meta}});
	}

	async delete(key: string): Promise<void> {
		this.records.delete(key);
	}

	keys(): string[] {
		return [...this.records.keys()];
	}
}
