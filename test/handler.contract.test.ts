/**
 * Runs the behavioural contract against the current handler in-process, with an
 * in-memory KV. This gives full visibility on what is actually persisted, which
 * is what the live Cloudflare KV namespace already contains.
 */
import { handleRPC } from '../src/handler';
import { MemoryKV } from './support/memory-kv';
import { runContractTests, type ContractHarness } from './support/contract';

const ADMIN_TOKEN = 'super-secret-admin-token';

function createHarness(options: { adminToken?: string }): ContractHarness {
	const kv = new MemoryKV();
	const env = {
		PRIVATE_STORE: kv,
		TOKEN_ADMIN: options.adminToken,
	} as any;

	return {
		name: options.adminToken ? 'handler' : 'handler (no TOKEN_ADMIN)',
		adminToken: options.adminToken,
		kv,
		async raw(init) {
			const request = new Request('http://localhost/', {
				method: init.method,
				body: init.body,
				headers: init.headers,
			});
			try {
				return await handleRPC(request as any, env);
			} catch (e: any) {
				// workerd turns an uncaught throw into a 500; mirror that here so the
				// same contract can run against both harnesses.
				return new Response(String(e), { status: 500 });
			}
		},
	};
}

runContractTests(createHarness({ adminToken: ADMIN_TOKEN }));
runContractTests(createHarness({}));
