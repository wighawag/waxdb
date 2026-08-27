/**
 * Spawns the built CLI the way another project would use it offline.
 *
 * The contract suite runs the Node platform in-process, so it proves the
 * protocol. This proves the two things it structurally cannot: that the process
 * starts from a real `--db` directory, and that data written by one run is
 * still there after a restart. That is the whole promise of the offline
 * development path.
 */
import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
	bytes,
	sha256Hex,
	signReadToken,
	signStore,
	uniqueNamespace,
	Wallet,
} from '../../../packages/server/test/contract/client.js';

const packageDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
);
const cli = path.join(packageDir, 'dist', 'cli.js');
const PORT = 34573;
const base = `http://localhost:${PORT}`;
const db = path.join(
	fs.mkdtempSync(path.join(os.tmpdir(), 'waxdb-cli-')),
	'store',
);

let server: ChildProcess | undefined;

/**
 * Every request in this file goes through here, and it always asks for the
 * connection to be closed.
 *
 * This test deliberately kills its server several times. HTTP keep-alive means
 * the client would otherwise pool a socket to a process that no longer exists,
 * and the next request reuses that half-open socket and waits on it forever:
 * not a connection refused, which would retry, but a hang that only surfaces as
 * a test timeout. The abort signal is the second line of defence, so a single
 * stuck request can never outlive the readiness loop's own deadline.
 */
async function request(
	path: string,
	init: {
		method?: string;
		headers?: Record<string, string>;
		body?: BodyInit;
	} = {},
	timeoutMs = 5000,
): Promise<Response> {
	return fetch(`${base}${path}`, {
		method: init.method,
		headers: {...init.headers, connection: 'close'},
		body: init.body,
		signal: AbortSignal.timeout(timeoutMs),
	});
}

async function start(...extraArgs: string[]) {
	server = spawn(
		'node',
		[cli, '--port', String(PORT), '--db', db, ...extraArgs],
		{
			stdio: 'ignore',
		},
	);
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		try {
			const response = await request('/', {}, 1000);
			await response.arrayBuffer();
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	throw new Error('CLI did not start');
}

async function stop() {
	if (!server) return;
	const stopped = new Promise((r) => server!.once('exit', r));
	server.kill();
	await stopped;
	server = undefined;
}

describe('cli', () => {
	const wallet = Wallet.createRandom();
	const owner = wallet.address.toLowerCase();
	const namespace = uniqueNamespace('cli');
	const payload = bytes('survives a restart');

	beforeAll(async () => {
		expect(
			fs.existsSync(cli),
			`${cli} is missing, run \`pnpm build\` first`,
		).toBe(true);
		await start();
	}, 30000);

	afterAll(async () => {
		await stop();
		fs.rmSync(path.dirname(db), {recursive: true, force: true});
	});

	const recordPath = () => `/records/${namespace}/${owner}`;

	async function read() {
		return request(recordPath(), {
			headers: await signReadToken(wallet, {namespace}),
		});
	}

	async function readAnonymously() {
		return request(recordPath());
	}

	async function write(counter: string, body: Uint8Array) {
		const signed = await signStore(wallet, {namespace, counter, payload: body});
		return request(recordPath(), {
			method: 'PUT',
			headers: signed.headers,
			body: signed.body,
		});
	}

	it('creates the store directory', () => {
		expect(fs.existsSync(db)).toBe(true);
		expect(fs.statSync(db).isDirectory()).toBe(true);
	});

	it('stores a signed record', async () => {
		const response = await write('1000', payload);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			counter: '1000',
			deleted: false,
		});
	});

	/**
	 * The payload is an ordinary file and the metadata a small JSON sidecar, at
	 * a path mirroring the storage key. That is more inspectable than the JSON
	 * blob it replaced, and it is what lets reads stream.
	 */
	it('writes the payload as a plain file plus a sidecar', async () => {
		const payloadFile = path.join(db, namespace, owner);
		const sidecar = `${payloadFile}.json`;

		expect(fs.existsSync(payloadFile), payloadFile).toBe(true);
		expect(fs.existsSync(sidecar), sidecar).toBe(true);

		// verbatim, no base64 and no envelope
		expect(new Uint8Array(fs.readFileSync(payloadFile))).toEqual(payload);

		const meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
		expect(meta.counter).toBe('1000');
		expect(meta.deleted).toBe(false);
		expect(meta.dataHash).toBe(await sha256Hex(payload));
		expect(meta.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
	});

	it('still has the record after a restart', async () => {
		await stop();
		await start();

		const response = await read();
		expect(response.status).toBe(200);
		expect(response.headers.get('waxdb-counter')).toBe('1000');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
	}, 30000);

	it('still enforces the counter after a restart', async () => {
		const response = await write('999', bytes('stale'));
		expect(response.status).toBe(409);
		const body = await response.json();
		expect(body.error.code).toBe('counter_not_increasing');
		// the high-water mark came back from disk, not from memory
		expect(body.current).toEqual({
			found: true,
			counter: '1000',
			deleted: false,
		});
	});

	it('empties the store on --clear, and only then', async () => {
		await stop();
		await start();
		const beforeClear = await read();
		expect(beforeClear.status).toBe(200);
		await beforeClear.arrayBuffer();

		await stop();
		await start('--clear');
		const cleared = await read();
		expect(cleared.status).toBe(404);
		expect(await cleared.json()).toEqual({found: false});

		// and a cleared store is writable again from any counter
		const rewritten = await write('1', bytes('after clear'));
		expect(rewritten.status).toBe(200);
		await rewritten.arrayBuffer();
	}, 60000);

	it('serves public reads when asked', async () => {
		await stop();
		await start('--public-reads');

		const anonymous = await readAnonymously();
		expect(anonymous.status).toBe(200);
		expect(await anonymous.text()).toBe('after clear');
	}, 30000);

	it('authenticates reads by default', async () => {
		await stop();
		await start();

		const anonymous = await readAnonymously();
		expect(anonymous.status).toBe(404);
		expect(await anonymous.json()).toEqual({found: false});
	}, 30000);
});
