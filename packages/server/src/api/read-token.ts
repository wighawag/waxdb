/**
 * The read token (SPEC.md, "Reading, and the read token").
 *
 * Reads are authenticated by default. A record is readable only by its owner,
 * who proves it with a short-lived token signed by the same key that writes it.
 * `PUBLIC_READS` turns the whole thing off deployment-wide; nothing about it
 * appears in the signed message or the stored record, which is what keeps it
 * free to change (DECISIONS.md #16).
 */
import type {Env} from '../env.js';
import {
	isCanonicalExpires,
	isValidSignatureFormat,
} from '../protocol/fields.js';
import {readMessage} from '../protocol/message.js';
import {verifySignature} from '../protocol/verify.js';

/** the same 60 seconds the write ceiling uses, in seconds here */
const SKEW_TOLERANCE_SECONDS = 60n;
const DEFAULT_MAX_READ_TOKEN_SECONDS = 3600n;

/**
 * The three outcomes, and they are deliberately not four.
 *
 * - `ok`: proceed to storage.
 * - `malformed`: `400 invalid_read_token`. Decided before any storage lookup,
 *   so it reveals nothing about the record while staying debuggable.
 * - `denied`: **`404`, identical to absence**, for a token that is absent,
 *   expired, too long-lived, or signed by the wrong key. Never `401`.
 */
export type ReadTokenResult = 'ok' | 'malformed' | 'denied';

export function checkReadToken(options: {
	env: Env;
	headers: Headers;
	namespace: string;
	owner: string;
	nowMs: number;
}): ReadTokenResult {
	const {env, headers, namespace, owner, nowMs} = options;

	// "When PUBLIC_READS is set, reads are anonymous and none of this section
	// applies" - including the syntax check, so a stray header cannot 400 on an
	// open deployment
	if (env.PUBLIC_READS) return 'ok';

	const expires = headers.get('waxdb-read-expires');
	const signature = headers.get('waxdb-read-signature');

	// no token at all answers exactly what absence answers
	if (expires === null && signature === null) return 'denied';

	// 1. Syntax. A half-sent token is an attempt, not an absence, so it gets the
	// debuggable answer rather than the opaque one. Still decided before any
	// storage lookup, so it leaks nothing either way.
	if (expires === null || signature === null) return 'malformed';
	if (!isCanonicalExpires(expires)) return 'malformed';
	if (!isValidSignatureFormat(signature)) return 'malformed';

	const expiresAt = BigInt(expires);
	const now = BigInt(Math.floor(nowMs / 1000));

	// 2. Not expired, with the skew tolerance the write ceiling uses, so a
	// client whose clock runs slightly behind is not locked out of its own data
	if (expiresAt + SKEW_TOLERANCE_SECONDS < now) return 'denied';

	// 3. Not absurdly long-lived, so no client can mint a credential that
	// outlives its usefulness
	if (expiresAt > now + maxReadTokenSeconds(env)) return 'denied';

	// 4. Signed by the owner
	const message = readMessage({namespace, owner, expires});
	if (!verifySignature(message, signature, owner)) return 'denied';

	return 'ok';
}

function maxReadTokenSeconds(env: Env): bigint {
	const configured = env.MAX_READ_TOKEN_SECONDS;
	if (configured === undefined) return DEFAULT_MAX_READ_TOKEN_SECONDS;
	try {
		const value = BigInt(configured);
		return value > 0n ? value : DEFAULT_MAX_READ_TOKEN_SECONDS;
	} catch {
		return DEFAULT_MAX_READ_TOKEN_SECONDS;
	}
}
