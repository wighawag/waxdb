/**
 * The client against a real server.
 *
 * `@waxdb/server` is a devDependency here, used only to stand a server up in
 * this process. Nothing in the published package imports it, so the MIT
 * distribution contains no AGPL code: testing against software is not
 * deriving from it.
 *
 * That arrangement is exactly what makes these tests worth having. The client
 * builds every message from its own implementation, and the server verifies
 * with its own. A round trip passing here means two independent codebases
 * agree, which is the only kind of agreement worth asserting.
 */
import {Wallet} from '@ethersproject/wallet';
import {beforeEach, describe, expect, it} from 'vitest';
import {createServer, type Env, type Meta, type Storage} from '@waxdb/server';
import {WaxdbClient} from '../src/client.js';
import {WaxdbError} from '../src/errors.js';

class MemoryStorage implements Storage {
	readonly records = new Map<string, {payload: Uint8Array; meta: Meta}>();

	async head(key: string) {
		return this.records.get(key)?.meta ?? null;
	}
	async get(key: string) {
		const found = this.records.get(key);
		if (!found) return null;
		const payload = found.payload;
		return {
			...found.meta,
			payload: new ReadableStream({
				start(c) {
					c.enqueue(payload);
					c.close();
				},
			}),
		};
	}
	async put(key: string, payload: Uint8Array, meta: Meta) {
		this.records.set(key, {payload: payload.slice(), meta: {...meta}});
	}
	async delete(key: string) {
		this.records.delete(key);
	}
}

function stand(options: {publicReads?: boolean} = {}) {
	const storage = new MemoryStorage();
	const env: Env = options.publicReads ? {PUBLIC_READS: 'true'} : {};
	const app = createServer<Env>({getStorage: () => storage, getEnv: () => env});
	const fetchImpl: typeof globalThis.fetch = async (input, init) =>
		app.fetch(new Request(input as never, init as never));
	return {storage, fetchImpl};
}

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

let wallet: Wallet;
let namespace: string;
let counter = 0;
const next = () => String(++counter + 1_000_000);

beforeEach(() => {
	wallet = Wallet.createRandom();
	namespace = 'client.test';
});

function client(
	options: {publicReads?: boolean; authenticatedReads?: boolean} = {},
) {
	const {fetchImpl} = stand({publicReads: options.publicReads});
	return new WaxdbClient({
		endpoint: 'http://localhost',
		namespace,
		signer: wallet,
		authenticatedReads: options.authenticatedReads,
		fetch: fetchImpl,
	});
}

describe('round trip', () => {
	it('writes and reads a payload byte for byte', async () => {
		const c = client();
		const payload = new Uint8Array(256);
		for (let i = 0; i < 256; i++) payload[i] = i;

		const written = await c.put(payload, {counter: next()});
		expect(written.ok).toBe(true);

		const read = await c.get();
		expect(read.found).toBe(true);
		if (!read.found || read.notModified) throw new Error('expected a record');
		expect([...read.payload]).toEqual([...payload]);
		expect(read.deleted).toBe(false);
	});

	it('reports absence as found: false, not as an error', async () => {
		expect(await client().get()).toEqual({found: false});
	});

	it('stores an empty payload as a record rather than a tombstone', async () => {
		const c = client();
		await c.put(new Uint8Array(0), {counter: next()});
		const read = await c.get();
		if (!read.found || read.notModified) throw new Error('expected a record');
		expect(read.deleted).toBe(false);
		expect(read.payload.byteLength).toBe(0);
	});

	it('derives the owner from the signer', async () => {
		expect(await client().owner()).toBe(wallet.address.toLowerCase());
	});
});

describe('conditional reads', () => {
	it('reports notModified for an unchanged record', async () => {
		const c = client();
		const written = await c.put(bytes('cached'), {counter: next()});
		if (!written.ok) throw new Error('write failed');

		const read = await c.get({ifNoneMatch: written.counter});
		expect(read).toEqual({
			found: true,
			notModified: true,
			counter: written.counter,
		});
	});

	it('returns the body when the counter moved on', async () => {
		const c = client();
		const first = await c.put(bytes('old'), {counter: next()});
		if (!first.ok) throw new Error('write failed');
		await c.put(bytes('new'), {counter: next()});

		const read = await c.get({ifNoneMatch: first.counter});
		if (!read.found || read.notModified) throw new Error('expected a body');
		expect(text(read.payload)).toBe('new');
	});

	it('head returns metadata without a payload', async () => {
		const c = client();
		const written = await c.put(bytes('head me'), {counter: next()});
		if (!written.ok) throw new Error('write failed');

		const meta = await c.head();
		expect(meta.found).toBe(true);
		if (!meta.found) throw new Error('expected metadata');
		expect(meta.counter).toBe(written.counter);
		expect(meta.deleted).toBe(false);
		expect(meta.dataHash).toMatch(/^0x[0-9a-f]{64}$/);
	});
});

