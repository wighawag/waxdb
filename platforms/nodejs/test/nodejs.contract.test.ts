/**
 * The contract, run against the Node platform: once over an in-memory
 * polystore, once over a real JSON file on disk, since the file-backed store is
 * what other projects will actually use offline.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer, type Env} from 'secp256k1-db-server';
import {
	runContractTests,
	type ContractHarness,
} from '../../../packages/server/test/contract/contract.js';
import {createStorage} from '../src/storage.js';

const ADMIN_TOKEN = 'super-secret-admin-token';

function createHarness(name: string, location: string): ContractHarness {
	const storage = createStorage(location);
	const env: Env = {TOKEN_ADMIN: ADMIN_TOKEN};
	const app = createServer<Env>({
		getStorage: () => storage,
		getEnv: () => env,
	});

	return {
		name,
		adminToken: ADMIN_TOKEN,
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
				return new Response(String(e), {status: 500});
			}
		},
	};
}

const tmpFile = path.join(
	fs.mkdtempSync(path.join(os.tmpdir(), 'secp256k1-db-')),
	'data.json',
);

runContractTests(createHarness('nodejs (memory)', ':memory:'));
runContractTests(createHarness('nodejs (file)', tmpFile));
