/**
 * A harness is any way of talking to a running instance of the service.
 *
 * The same `runContractTests(harness)` runs against all three, which is the
 * entire reason the core takes `getStorage` and `getEnv` callbacks instead of
 * touching a platform API:
 *
 *  - the platform-agnostic server in-process, over an in-memory `Storage`
 *  - the Cloudflare worker on real workerd, over a miniflare-backed KV binding
 *  - the Node platform, over both of its backends
 *
 * The CLI is not a mock, and this is what makes that claim checkable rather
 * than aspirational.
 */
export type RequestInit = {
	method: string;
	/** path plus query, e.g. `/records/ns/0x…` */
	path: string;
	headers?: Record<string, string>;
	body?: BodyInit | null;
};

export type ContractHarness = {
	name: string;
	/**
	 * Whether this instance runs with `PUBLIC_READS`. Read tests need a token
	 * when it is false and must succeed without one when it is true, so the
	 * suite runs twice per platform.
	 */
	publicReads: boolean;
	/** the deployment's write cap, so the size tests know where the edge is */
	maxPayloadBytes: number;
	/**
	 * Whether the backing store is eventually consistent, i.e. a write is not
	 * guaranteed to be visible to the next read.
	 *
	 * True for real Cloudflare KV and false for every local backend, which is
	 * why this has to be declared rather than assumed. When set, `seed()` waits
	 * for a record to become observable before a test proceeds, so that an
	 * assertion about protocol logic is not silently testing propagation delay.
	 *
	 * It does not weaken any assertion. It only removes the ambiguity between
	 * "the server failed to enforce the counter rule" and "the server had not
	 * seen the record yet", which are very different bugs and look identical
	 * from the outside.
	 */
	eventuallyConsistent?: boolean;
	fetch(init: RequestInit): Promise<Response>;
};
