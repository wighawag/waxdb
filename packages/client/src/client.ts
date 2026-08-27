import {WaxdbError, WaxdbRateLimitError} from './errors.js';
import {
	deleteMessage,
	isCanonicalCounter,
	isValidExpected,
	isValidNamespace,
	normaliseOwner,
	payloadHash as defaultSha256,
	readMessage,
	storeMessage,
} from './protocol.js';
import type {
	Expected,
	HeadResult,
	ReadResult,
	Signer,
	WriteResult,
} from './types.js';

export type WaxdbClientOptions = {
	/** base URL of the deployment, e.g. `https://waxdb.example.workers.dev` */
	endpoint: string;
	namespace: string;
	signer: Signer;
	/** defaults to the signer's address */
	owner?: string;
	/**
	 * Whether to mint a read token per read. Defaults to true, matching the
	 * server's default. Set false only against a `PUBLIC_READS` deployment: it
	 * saves a signature per read and nothing else.
	 */
	authenticatedReads?: boolean;
	/**
	 * How long a read token is valid. Short by design: a stateless read
	 * credential is a bearer token until it expires, and the expiry is the only
	 * thing bounding a replay. Signing is sub-millisecond, so signing per read
	 * costs little, and a changing header value costs nothing because the CORS
	 * preflight cache keys on header names rather than values.
	 */
	readTokenLifetimeSeconds?: number;
	/** retries on `429`, which SPEC.md requires clients to do */
	retry?: {attempts?: number; baseDelayMs?: number};
	fetch?: typeof globalThis.fetch;
	/** override for environments without `crypto.subtle` (non-secure contexts) */
	sha256?: (payload: Uint8Array) => Promise<string>;
};

const DEFAULT_READ_TOKEN_SECONDS = 300;
const DEFAULT_RETRY_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_MS = 1100;

export class WaxdbClient {
	private readonly endpoint: string;
	private readonly namespace: string;
	private readonly signer: Signer;
	private readonly authenticatedReads: boolean;
	private readonly readTokenLifetimeSeconds: number;
	private readonly retryAttempts: number;
	private readonly retryBaseMs: number;
	private readonly doFetch: typeof globalThis.fetch;
	private readonly sha256: (payload: Uint8Array) => Promise<string>;
	private ownerPromise: Promise<string> | undefined;
	private readonly explicitOwner: string | undefined;

	constructor(options: WaxdbClientOptions) {
		if (!isValidNamespace(options.namespace)) {
			throw new WaxdbError(
				'invalid_namespace',
				0,
				`"${options.namespace}" is not a valid namespace: 1 to 255 characters of ` +
					`[a-z0-9._-], not "." or "..", not starting with "."`,
			);
		}
		this.endpoint = options.endpoint.replace(/\/$/, '');
		this.namespace = options.namespace;
		this.signer = options.signer;
		this.authenticatedReads = options.authenticatedReads ?? true;
		this.readTokenLifetimeSeconds =
			options.readTokenLifetimeSeconds ?? DEFAULT_READ_TOKEN_SECONDS;
		this.retryAttempts = options.retry?.attempts ?? DEFAULT_RETRY_ATTEMPTS;
		this.retryBaseMs = options.retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_MS;
		this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.sha256 = options.sha256 ?? defaultSha256;
		this.explicitOwner = options.owner;
	}

	/** the address whose key authorises writes, lowercase */
	async owner(): Promise<string> {
		if (!this.ownerPromise) this.ownerPromise = this.resolveOwner();
		return this.ownerPromise;
	}

	private async resolveOwner(): Promise<string> {
		const raw =
			this.explicitOwner ??
			this.signer.address ??
			(this.signer.getAddress ? await this.signer.getAddress() : undefined);
		if (raw === undefined) {
			throw new WaxdbError(
				'invalid_owner',
				0,
				'cannot determine the owner: pass `owner`, or use a signer exposing ' +
					'`address` or `getAddress()`',
			);
		}
		const owner = normaliseOwner(raw);
		if (owner === null) {
			throw new WaxdbError(
				'invalid_owner',
				0,
				`"${raw}" is not a 20-byte hex address`,
			);
		}
		return owner;
	}

	private async path(): Promise<string> {
		return `${this.endpoint}/records/${this.namespace}/${await this.owner()}`;
	}

	// --- reads --------------------------------------------------------------

	private async readHeaders(): Promise<globalThis.Record<string, string>> {
		if (!this.authenticatedReads) return {};
		const owner = await this.owner();
		const expires = String(
			Math.floor(Date.now() / 1000) + this.readTokenLifetimeSeconds,
		);
		const signature = await this.signer.signMessage(
			readMessage({namespace: this.namespace, owner, expires}),
		);
		return {
			'Waxdb-Read-Expires': expires,
			'Waxdb-Read-Signature': signature,
		};
	}

	/**
	 * Fetches the record.
	 *
	 * Pass `ifNoneMatch` with a previously seen counter to poll cheaply: an
	 * unchanged record answers `{found: true, notModified: true}` with no body.
	 */
	async get(options?: {ifNoneMatch?: string}): Promise<ReadResult> {
		const headers = await this.readHeaders();
		if (options?.ifNoneMatch !== undefined) {
			headers['If-None-Match'] = `"${options.ifNoneMatch}"`;
		}
		const response = await this.doFetch(await this.path(), {headers});

		if (response.status === 404) return {found: false};
		if (response.status === 304) {
			return {
				found: true,
				notModified: true,
				counter: unquote(response.headers.get('etag')),
			};
		}
		if (response.status !== 200) await this.throwFor(response);

		return {
			found: true,
			notModified: false,
			...metaFrom(response),
			payload: new Uint8Array(await response.arrayBuffer()),
		};
	}

