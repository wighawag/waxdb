/**
 * OPT-IN conformance run against a *deployed* instance.
 *
 * It proves that the contract captured by `handler.contract.test.ts` /
 * `worker.contract.test.ts` is really what production serves today, and later
 * that a redeployed (rewritten) service still serves it.
 *
 *     LIVE_URL=https://secp256k1-kv-db.rim.workers.dev pnpm test:live
 *
 * WARNING: this WRITES to the target instance (records under freshly generated
 * random addresses in unique namespaces, so nothing existing is touched).
 * It is skipped unless LIVE_URL is set.
 */
import { describe, it } from 'vitest';
import { runContractTests, type ContractHarness } from './support/contract';

const LIVE_URL = process.env.LIVE_URL;
const RESET_IMPLEMENTED = process.env.LIVE_RESET === 'true';

if (!LIVE_URL) {
	describe('live conformance', () => {
		it.skip('set LIVE_URL to run the contract against a deployed instance', () => {});
	});
} else {
	const harness: ContractHarness = {
		name: `live ${LIVE_URL}`,
		// no admin token: never exercise the destructive admin path against a
		// deployment we do not own the state of
		adminToken: undefined,
		// the currently live worker predates commit b7b11d5 ("add reset
		// capabilities"): it answers `"reset" not supported`. Flip to true (or
		// drop) once a build that has the method is deployed.
		resetImplemented: RESET_IMPLEMENTED,
		async raw(init) {
			return fetch(new URL(init.path ?? '/', LIVE_URL), {
				method: init.method,
				body: init.body,
				headers: init.headers,
			});
		},
	};

	runContractTests(harness);
}
