/**
 * The two hashes, and why there are two (SPEC.md, "Digest and verification";
 * DECISIONS.md #17).
 *
 * `keccak256` is forced by EIP-191 and covers the signed message, which is a
 * few hundred bytes whatever the payload. Measured in a Worker that is 8.6 µs,
 * so it is free.
 *
 * `SHA-256` covers the payload, which is the only thing in the protocol whose
 * cost scales. It is native in Workers, browsers and Node, and keccak is not:
 * 10 MiB costs 5.1 ms one way and 179 ms the other. That 35x is what lets a
 * 10 MiB write fit inside the free plan's 10 ms CPU budget.
 */
import {keccak_256} from '@noble/hashes/sha3.js';

const encoder = new TextEncoder();

/** `0x` followed by lowercase hex */
export function toHex(bytes: Uint8Array): string {
	let out = '0x';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

export function fromHex(hex: string): Uint8Array {
	const body = hex.startsWith('0x') ? hex.slice(2) : hex;
	const out = new Uint8Array(body.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(body.substring(i * 2, i * 2 + 2), 16);
	}
	return out;
}

export function keccak256(bytes: Uint8Array): Uint8Array {
	return keccak_256(bytes);
}

/**
 * SHA-256 of the payload, as it appears on the `Data:` line.
 *
 * Async because `crypto.subtle.digest` is, which is the one ergonomic cost of
 * decision 17. `crypto.subtle` is a global in workerd, in Node 18+ and in any
 * browser secure context.
 */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	// `bytes.buffer` may be a larger pooled buffer, so copy this view's own
	// window rather than hashing whatever else happens to share it
	const view = new Uint8Array(bytes.byteLength);
	view.set(bytes);
	return new Uint8Array(await crypto.subtle.digest('SHA-256', view));
}

export async function payloadHash(bytes: Uint8Array): Promise<string> {
	return toHex(await sha256(bytes));
}

/**
 * The EIP-191 `personal_sign` digest.
 *
 * ```
 * keccak256(0x19 || "Ethereum Signed Message:\n" || byteLength(message) || message)
 * ```
 *
 * **The length prefix counts BYTES, not characters.** Every field's charset
 * excludes non-ASCII, so today the two coincide, which is exactly why getting
 * this wrong would go unnoticed until the day a charset changes. It is computed
 * from the encoded length here so the invariant survives that day.
 */
export function eip191Digest(message: string): Uint8Array {
	const body = encoder.encode(message);
	const prefix = encoder.encode(`\x19Ethereum Signed Message:\n${body.length}`);
	const preimage = new Uint8Array(prefix.length + body.length);
	preimage.set(prefix, 0);
	preimage.set(body, prefix.length);
	return keccak256(preimage);
}
