/**
 * The contract, in-process against the platform-agnostic server over an
 * in-memory `Storage`.
 *
 * This is the fastest of the three harnesses and the one that pins the core's
 * behaviour independent of any platform. The other two prove the adapters
 * satisfy the same contract.
 */
import {createServer} from '../src/index.js';
import type {Env} from '../src/env.js';
import {MemoryStorage} from './contract/memory-storage.js';
import {runContractTests} from './contract/contract.js';
import type {ContractHarness} from './contract/harness.js';

const MAX_PAYLOAD_BYTES = 256 * 1024;

function createHarness(options: {publicReads: boolean}): ContractHarness {
	const storage = new MemoryStorage();
	const env: Env = {
		MAX_PAYLOAD_BYTES: String(MAX_PAYLOAD_BYTES),
		...(options.publicReads ? {PUBLIC_READS: 'true'} : {}),
	};
	const app = createServer<Env>({
		getStorage: () => storage,
		getEnv: () => env,
	});

	return {
		name: options.publicReads ? 'server (PUBLIC_READS)' : 'server',
		publicReads: options.publicReads,
		maxPayloadBytes: MAX_PAYLOAD_BYTES,
		async fetch(init) {
			const request = new Request(`http://localhost${init.path}`, {
				method: init.method,
				headers: init.headers,
				body: init.body ?? undefined,
			});
			try {
				return await app.fetch(request);
			} catch (e) {
				// workerd turns an uncaught throw into a 500; mirror that so the
				// same contract can run against every harness
				return new Response(String(e), {status: 500});
			}
		},
	};
}

runContractTests(createHarness({publicReads: false}));
runContractTests(createHarness({publicReads: true}));
