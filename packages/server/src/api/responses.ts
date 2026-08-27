/**
 * Response construction, including CORS (SPEC.md, "HTTP API").
 */
import type {Meta} from '../storage.js';
import type {CurrentRecord, WaxdbError} from './errors.js';

/**
 * Sent on every request and every response.
 *
 * **`Expose-Headers` is not optional and must list every `Waxdb-*` response
 * header plus `ETag`.** Without it browser JavaScript can read none of them,
 * and the response headers are where the entire record lives: the counter a
 * client needs to write again, the signature, the payload hash. A read would
 * succeed and be useless.
 */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,HEAD,PUT,DELETE,OPTIONS',
	'Access-Control-Allow-Headers': [
		'Content-Type',
		'If-None-Match',
		'Waxdb-Counter',
		'Waxdb-Expected',
		'Waxdb-Signature',
		'Waxdb-Data-Hash',
		'Waxdb-Read-Expires',
		'Waxdb-Read-Signature',
	].join(','),
	'Access-Control-Expose-Headers': [
		'ETag',
		'Waxdb-Counter',
		'Waxdb-Signature',
		'Waxdb-Data-Hash',
		'Waxdb-Deleted',
		'Waxdb-Server-Time',
	].join(','),
	'Access-Control-Max-Age': '86400',
};

export function withCors(headers: Headers): Headers {
	for (const [name, value] of Object.entries(CORS_HEADERS)) {
		headers.set(name, value);
	}
	return headers;
}

/** SPEC.md writes the content type as exactly `application/json` */
const JSON_CONTENT_TYPE = 'application/json';

export function json(
	body: unknown,
	status: number,
	extraHeaders?: Record<string, string>,
): Response {
	const headers = new Headers({'Content-Type': JSON_CONTENT_TYPE});
	for (const [name, value] of Object.entries(extraHeaders ?? {})) {
		headers.set(name, value);
	}
	return new Response(JSON.stringify(body), {
		status,
		headers: withCors(headers),
	});
}

export function errorResponse(error: WaxdbError): Response {
	const body: {
		ok: false;
		error: {code: string; message: string};
		current?: CurrentRecord;
	} = {
		ok: false,
		error: {code: error.code, message: error.message},
	};
	// only the two 409s carry it, and a response never has both a result and an
	// error, so `ok` stays false and there is no success field alongside
	if (error.current !== undefined) body.current = error.current;
	return json(body, error.status, error.headers);
}

/**
 * Absence.
 *
 * `404` with `{"found": false}` and **no `error` field**: absence is an answer,
 * not a failure. The status code is forced by the success body being the
 * payload, which leaves nowhere else to say it.
 *
 * This is also what a wrong, expired or absent read token returns, byte for
 * byte. A `401` there would tell an unauthenticated prober that a record
 * exists, which is exactly the metadata the token protects.
 */
export function notFound(): Response {
	return json({found: false}, 404);
}

/** the headers that carry a record, shared by `GET` and `HEAD` */
export function recordHeaders(meta: Meta): Headers {
	const headers = new Headers({
		'Content-Type': 'application/octet-stream',
		ETag: `"${meta.counter}"`,
		'Cache-Control': 'no-cache',
		'Waxdb-Counter': meta.counter,
		'Waxdb-Signature': meta.signature,
		'Waxdb-Deleted': meta.deleted ? 'true' : 'false',
	});
	// A tombstone is authorised by the `waxdb delete` message, which has no
	// `Data:` line, so there is no signed payload hash to report. Sending
	// SHA-256 of empty would be reporting a hash nobody signed.
	if (meta.dataHash !== undefined) {
		headers.set('Waxdb-Data-Hash', meta.dataHash);
	}
	return withCors(headers);
}

export function current(meta: Meta | null): CurrentRecord {
	return meta === null
		? {found: false}
		: {found: true, counter: meta.counter, deleted: meta.deleted};
}
