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
	fetch(init: RequestInit): Promise<Response>;
};
