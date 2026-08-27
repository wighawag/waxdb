/**
 * Field forms (SPEC.md, "Field forms").
 *
 * **Every function here is a rejection rule, never a normalisation rule.** A
 * value that is not already canonical is an error. This is DECISIONS.md #10 and
 * it is not stylistic: the predecessor pushed counters through `BigInt`, so a
 * client that signed `0123` had `123` verified and stored, and got back an
 * unexplained `invalid signature`. Any gap between what a client signed and
 * what the server verified is a bug generator, so there is no gap.
 *
 * The single exception is `owner`, which may arrive in any case in a URL and is
 * lowercased before use. That is not a normalisation of the signed message: the
 * message always uses the lowercase form, so a client that signs a checksummed
 * spelling fails verification rather than writing something it did not intend.
 */

/**
 * `[a-z0-9._-]{1,255}`, never `.` or `..`, never leading `.`.
 *
 * Narrow on purpose, and every restriction pays for something (SPEC.md):
 * ASCII so the EIP-191 byte-length trap cannot occur, no `/` so the storage key
 * splits into exactly two segments, lowercase so a case-insensitive filesystem
 * cannot merge two records the server thinks are distinct, no `:` because that
 * is illegal in Windows filenames, and never `.`/`..`/leading `.` because those
 * are path traversal in any file-backed store.
 *
 * **255, not 256.** A namespace is one path component in the directory backend
 * (DECISIONS.md #14), and `NAME_MAX` is 255 bytes on ext4, APFS, tmpfs and NTFS
 * alike. At 256 the local store fails with `ENAMETOOLONG` while Cloudflare
 * accepts the write, which is exactly the divergence the charset rules exist to
 * prevent. The namespace is ASCII, so bytes and characters coincide.
 */
const NAMESPACE = /^[a-z0-9._-]{1,255}$/;

export function isValidNamespace(value: string): boolean {
	if (!NAMESPACE.test(value)) return false;
	// `.` and `..` pass the charset and are traversal on a file-backed store;
	// Cloudflare KV forbids them as keys for its own reasons
	if (value === '.' || value === '..') return false;
	if (value.startsWith('.')) return false;
	return true;
}

/** `0x` + 40 lowercase hex, the form used in the signed message and the key */
const OWNER_CANONICAL = /^0x[0-9a-f]{40}$/;
/** what a URL may carry, before lowercasing */
const OWNER_ANY_CASE = /^0x[0-9a-fA-F]{40}$/;

export function isCanonicalOwner(value: string): boolean {
	return OWNER_CANONICAL.test(value);
}

/**
 * Accepts either case and returns the lowercase form, or null.
 *
 * Only for the URL path. Everything downstream, the message and the storage
 * key, uses what this returns.
 */
export function normaliseOwnerFromUrl(value: string): string | null {
	if (!OWNER_ANY_CASE.test(value)) return null;
	return value.toLowerCase();
}

/** `0` or `[1-9][0-9]*`. No leading zeros, no hex, no exponent, no sign */
const COUNTER = /^(0|[1-9][0-9]*)$/;

export function isCanonicalCounter(value: string): boolean {
	return COUNTER.test(value);
}

/** `any`, `none`, or a canonical counter */
export function isValidExpected(value: string): boolean {
	return value === 'any' || value === 'none' || isCanonicalCounter(value);
}

/** unix seconds, same canonical decimal form as a counter */
export function isCanonicalExpires(value: string): boolean {
	return COUNTER.test(value);
}

/** `0x` + 64 **lowercase** hex. SPEC.md spells the case out for this one */
const DATA_HASH = /^0x[0-9a-f]{64}$/;

export function isValidDataHash(value: string): boolean {
	return DATA_HASH.test(value);
}

/**
 * `0x` + 130 hex, either case.
 *
 * SPEC.md says "130 hex characters" here where it says "64 lowercase hex" for
 * the payload hash, and the difference is taken as deliberate. The signature is
 * not part of the signed message, so its case cannot change what was signed,
 * and the record keeps whichever form was submitted.
 */
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export function isValidSignatureFormat(value: string): boolean {
	return SIGNATURE.test(value);
}

/**
 * Compares two canonical counters.
 *
 * `BigInt` is safe here and is *only* used to compare. It is never used to
 * re-serialise a counter, which is precisely the predecessor's bug: the string
 * that goes into the message and into storage is always the one the client
 * sent, byte for byte.
 */
export function compareCounters(a: string, b: string): -1 | 0 | 1 {
	const left = BigInt(a);
	const right = BigInt(b);
	return left < right ? -1 : left > right ? 1 : 0;
}
