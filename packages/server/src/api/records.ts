/**
 * The record handlers (SPEC.md, "Read" and "Write").
 */
import type {Env} from '../env.js';
import {StorageRateLimitError, type Meta, type Storage} from '../storage.js';
import {payloadHash} from '../protocol/digest.js';
import {
	compareCounters,
	isCanonicalCounter,
	isValidDataHash,
	isValidExpected,
	isValidNamespace,
	isValidSignatureFormat,
	normaliseOwnerFromUrl,
} from '../protocol/fields.js';
import {storageKey} from '../protocol/key.js';
import {deleteMessage, storeMessage} from '../protocol/message.js';
import {verifySignature} from '../protocol/verify.js';
import {WaxdbError, invalid} from './errors.js';
import {checkReadToken} from './read-token.js';
import {
	current,
	errorResponse,
	json,
	notFound,
	recordHeaders,
	withCors,
} from './responses.js';

/** T, as milliseconds, for the counter ceiling */
const COUNTER_SKEW_TOLERANCE_MS = 60_000n;
/** deployment policy, not protocol (SPEC.md, Limits) */
const DEFAULT_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

export type Target = {namespace: string; owner: string; key: string};

/**
 * Validates the path.
 *
 * `owner` may arrive in any case and is lowercased; everything downstream, the
 * signed message included, uses the lowercase form, so a client that signed a
 * checksummed spelling fails verification rather than writing something it did
 * not intend.
 */