describe('conflicts are results, not exceptions', () => {
	it('returns counter_not_increasing with the current record', async () => {
		const c = client();
		await c.put(bytes('first'), {counter: '5000'});

		const stale = await c.put(bytes('stale'), {counter: '4000'});
		expect(stale.ok).toBe(false);
		if (stale.ok) throw new Error('expected a conflict');
		expect(stale.error.code).toBe('counter_not_increasing');
		expect(stale.current).toEqual({
			found: true,
			counter: '5000',
			deleted: false,
		});
	});

	it('returns precondition_failed for a stale expected', async () => {
		const c = client();
		await c.put(bytes('first'), {counter: '5000'});

		const conflicted = await c.put(bytes('second'), {
			counter: '6000',
			expected: 'none',
		});
		if (conflicted.ok) throw new Error('expected a conflict');
		expect(conflicted.error.code).toBe('precondition_failed');
	});

	it('applies an exact-counter precondition', async () => {
		const c = client();
		await c.put(bytes('first'), {counter: '5000'});
		const ok = await c.put(bytes('second'), {
			counter: '6000',
			expected: '5000',
		});
		expect(ok.ok).toBe(true);
	});
});

describe('delete', () => {
	it('writes a tombstone that reads back as a record', async () => {
		const c = client();
		await c.put(bytes('doomed'), {counter: '5000'});
		const removed = await c.delete({counter: '6000'});
		expect(removed).toEqual({ok: true, counter: '6000', deleted: true});

		const read = await c.get();
		if (!read.found || read.notModified)
			throw new Error('expected a tombstone');
		expect(read.deleted).toBe(true);
		expect(read.payload.byteLength).toBe(0);
		// a tombstone has no signed Data: line, so no hash is reported
		expect(read.dataHash).toBeUndefined();
	});

	it('keeps the high-water mark, so an old write cannot be replayed', async () => {
		const c = client();
		await c.put(bytes('a'), {counter: '5000'});
		await c.delete({counter: '6000'});

		const replay = await c.put(bytes('replayed'), {counter: '5500'});
		if (replay.ok) throw new Error('replay should have been rejected');
		expect(replay.error.code).toBe('counter_not_increasing');
	});
});

describe('read authentication', () => {
	it('reads its own record with a minted token', async () => {
		const c = client();
		await c.put(bytes('private'), {counter: next()});
		const read = await c.get();
		expect(read.found).toBe(true);
	});

	it('cannot read another owner, which is indistinguishable from absence', async () => {
		const {fetchImpl} = stand();
		const owner = Wallet.createRandom();
		const writer = new WaxdbClient({
			endpoint: 'http://localhost',
			namespace,
			signer: owner,
			fetch: fetchImpl,
		});
		await writer.put(bytes('secret'), {counter: next()});

		const stranger = new WaxdbClient({
			endpoint: 'http://localhost',
			namespace,
			signer: Wallet.createRandom(),
			owner: owner.address,
			fetch: fetchImpl,
		});
		// a token signed by the wrong key answers exactly what absence answers
		expect(await stranger.get()).toEqual({found: false});
	});

	it('skips tokens against a public deployment', async () => {
		const {fetchImpl} = stand({publicReads: true});
		const c = new WaxdbClient({
			endpoint: 'http://localhost',
			namespace,
			signer: wallet,
			authenticatedReads: false,
			fetch: fetchImpl,
		});
		await c.put(bytes('open'), {counter: next()});
		const read = await c.get();
		if (!read.found || read.notModified) throw new Error('expected a record');
		expect(text(read.payload)).toBe('open');
	});
});

describe('client-side validation', () => {
	it('rejects a bad namespace at construction', () => {
		expect(
			() =>
				new WaxdbClient({
					endpoint: 'http://localhost',
					namespace: '..',
					signer: wallet,
				}),
		).toThrow(WaxdbError);
	});

	/**
	 * Caught locally on purpose: a non-canonical counter would be signed into
	 * the message and come back as signature_mismatch, which tells the caller
	 * nothing about what they actually did wrong.
	 */
	it('rejects a non-canonical counter before signing', async () => {
		const c = client();
		await expect(c.put(bytes('x'), {counter: '0123'})).rejects.toThrow(
			/canonical counter/,
		);
	});

	it('rejects an invalid precondition before signing', async () => {
		const c = client();
		await expect(
			c.put(bytes('x'), {counter: '10', expected: 'maybe'}),
		).rejects.toThrow(/precondition/);
	});
});

describe('errors that cannot be converged from are thrown', () => {
	it('throws on a signature the server rejects', async () => {
		const {fetchImpl} = stand();
		const c = new WaxdbClient({
			endpoint: 'http://localhost',
			namespace,
			// signs with one key while claiming another owner
			signer: Wallet.createRandom(),
			owner: Wallet.createRandom().address,
			fetch: fetchImpl,
		});
		await expect(c.put(bytes('x'), {counter: '10'})).rejects.toMatchObject({
			code: 'signature_mismatch',
			status: 401,
		});
	});
});
