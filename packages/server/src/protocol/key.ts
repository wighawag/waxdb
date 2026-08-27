/**
 * The storage key (SPEC.md, "Storage").
 *
 * ```
 * key = `${namespace}/${owner}`
 * ```
 *
 * Because `/` appears in no field's charset, the key is exactly two
 * `/`-separated segments and decomposes uniquely. Maximum length is
 * 256 + 1 + 42 = 299 bytes, inside Cloudflare KV's 512-byte limit, and every
 * segment is lowercase, which is what lets a file-backed store use it as a path
 * without a case-insensitive filesystem merging two distinct records.
 */
import {isCanonicalOwner, isValidNamespace} from './fields.js';

export function storageKey(namespace: string, owner: string): string {
	return `${namespace}/${owner}`;
}

/**
 * Splits a key back into its two segments, or null.
 *
 * **Parses right to left.** With a valid key this is identical to parsing left
 * to right, because a namespace cannot contain `/`. It is written this way so
 * that an *invalid* key, one that somehow acquired an extra separator, cannot
 * be read as a valid namespace plus a mangled owner: the owner is whatever
 * follows the last separator, and the namespace is then validated as a whole.
 */
export function parseStorageKey(
	key: string,
): {namespace: string; owner: string} | null {
	const separator = key.lastIndexOf('/');
	if (separator <= 0) return null;

	const namespace = key.slice(0, separator);
	const owner = key.slice(separator + 1);

	if (!isValidNamespace(namespace)) return null;
	if (!isCanonicalOwner(owner)) return null;

	return {namespace, owner};
}

/**
 * Whether a key is one this protocol could have produced.
 *
 * Storage adapters use this as defence in depth. The handler validates every
 * field before a key is built, so a bad key should be unreachable, but a
 * file-backed adapter turns a key into a filesystem path and the cost of being
 * wrong there is path traversal rather than a bad lookup.
 */
export function isValidStorageKey(key: string): boolean {
	return parseStorageKey(key) !== null;
}