	/**
	 * Metadata only, with no body.
	 *
	 * The cheap way to poll for a counter change before deciding to transfer a
	 * payload of unknown size.
	 */
	async head(): Promise<HeadResult> {
		const response = await this.doFetch(await this.path(), {
			method: 'HEAD',
			headers: await this.readHeaders(),
		});
		if (response.status === 404) return {found: false};
		if (response.status !== 200) await this.throwFor(response);
		return {found: true, ...metaFrom(response)};
	}

	// --- writes -------------------------------------------------------------

	/**
	 * Stores a payload.
	 *
	 * `counter` defaults to the current time in milliseconds, which satisfies
	 * the rules and interoperates with a plain `stored + 1` convention. It must
	 * strictly exceed the stored counter and must not exceed the server's clock
	 * by more than 60 seconds.
	 */
	async put(
		payload: Uint8Array,
		options?: {counter?: string; expected?: Expected},
	): Promise<WriteResult> {
		const counter = options?.counter ?? String(Date.now());
		const expected = options?.expected ?? 'any';
		this.assertWriteFields(counter, expected);

		const owner = await this.owner();
		const dataHash = await this.sha256(payload);
		const signature = await this.signer.signMessage(
			storeMessage({
				namespace: this.namespace,
				owner,
				counter,
				expected,
				payloadHash: dataHash,
			}),
		);

		return this.write({
			method: 'PUT',
			headers: {
				'Content-Type': 'application/octet-stream',
				'Waxdb-Counter': counter,
				'Waxdb-Expected': expected,
				'Waxdb-Data-Hash': dataHash,
				'Waxdb-Signature': signature,
			},
			body: payload,
		});
	}

	/**
	 * Writes a tombstone.
	 *
	 * Not a removal: a tombstone is a record with a real counter and a real
	 * signature, so it raises the bar for every write after it. That is what
	 * stops a deletion re-enabling every previously captured signature.
	 */
	async delete(options?: {
		counter?: string;
		expected?: Expected;
	}): Promise<WriteResult> {
		const counter = options?.counter ?? String(Date.now());
		const expected = options?.expected ?? 'any';
		this.assertWriteFields(counter, expected);

		const owner = await this.owner();
		const signature = await this.signer.signMessage(
			deleteMessage({namespace: this.namespace, owner, counter, expected}),
		);

		return this.write({
			method: 'DELETE',
			headers: {
				'Waxdb-Counter': counter,
				'Waxdb-Expected': expected,
				'Waxdb-Signature': signature,
			},
		});
	}

	private assertWriteFields(counter: string, expected: string): void {
		// caught here rather than at the server, because a non-canonical value
		// would be signed into the message and come back as signature_mismatch,
		// which says nothing useful about what went wrong
		if (!isCanonicalCounter(counter)) {
			throw new WaxdbError(
				'invalid_counter',
				0,
				`"${counter}" is not a canonical counter: "0", or digits without a leading zero`,
			);
		}
		if (!isValidExpected(expected)) {
			throw new WaxdbError(
				'invalid_expected',
				0,
				`"${expected}" is not a valid precondition: "any", "none", or a canonical counter`,
			);
		}
	}

	private async write(request: {
		method: string;
		headers: globalThis.Record<string, string>;
		body?: Uint8Array;
	}): Promise<WriteResult> {
		const url = await this.path();

		for (let attempt = 0; ; attempt++) {
			const response = await this.doFetch(url, {
				method: request.method,
				headers: request.headers,
				body: request.body as BodyInit | undefined,
			});

			if (response.status === 200) {
				const body = (await response.json()) as {
					counter: string;
					deleted: boolean;
				};
				return {ok: true, counter: body.counter, deleted: body.deleted};
			}

			// a conflict is a result, not a failure: the caller needs `current`
			if (response.status === 409) {
				const body = (await response.json()) as {
					error: {
						code: 'counter_not_increasing' | 'precondition_failed';
						message: string;
					};
					current: WriteResult extends {ok: false; current: infer C}
						? C
						: never;
				};
				return {ok: false, error: body.error, current: body.current};
			}

			// SPEC.md requires clients to retry a rate limit with backoff. One
			// write per second per key is a platform limit, so a debounce above a
			// second is the real fix and this is the safety net.
			if (response.status === 429 && attempt < this.retryAttempts) {
				await response.body?.cancel().catch(() => {});
				await sleep(this.retryBaseMs * 2 ** attempt);
				continue;
			}

			await this.throwFor(response);
		}
	}

	private async throwFor(response: Response): Promise<never> {
		let code = 'unexpected_response';
		let message = `waxdb answered ${response.status}`;
		try {
			const body = (await response.json()) as {
				error?: {code?: string; message?: string};
			};
			if (body.error?.code) code = body.error.code;
			if (body.error?.message) message = body.error.message;
		} catch {
			// a non-JSON body from a proxy or gateway; keep the generic message
		}
		if (response.status === 429) throw new WaxdbRateLimitError(message);
		throw new WaxdbError(code, response.status, message);
	}
}

function metaFrom(response: Response) {
	const dataHash = response.headers.get('waxdb-data-hash');
	return {
		counter: response.headers.get('waxdb-counter') ?? '',
		signature: response.headers.get('waxdb-signature') ?? '',
		deleted: response.headers.get('waxdb-deleted') === 'true',
		...(dataHash === null ? {} : {dataHash}),
	};
}

function unquote(etag: string | null): string {
	if (etag === null) return '';
	return etag.replace(/^W\//, '').replace(/^"|"$/g, '');
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
