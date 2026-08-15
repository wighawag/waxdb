/**
 * Runs the same behavioural contract against the real worker on workerd
 * (wrangler unstable_dev), so runtime-level details (status codes, header
 * casing, error bodies produced by the Workers runtime) are pinned too.
 *
 * Storage-level assertions are skipped here: the local KV of the dev worker is
 * not directly reachable from the test. Those are covered by
 * `handler.contract.test.ts`.
 */
import { afterAll, beforeAll } from 'vitest';
import type { Unstable_DevWorker } from 'wrangler';
import { unstable_dev } from 'wrangler';
import { runContractTests, type ContractHarness } from './support/contract';

const ADMIN_TOKEN = 'super-secret-admin-token';

let worker: Unstable_DevWorker;

beforeAll(async () => {
	worker = await unstable_dev('src/index.ts', {
		experimental: { disableExperimentalWarning: true },
		vars: { TOKEN_ADMIN: ADMIN_TOKEN },
	});
}, 60000);

afterAll(async () => {
	await worker?.stop();
});

const harness: ContractHarness = {
	name: 'worker',
	adminToken: ADMIN_TOKEN,
	async raw(init) {
		return (await worker.fetch(`http://example.com${init.path ?? '/'}`, {
			method: init.method,
			body: init.body,
			headers: init.headers,
		})) as unknown as Response;
	},
};

runContractTests(harness);
