/**
 * Errors the caller cannot converge from.
 *
 * The two `409`s are deliberately *not* here: a rejected write is the normal
 * outcome of two devices disagreeing, so it comes back as a `WriteResult` with
 * `ok: false` and the current record attached. Everything else is either a bug
 * in the caller, a misconfiguration, or an operational condition, and throwing
 * is the honest response.
 */
export class WaxdbError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(code: string, status: number, message: string) {
		super(message);
		this.name = 'WaxdbError';
		this.code = code;
		this.status = status;
	}
}

/**
 * The store refused the write rate.
 *
 * Cloudflare KV allows one write per second to a single key, and every record
 * is one key by construction, so a sync client's debounce is directly exposed
 * to it. The client retries with backoff; this is thrown only once the retries
 * are exhausted, and the right fix is a debounce comfortably above one second
 * rather than more retries.
 */
export class WaxdbRateLimitError extends WaxdbError {
	constructor(message: string) {
		super('rate_limited', 429, message);
		this.name = 'WaxdbRateLimitError';
	}
}
