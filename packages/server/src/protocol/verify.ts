/**
 * Signature recovery (SPEC.md, "Digest and verification").
 */
import {secp256k1} from '@noble/curves/secp256k1.js';
import {eip191Digest, keccak256, toHex} from './digest.js';

/**
 * Recovers the signer of an EIP-191 message, or null.
 *
 * Returns null rather than throwing for anything unrecoverable. A syntactically
 * valid 65-byte signature with a nonsense `v`, or one whose `r`/`s` do not
 * describe a point, is not a *format* error: `invalid_signature_format` means
 * "not 65 bytes of hex" and nothing more. Everything past that is a mismatch,
 * so the caller answers `signature_mismatch` and an attacker learns nothing
 * from the difference.
 *
 * **Malleability is deliberately not rejected.** `(r, s, v)` and `(r, -s, v')`
 * recover the same address for the same message, so both authorise the same
 * write, and the record keeps whichever form was submitted. `@noble/curves`
 * does not enforce low-`s` on recovery, which is what the protocol wants here.
 */
export function recoverSigner(
	message: string,
	signature: string,
): string | null {
	const raw = signature.startsWith('0x') ? signature.slice(2) : signature;
	if (raw.length !== 130) return null;

	let recoveryBit: number;
	try {
		recoveryBit = parseInt(raw.slice(128, 130), 16);
	} catch {
		return null;
	}
	// accept both the ethereum spelling (27/28) and the raw bit (0/1)
	if (recoveryBit === 27 || recoveryBit === 28) recoveryBit -= 27;
	if (recoveryBit !== 0 && recoveryBit !== 1) return null;

	try {
		const digest = eip191Digest(message);
		const sig = secp256k1.Signature.fromHex(
			raw.slice(0, 128),
			'compact',
		).addRecoveryBit(recoveryBit);
		// uncompressed point, minus its 0x04 tag; the address is the last 20
		// bytes of its keccak
		const publicKey = sig.recoverPublicKey(digest).toBytes(false);
		return toHex(keccak256(publicKey.subarray(1)).subarray(12));
	} catch {
		return null;
	}
}

/**
 * True when `signature` over `message` was produced by `owner`.
 *
 * `owner` is compared case-insensitively, per SPEC.md, though every caller in
 * this codebase has already lowercased it.
 */
export function verifySignature(
	message: string,
	signature: string,
	owner: string,
): boolean {
	const signer = recoverSigner(message, signature);
	if (signer === null) return false;
	return signer.toLowerCase() === owner.toLowerCase();
}
