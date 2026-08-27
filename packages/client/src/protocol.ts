/**
 * The wire format, implemented independently of the server.
 *
 * **This duplicates `@waxdb/server` on purpose, and the duplication is
 * load-bearing twice over.**
 *
 * Licensing: this package is MIT and the server is AGPL-3.0-only, so importing
 * the server's implementation would make every consumer of this client subject
 * to the AGPL. A client library that cannot be embedded freely is not much of a
 * client library.
 *
 * Correctness: an independent implementation is the only kind that can catch an
 * encoding bug. If both sides built the message with the same function, an
 * error in it would cancel out and every test would pass while nothing
 * interoperated. `vectors.json` is what holds the two implementations to the
 * same answer, and `test/vectors.test.ts` is where that is checked.
 *
 * The rules here are normative in SPEC.md. Do not "improve" them: every one is
 * a rejection rule rather than a normalisation rule, because any gap between
 * what a client signs and what a server verifies is a bug generator.
 */

const encoder = new TextEncoder();

// --- field forms ----------------------------------------------------------

/** `[a-z0-9._-]{1,255}`, never `.` or `..`, never leading `.` */
export function isValidNamespace(value: string): boolean {
	if (!/^[a-z0-9._-]{1,255}$/.test(value)) return false;
	if (value === '.' || value === '..') return false;
	if (value.startsWith('.')) return false;
	return true;
}

/** `0x` + 40 hex, any case in, lowercase out, or null */
export function normaliseOwner(value: string): string | null {
	if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
	return value.toLowerCase();
}

/** `0` or `[1-9][0-9]*`. No leading zeros, no hex, no exponent, no sign */
export function isCanonicalCounter(value: string): boolean {
	return /^(0|[1-9][0-9]*)$/.test(value);
}

/** `any`, `none`, or a canonical counter */
export function isValidExpected(value: string): boolean {
	return value === 'any' || value === 'none' || isCanonicalCounter(value);
}

// --- the signed messages --------------------------------------------------

export type StoreInputs = {
	namespace: string;
	/** lowercase */
	owner: string;
	counter: string;
	expected: string;
	/** `0x` + 64 lowercase hex, SHA-256 of the payload */
	payloadHash: string;
};

/** six lines, joined with `\n`, no trailing newline */
export function storeMessage(inputs: StoreInputs): string {
	return [
		'waxdb store',
		`Namespace: ${inputs.namespace}`,
		`Owner: ${inputs.owner}`,
		`Counter: ${inputs.counter}`,
		`Expected: ${inputs.expected}`,
		`Data: ${inputs.payloadHash}`,
	].join('\n');
}

/** five lines */
export function deleteMessage(
	inputs: Omit<StoreInputs, 'payloadHash'>,
): string {
	return [
		'waxdb delete',
		`Namespace: ${inputs.namespace}`,
		`Owner: ${inputs.owner}`,
		`Counter: ${inputs.counter}`,
		`Expected: ${inputs.expected}`,
	].join('\n');
}

/** four lines */
export function readMessage(inputs: {
	namespace: string;
	owner: string;
	/** unix seconds */
	expires: string;
}): string {
	return [
		'waxdb read',
		`Namespace: ${inputs.namespace}`,
		`Owner: ${inputs.owner}`,
		`Expires: ${inputs.expires}`,
	].join('\n');
}

/** the byte length an EIP-191 prefix must count. Bytes, never characters */
export function messageByteLength(message: string): number {
	return encoder.encode(message).length;
}

// --- the payload hash -----------------------------------------------------

/**
 * SHA-256 of the payload, as `0x` + 64 lowercase hex.
 *
 * SHA-256 rather than keccak because it is the only hash in the protocol whose
 * cost scales, and it is native everywhere while keccak is not (DECISIONS.md
 * #17). keccak is still involved, inside whatever signs the message, but that
 * is a few hundred bytes and therefore free.
 *
 * `crypto.subtle` is **undefined in a browser outside a secure context**, so a
 * page served over plain `http://` on anything but localhost has to supply
 * `sha256` itself. The error below says so rather than failing as `undefined is
 * not an object`.
 */
export async function payloadHash(payload: Uint8Array): Promise<string> {
	if (typeof crypto === 'undefined' || crypto.subtle === undefined) {
		throw new Error(
			'crypto.subtle is unavailable, which usually means a browser outside a ' +
				'secure context (plain http:// on a host other than localhost). Serve ' +
				'over https, or pass a `sha256` implementation in the client options.',
		);
	}
	// copy into an exactly-sized buffer: `payload.buffer` may be a larger pool
	const view = new Uint8Array(payload.byteLength);
	view.set(payload);
	const digest = await crypto.subtle.digest('SHA-256', view);
	return toHex(new Uint8Array(digest));
}

export function toHex(bytes: Uint8Array): string {
	let out = '0x';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}
