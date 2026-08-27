import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {
	isValidStorageKey,
	type Meta,
	type Record,
	type Storage,
} from 'waxdb-server';

/**
 * The local backends (DECISIONS.md #14).
 *
 * Not polystore, which the predecessor used. Once a record is bytes plus
 * metadata (DECISIONS.md #12), polystore's `Serializable` value type forces
 * base64 for the payload, a third larger on disk, plus an envelope object to
 * carry the metadata, and its persistent backend rewrites the entire store on
 * every write, which on multi-megabyte payloads is far worse than the encoding
 * overhead. It is a good key-value store for JSON values with expiry. This is a
 * blob store.
 *
 * So: two small backends we own. A `Map`, and a directory where each record is
 * its payload as an ordinary file plus a small JSON sidecar. That gives
 * streaming reads, a `head` that touches only the sidecar, writes that touch
 * one record rather than the whole store, and no base64. It is also *more*
 * inspectable than the JSON file it replaces, because the payload is a file you
 * can open.
 */
export interface LocalStorage extends Storage {
	/**
	 * Empties the whole store.
	 *
	 * Deliberately **not** part of `Storage`: the service must never be able to
	 * do this. It exists for the CLI's `--clear` flag and nothing else.
	 */
	clear(): Promise<void>;
}

// ---------------------------------------------------------------------------

class MemoryBackend implements LocalStorage {
	private readonly records = new Map<
		string,
		{payload: Uint8Array; meta: Meta}
	>();

	async head(key: string): Promise<Meta | null> {
		return this.records.get(key)?.meta ?? null;
	}

	async get(key: string): Promise<Record | null> {
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
		// copy, so a caller reusing its buffer cannot mutate a stored record
		this.records.set(key, {payload: payload.slice(), meta: {...meta}});
	}

	async delete(key: string): Promise<void> {
		this.records.delete(key);
	}

	async clear(): Promise<void> {
		this.records.clear();
	}
}

// ---------------------------------------------------------------------------

/**
 * A directory, one record as two ordinary files.
 *
 * ```
 * <root>/<namespace>/<owner>        the payload, verbatim
 * <root>/<namespace>/<owner>.json   the sidecar
 * ```
 *
 * The path mirrors the storage key. That is safe only because of the namespace
 * charset, and this backend is the reason that charset is what it is: `:` is
 * illegal in Windows filenames, `.` and `..` are traversal, and a case
 * sensitive key space on a case-insensitive filesystem would silently merge two
 * records the server thinks are distinct. The owner is a fixed `0x` + 40 hex,
 * so `<owner>.json` can never collide with another owner's payload file.
 */
class DirectoryBackend implements LocalStorage {
	constructor(private readonly root: string) {}

	private paths(key: string): {payload: string; sidecar: string} {
		// Defence in depth. The handler validates every field before a key is
		// built, so a bad key should be unreachable, but here a key becomes a
		// filesystem path and the cost of being wrong is traversal rather than a
		// failed lookup.
		if (!isValidStorageKey(key)) {
			throw new Error('refusing to build a path from a non-canonical key');
		}
		const payload = path.join(this.root, key);
		const resolvedRoot = path.resolve(this.root);
		const resolved = path.resolve(payload);
		if (
			resolved !== resolvedRoot &&
			!resolved.startsWith(resolvedRoot + path.sep)
		) {
			throw new Error('refusing to write outside the store root');
		}
		return {payload: resolved, sidecar: `${resolved}.json`};
	}

	async head(key: string): Promise<Meta | null> {
		const {sidecar} = this.paths(key);
		let raw: string;
		try {
			raw = await fsp.readFile(sidecar, 'utf8');
		} catch (err) {
			if (isNotFound(err)) return null;
			throw err;
		}
		return JSON.parse(raw) as Meta;
	}

	async get(key: string): Promise<Record | null> {
		const meta = await this.head(key);
		if (meta === null) return null;

		const {payload} = this.paths(key);
		// Open the handle before returning, so a missing payload file surfaces
		// here rather than as an error midway through an already-sent response.
		let handle: fsp.FileHandle;
		try {
			handle = await fsp.open(payload, 'r');
		} catch (err) {
			if (isNotFound(err)) return null;
			throw err;
		}
		const stream = Readable.toWeb(
			handle.createReadStream({autoClose: true}),
		) as unknown as ReadableStream;
		return {...meta, payload: stream};
	}

	/**
	 * Payload first, then the sidecar.
	 *
	 * The order matters on a crash: a payload with no sidecar is an invisible
	 * record, which `head` reports as absence, whereas a sidecar with no payload
	 * would be a record that cannot be read. Both files are written to a
	 * temporary name and renamed, so a reader never observes a half-written one.
	 */
	async put(key: string, payload: Uint8Array, meta: Meta): Promise<void> {
		const paths = this.paths(key);
		await fsp.mkdir(path.dirname(paths.payload), {recursive: true});
		await writeAtomic(paths.payload, payload);
		await writeAtomic(paths.sidecar, Buffer.from(JSON.stringify(meta), 'utf8'));
	}

	async delete(key: string): Promise<void> {
		const paths = this.paths(key);
		// sidecar first: it is what makes the record visible
		await removeIfPresent(paths.sidecar);
		await removeIfPresent(paths.payload);
	}

	async clear(): Promise<void> {
		await fsp.rm(this.root, {recursive: true, force: true});
		await fsp.mkdir(this.root, {recursive: true});
	}
}

async function writeAtomic(
	target: string,
	contents: Uint8Array,
): Promise<void> {
	const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
	await fsp.writeFile(temporary, contents);
	await fsp.rename(temporary, target);
}

async function removeIfPresent(target: string): Promise<void> {
	try {
		await fsp.unlink(target);
	} catch (err) {
		if (!isNotFound(err)) throw err;
	}
}

function isNotFound(err: unknown): boolean {
	return (
		typeof err === 'object' &&
		err !== null &&
		(err as {code?: string}).code === 'ENOENT'
	);
}

// ---------------------------------------------------------------------------

export type StoreLocation = ':memory:' | (string & {});

/**
 * `:memory:` keeps everything in a Map. Anything else is a **directory**,
 * created if it does not exist.
 *
 * This changed with DECISIONS.md #14: it used to be a path to a single JSON
 * file, which meant every write rewrote the whole store.
 */
export function createStorage(location: StoreLocation): LocalStorage {
	if (location === ':memory:') return new MemoryBackend();

	const root = path.resolve(location);
	if (fs.existsSync(root) && !fs.statSync(root).isDirectory()) {
		throw new Error(
			`--db must be ":memory:" or a directory, and ${root} is a file. ` +
				`waxdb now stores each record as its own payload file plus a JSON sidecar, ` +
				`so a single-file store is no longer used.`,
		);
	}
	fs.mkdirSync(root, {recursive: true});
	return new DirectoryBackend(root);
}
