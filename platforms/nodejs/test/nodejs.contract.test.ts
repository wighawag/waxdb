/**
 * The contract, against the Node platform's two backends.
 *
 * The directory backend is the one another project actually uses offline, so it
 * runs the full contract rather than a subset. That is the whole claim the CLI
 * makes: it is not a mock, it answers what the deployed service answers,
 * because this file and the worker's run the same assertions.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll} from 'vitest';
import {createServer, type Env} from 'waxdb-server';
import {runContractTests} from '../../../packages/server/test/contract/contract.js';
import type {ContractHarness} from '../../../packages/server/test/contract/harness.js';
import {createStorage} from '../src/storage.js';

const MAX_PAYLOAD_BYTES = 256 * 1024;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'waxdb-contract-'));

afterAll(() => {
	fs.rmSync(root, {recursive: true, force: true});
});

function createHarness(options: {
	label: string;
	location: string;
	publicReads: boolean;
}): ContractHarness {
	const storage = createStorage(options.location);
	const env: Env = {
		MAX_PAYLOAD_BYTES: String(MAX_PAYLOAD_BYTES),
		...(options.publicReads ? {PUBLIC_READS: 'true'} : {}),
	};
	const app = createServer<Env>({
		getStorage: () => storage,
		getEnv: () => env,
	});

	return {
		name: `nodejs (${options.label}${options.publicReads ? ', PUBLIC_READS' : ''})`,
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
				return new Response(String(e), {status: 500});
			}
		},
	};
}

for (const publicReads of [false, true]) {
	runContractTests(
		createHarness({label: 'memory', location: ':memory:', publicReads}),
	);
	runContractTests(
		createHarness({
			label: 'directory',
			location: path.join(root, publicReads ? 'public' : 'private'),
			publicReads,
		}),
	);
}
