/**
 * The contract, run in-process against the platform-agnostic server with an
 * in-memory Storage. This is the layer that pins the exact bytes written to
 * storage, so it is the one that guarantees the 2594 live records stay
 * readable.
 */
import {createServer} from '../src/index.js';
import {Env} from '../src/env.js';
import {MemoryStorage} from './contract/memory-storage.js';
import {runContractTests, type ContractHarness} from './contract/contract.js';

const ADMIN_TOKEN = 'super-secret-admin-token';

function createHarness(options: {adminToken?: string}): ContractHarness {
	const storage = new MemoryStorage();
	const env: Env = {TOKEN_ADMIN: options.adminToken};
	const app = createServer<Env>({
		getStorage: () => storage,
		getEnv: () => env,
	});

	return {
		name: options.adminToken ? 'server' : 'server (no TOKEN_ADMIN)',
		adminToken: options.adminToken,
		storage,
		async raw(init) {
			const request = new Request(`http://localhost${init.path ?? '/'}`, {
				method: init.method,
				body: init.body,
				headers: init.headers,
			});
			try {
				return await app.fetch(request);
			} catch (e: any) {
				// workerd turns an uncaught throw into a 500; mirror that here so the
				// same contract can run against both harnesses.
				return new Response(String(e), {status: 500});
			}
		},
	};
}

runContractTests(createHarness({adminToken: ADMIN_TOKEN}));
runContractTests(createHarness({}));
