/**
 * Spawns the built CLI the way another project would use it offline, and checks
 * the one thing the in-process contract cannot: that data written by one run is
 * still there after a restart.
 */
import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Wallet} from '@ethersproject/wallet';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

const packageDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(packageDir, 'dist', 'cli.js');
const ADMIN_TOKEN = 'super-secret-admin-token';
const PORT = 34571;
const db = path.join(
	fs.mkdtempSync(path.join(os.tmpdir(), 'secp256k1-db-cli-')),
	'data.json',
);

let server: ChildProcess | undefined;

async function start(...extraArgs: string[]) {
	server = spawn(
		'node',
		[
			cli,
			'--port',
			String(PORT),
			'--db',
			db,
			'--token-admin',
			ADMIN_TOKEN,
			...extraArgs,
		],
		{stdio: 'ignore'},
	);
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		try {
			await fetch(`http://localhost:${PORT}/`, {method: 'GET'});
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

const post = (body: unknown, headers?: Record<string, string>) =>
	fetch(`http://localhost:${PORT}/`, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	}).then((r) => r.json() as Promise<any>);

describe('cli', () => {
	const wallet = Wallet.createRandom();
	const namespace = 'cli-smoke';
	const counter = (Date.now() - 1000).toString();
	const data = 'survives a restart';

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

	it('serves the usage hint on GET', async () => {
		const response = await fetch(`http://localhost:${PORT}/`, {method: 'GET'});
		expect(await response.text()).toBe('please use jsonrpc POST request');
	});

	it('stores a signed value', async () => {
		const signature = await wallet.signMessage(
			`put:${namespace}:${counter}:${data}`,
		);
		const result = await post({
			jsonrpc: '2.0',
			id: 1,
			method: 'wallet_putString',
			params: [wallet.address, namespace, counter, data, signature],
		});
		expect(result.result.success).toBe(true);
	});

	it('still has the value after a restart', async () => {
		await stop();
		await start();
		const result = await post({
			jsonrpc: '2.0',
			id: 2,
			method: 'wallet_getString',
			params: [wallet.address, namespace],
		});
		expect(result.result.data).toBe(data);
		expect(result.result.counter).toBe(counter);
	}, 30000);

	it('empties the store on --clear, and only then', async () => {
		// re-seed, since the previous test left the record in place
		const signature = await wallet.signMessage(
			`put:${namespace}:${counter}:${data}`,
		);
		await post({
			jsonrpc: '2.0',
			id: 5,
			method: 'wallet_putString',
			params: [wallet.address, namespace, counter, data, signature],
		});

		// a plain restart keeps it
		await stop();
		await start();
		expect(
			(
				await post({
					jsonrpc: '2.0',
					id: 6,
					method: 'wallet_getString',
					params: [wallet.address, namespace],
				})
			).result.data,
		).toBe(data);

		// --clear drops it
		await stop();
		await start('--clear');
		expect(
			(
				await post({
					jsonrpc: '2.0',
					id: 7,
					method: 'wallet_getString',
					params: [wallet.address, namespace],
				})
			).result,
		).toEqual({data: '', counter: '0', signature: ''});

		// and the cleared store is writable again, from counter 1 up
		const reSignature = await wallet.signMessage(
			`put:${namespace}:1:after-clear`,
		);
		const rewritten = await post({
			jsonrpc: '2.0',
			id: 8,
			method: 'wallet_putString',
			params: [wallet.address, namespace, '1', 'after-clear', reSignature],
		});
		expect(rewritten.result.success).toBe(true);
	}, 60000);

	it('resets with the admin token', async () => {
		const reset = await post(
			{
				jsonrpc: '2.0',
				id: 3,
				method: 'reset',
				params: [wallet.address, namespace],
			},
			{TOKEN: ADMIN_TOKEN},
		);
		expect(reset.result).toEqual({ok: true});

		const after = await post({
			jsonrpc: '2.0',
			id: 4,
			method: 'wallet_getString',
			params: [wallet.address, namespace],
		});
		expect(after.result).toEqual({data: '', counter: '0', signature: ''});
	});
});
