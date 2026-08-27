/**
 * The contract, on real workerd against a real (miniflare-backed) KV binding.
 *
 * This is the harness that proves the Cloudflare adapter satisfies the same
 * contract as everything else: metadata through KV metadata, the payload as the
 * value verbatim, `head` answered from a listing rather than a read.
 *
 * `cloudflare:test` gives the actual binding, with isolated local storage, so
 * no real namespace is ever touched.
 */
import {env} from 'cloudflare:test';
import worker from '../src/worker.js';
import {runContractTests} from '../../../packages/server/test/contract/contract.js';
import type {ContractHarness} from '../../../packages/server/test/contract/harness.js';

const MAX_PAYLOAD_BYTES = 256 * 1024;

function createHarness(options: {publicReads: boolean}): ContractHarness {
	// spread rather than mutate: the KV binding survives, and the two variants
	// cannot see each other's configuration
	const scopedEnv = {
		...env,
		MAX_PAYLOAD_BYTES: String(MAX_PAYLOAD_BYTES),
		...(options.publicReads ? {PUBLIC_READS: 'true'} : {}),
	};

	return {
		name: options.publicReads ? 'cf-worker (PUBLIC_READS)' : 'cf-worker',
		publicReads: options.publicReads,
		maxPayloadBytes: MAX_PAYLOAD_BYTES,
		async fetch(init) {
			const request = new Request(`http://example.com${init.path}`, {
				method: init.method,
				headers: init.headers,
				body: init.body ?? undefined,
			});
			try {
				return await worker.fetch(
					request,
					scopedEnv as never,
					{
						waitUntil() {},
						passThroughOnException() {},
					} as never,
				);
			} catch (e) {
				return new Response(String(e), {status: 500});
			}
		},
	};
}

runContractTests(createHarness({publicReads: false}));
runContractTests(createHarness({publicReads: true}));
