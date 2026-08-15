/**
 * The contract, run on real workerd against a real (miniflare-backed) KV
 * namespace. Because `cloudflare:test` hands us the actual binding, the
 * storage-level assertions run here too: this is what proves the Cloudflare
 * adapter writes the exact bytes the live namespace already contains.
 */
import {env} from 'cloudflare:test';
import worker from '../src/worker.js';
import {
	runContractTests,
	type ContractHarness,
} from '../../../packages/server/test/contract/contract.js';

const ADMIN_TOKEN = 'super-secret-admin-token';

(env as any).TOKEN_ADMIN = ADMIN_TOKEN;

const harness: ContractHarness = {
	name: 'cf-worker',
	adminToken: ADMIN_TOKEN,
	storage: {
		get: (key) => env.PRIVATE_STORE.get(key),
		put: (key, value) => env.PRIVATE_STORE.put(key, value),
	},
	async raw(init) {
		const request = new Request(`http://example.com${init.path ?? '/'}`, {
			method: init.method,
			body: init.body,
			headers: init.headers,
		});
		try {
			return await worker.fetch(request, env as any, {
				waitUntil() {},
				passThroughOnException() {},
			} as any);
		} catch (e: any) {
			return new Response(String(e), {status: 500});
		}
	},
};

runContractTests(harness);