export function parseTarget(rawNamespace: string, rawOwner: string): Target {
	// Hono percent-decodes path params. The namespace charset needs no encoding,
	// so a decoded value that is still not canonical is rejected exactly as a
	// literal one would be: this validates what the message will be built from.
	if (!isValidNamespace(rawNamespace)) {
		throw invalid(
			'invalid_namespace',
			'namespace must be 1 to 256 characters of [a-z0-9._-], and cannot be "." or ".." or start with "."',
		);
	}
	const owner = normaliseOwnerFromUrl(rawOwner);
	if (owner === null) {
		throw invalid(
			'invalid_owner',
			'owner must be "0x" followed by 40 hexadecimal characters',
		);
	}
	return {
		namespace: rawNamespace,
		owner,
		key: storageKey(rawNamespace, owner),
	};
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function handleRead(options: {
	request: Request;
	storage: Storage;
	env: Env;
	target: Target;
	/** HEAD must never read the payload, so it never calls `get` */
	bodyless: boolean;
}): Promise<Response> {
	const {request, storage, env, target, bodyless} = options;

	const token = checkReadToken({
		env,
		headers: request.headers,
		namespace: target.namespace,
		owner: target.owner,
		nowMs: Date.now(),
	});
	if (token === 'malformed') {
		throw invalid(
			'invalid_read_token',
			'the read token is malformed: Waxdb-Read-Expires must be canonical unix seconds and Waxdb-Read-Signature must be "0x" followed by 130 hexadecimal characters',
		);
	}
	// a wrong, expired or absent token is indistinguishable from absence
	if (token === 'denied') return notFound();

	const ifNoneMatch = request.headers.get('if-none-match');

	// A conditional read resolves against metadata alone, so an unchanged poll
	// never opens the payload stream. HEAD is metadata-only by definition.
	if (bodyless || ifNoneMatch !== null) {
		const meta = await storageCall(() => storage.head(target.key));
		if (meta === null) return notFound();

		if (ifNoneMatch !== null && etagMatches(ifNoneMatch, meta.counter)) {
			return notModified(meta);
		}
		if (bodyless) {
			return new Response(null, {status: 200, headers: recordHeaders(meta)});
		}
	}

	const record = await storageCall(() => storage.get(target.key));
	if (record === null) return notFound();

	// Reads stream: the stored value is piped straight to the response and never
	// buffered, so read size is bounded only by the store.
	return new Response(record.payload, {
		status: 200,
		headers: recordHeaders(record),
	});
}

function notModified(meta: Meta): Response {
	return new Response(null, {
		status: 304,
		headers: withCors(new Headers({ETag: `"${meta.counter}"`})),
	});
}

/** `*`, or any member of the list matching, with or without a weak marker */
function etagMatches(ifNoneMatch: string, counter: string): boolean {
	const target = `"${counter}"`;
	for (const raw of ifNoneMatch.split(',')) {
		const candidate = raw.trim();
		if (candidate === '*') return true;
		const strong = candidate.startsWith('W/')
			? candidate.slice(2).trim()
			: candidate;
		if (strong === target) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function handleWrite(options: {
	request: Request;
	storage: Storage;
	env: Env;
	target: Target;
	/** the verb is the intent, and it must match the intent in the message */
	intent: 'store' | 'delete';
}): Promise<Response> {
	const {request, storage, env, target, intent} = options;
	const headers = request.headers;

	// --- 1. syntax, all of it before anything expensive happens ------------

	const counter = headers.get('waxdb-counter');
	if (counter === null || !isCanonicalCounter(counter)) {
		throw invalid(
			'invalid_counter',
			'Waxdb-Counter is required and must be "0" or a decimal without leading zeros',
		);
	}

	// SPEC.md's error table says invalid_counter covers "missing or not
	// canonical" and invalid_expected covers only "not any, none or canonical".
	// That asymmetry is read as deliberate: the precondition is optional
	// (DECISIONS.md #8), so an absent header means `any`, which is what the
	// client must then have signed.
	const expected = headers.get('waxdb-expected') ?? 'any';
	if (!isValidExpected(expected)) {
		throw invalid(
			'invalid_expected',
			'Waxdb-Expected must be "any", "none", or a decimal without leading zeros',
		);
	}

	const signature = headers.get('waxdb-signature');
	if (signature === null || !isValidSignatureFormat(signature)) {
		throw invalid(
			'invalid_signature_format',
			'Waxdb-Signature is required and must be "0x" followed by 130 hexadecimal characters',
		);
	}

	// --- 2. the body, and the hash of what actually arrived -----------------

	let payload = new Uint8Array(0);
	let dataHash: string | undefined;

	if (intent === 'store') {
		const declaredHash = headers.get('waxdb-data-hash');
		if (declaredHash === null || !isValidDataHash(declaredHash)) {
			throw invalid(
				'invalid_data_hash',
				'Waxdb-Data-Hash is required on PUT and must be "0x" followed by 64 lowercase hexadecimal characters',
			);
		}

		// Writes buffer and cannot stream: verification has to precede the write
		// and the payload hash is only known once the body is consumed. This is
		// why writes carry a cap and reads do not.
		payload = await readBody(request, maxPayloadBytes(env));
		dataHash = await payloadHash(payload);

		// The header is NOT what gets signed over. The server builds the message
		// from the hash of the body it actually received, so a truncated upload
		// is reported as data_hash_mismatch rather than a misleading
		// signature_mismatch.
		if (dataHash !== declaredHash) {
			throw invalid(
				'data_hash_mismatch',
				'the request body does not hash to Waxdb-Data-Hash, which usually means a truncated or corrupted upload',
			);
		}
	}

	// --- 3. verification, BEFORE storage is consulted -----------------------

	// This order is a leak defence and it is not optional. If storage were
	// consulted first, the difference between signature_mismatch and
	// counter_not_increasing would tell an unauthenticated prober whether a
	// record exists, handing back through the write path exactly what the read
	// path refuses to say.
	const message =
		intent === 'store'
			? storeMessage({
					namespace: target.namespace,
					owner: target.owner,
					counter,
					expected,
					payloadHash: dataHash!,
				})
			: deleteMessage({
					namespace: target.namespace,
					owner: target.owner,
					counter,
					expected,
				});

	if (!verifySignature(message, signature, target.owner)) {
		throw new WaxdbError(
			'signature_mismatch',
			401,
			'the recovered signer is not the owner of this record',
		);
	}

	// --- 4. the counter ceiling --------------------------------------------

	// Consults no storage, so it is safe either side of verification; it runs
	// after so an unauthenticated caller cannot read the server's clock off it.
	const nowMs = Date.now();
	if (BigInt(counter) > BigInt(nowMs) + COUNTER_SKEW_TOLERANCE_MS) {
		throw new WaxdbError(
			'counter_in_future',
			400,
			'the counter is more than 60 seconds ahead of the server clock',
			{
				headers: {'Waxdb-Server-Time': String(nowMs)},
			},
		);
	}

	// --- 5. storage ---------------------------------------------------------

	// head, never get: checking a counter must not transfer a payload.
	const stored = await storageCall(() => storage.head(target.key));

	// Rule 1: with no record, any counter is acceptable, including 0. Rule 2: a
	// tombstone is a record, so a delete raises the bar for everything after it.
	if (stored !== null && compareCounters(counter, stored.counter) !== 1) {
		throw new WaxdbError(
			'counter_not_increasing',
			409,
			'the counter must be strictly greater than the stored one',
			{
				current: current(stored),
			},
		);
	}

	if (!preconditionHolds(expected, stored)) {
		throw new WaxdbError(
			'precondition_failed',
			409,
			expected === 'none'
				? 'the write expected no existing record'
				: `the write expected the stored counter to be exactly ${expected}`,
			{current: current(stored)},
		);
	}

	const meta: Meta =
		intent === 'store'
			? {counter, signature, deleted: false, dataHash}
			: {counter, signature, deleted: true};

	// A delete is a write, not a removal: it stores a tombstone at a higher
	// counter, signed by the owner. Removing the key would take the counter back
	// to absence and re-enable every harvested signature (DECISIONS.md #7).
	await storageCall(() => storage.put(target.key, payload, meta));

	return json({ok: true, counter, deleted: meta.deleted}, 200);
}

/**
 * `any` no precondition, `none` only if absent, otherwise an exact counter.
 *
 * Detects staleness, not races: this is a read followed by a write with no
 * atomicity between them, so two writes inside the same window can both pass.
 * It is never worse than omitting it.
 */
function preconditionHolds(expected: string, stored: Meta | null): boolean {
	if (expected === 'any') return true;
	if (expected === 'none') return stored === null;
	if (stored === null) return false;
	return compareCounters(expected, stored.counter) === 0;
}

async function readBody(
	request: Request,
	cap: number,
): Promise<Uint8Array<ArrayBuffer>> {
	const declared = request.headers.get('content-length');
	if (declared !== null) {
		const length = Number(declared);
		if (Number.isFinite(length) && length > cap) throw tooLarge(cap);
	}

	if (request.body === null) return new Uint8Array(0);

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const {done, value} = await reader.read();
		if (done) break;
		total += value.byteLength;
		// enforced against the bytes that arrive, not against Content-Length,
		// which a client is free to lie about
		if (total > cap) {
			await reader.cancel().catch(() => {});
			throw tooLarge(cap);
		}
		chunks.push(value);
	}

	const payload = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		payload.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return payload;
}

function tooLarge(cap: number): WaxdbError {
	return new WaxdbError(
		'payload_too_large',
		413,
		`the payload exceeds this deployment's limit of ${cap} bytes`,
	);
}

function maxPayloadBytes(env: Env): number {
	const configured = env.MAX_PAYLOAD_BYTES;
	if (configured === undefined) return DEFAULT_MAX_PAYLOAD_BYTES;
	const value = Number(configured);
	return Number.isFinite(value) && value >= 0
		? value
		: DEFAULT_MAX_PAYLOAD_BYTES;
}

// ---------------------------------------------------------------------------

/**
 * Wraps a storage call so no engine text ever reaches a client.
 *
 * `rate_limited` is a real path, not a theoretical one: Cloudflare KV allows
 * one write per second to the same key on every plan, and every record for one
 * `(namespace, owner)` is one key by construction, so a sync client's debounce
 * is directly exposed to it. Adapters raise {@link StorageRateLimitError} and
 * it becomes a `429` here rather than a misleading `500`.
 */
async function storageCall<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (err) {
		if (err instanceof StorageRateLimitError) {
			throw new WaxdbError(
				'rate_limited',
				429,
				'too many writes to this record; retry with exponential backoff and keep any debounce above one second',
			);
		}
		throw new WaxdbError('storage_error', 500, 'the storage backend failed');
	}
}

export {errorResponse};
