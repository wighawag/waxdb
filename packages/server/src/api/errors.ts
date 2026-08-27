/**
 * The error shape (SPEC.md, "Errors").
 *
 * One shape for every failure:
 *
 * ```json
 * {"ok": false, "error": {"code": "…", "message": "…"}}
 * ```
 *
 * This closes three of the predecessor's issues at once (DECISIONS.md #9): it
 * put thrown values straight into the response, so half arrived as `{}` with no
 * message and the rest as interpolated strings carrying engine text, and a
 * rejected write came back carrying both a result and an error.
 *
 * **Messages are written for a human reading a log.** No engine text, no stack
 * traces, no parser exception ever reaches a client.
 */

export type ErrorCode =
	| 'invalid_namespace'
	| 'invalid_owner'
	| 'invalid_counter'
	| 'invalid_expected'
	| 'invalid_signature_format'
	| 'invalid_read_token'
	| 'invalid_data_hash'
	| 'data_hash_mismatch'
	| 'counter_in_future'
	| 'signature_mismatch'
	| 'not_found'
	| 'method_not_allowed'
	| 'counter_not_increasing'
	| 'precondition_failed'
	| 'payload_too_large'
	| 'rate_limited'
	| 'storage_error';

/** the record that blocked a write, in the same shape a read reports absence */
export type CurrentRecord =
	{found: true; counter: string; deleted: boolean} | {found: false};

export class WaxdbError extends Error {
	readonly code: ErrorCode;
	readonly status: number;
	/**
	 * Only on the two `409`s. It lets a client converge without a second round
	 * trip, which is why a rejected write is a normal outcome rather than an
	 * error in a sync protocol.
	 */
	readonly current?: CurrentRecord;
	/** extra response headers, e.g. `Waxdb-Server-Time` on `counter_in_future` */
	readonly headers?: Record<string, string>;

	constructor(
		code: ErrorCode,
		status: number,
		message: string,
		options?: {current?: CurrentRecord; headers?: Record<string, string>},
	) {
		super(message);
		this.name = 'WaxdbError';
		this.code = code;
		this.status = status;
		this.current = options?.current;
		this.headers = options?.headers;
	}
}

export const invalid = (code: ErrorCode, message: string) =>
	new WaxdbError(code, 400, message);
