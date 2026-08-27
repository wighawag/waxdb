/**
 * Regenerates the repo-root `vectors.json`.
 *
 *   pnpm --filter waxdb-server run vectors
 *
 * The vectors pin `(inputs -> message -> digest)`, which is the only thing
 * keeping a client and the server in agreement about the encoding, and it has
 * no external standard to fall back on. A change to the encoding that does not
 * update these in the same commit surfaces only as `signature_mismatch` in
 * production, so `vectors.test.ts` fails the build instead.
 *
 * Messages and digests come from the server's own implementation; the
 * signatures come from ethers. A vector where those two disagree cannot be
 * generated, so the file is a cross-check and not just a snapshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Wallet} from '@ethersproject/wallet';
import {
	deleteMessage,
	eip191Digest,
	payloadHash,
	readMessage,
	storageKey,
	storeMessage,
	toHex,
} from '../dist/esm/protocol/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '../../../vectors.json');

/** fixed, so the file is reproducible. Never used for anything real. */
const PRIVATE_KEY =
	'0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
const wallet = new Wallet(PRIVATE_KEY);
const owner = wallet.address.toLowerCase();

const encoder = new TextEncoder();
const hexOf = (bytes) => toHex(bytes);

/** every byte value, so no vector can hide a re-encoding bug */
const allBytes = new Uint8Array(256);
for (let i = 0; i < 256; i++) allBytes[i] = i;

const cases = [
	{
		name: 'store, minimal',
		intent: 'store',
		namespace: 'app',
		counter: '0',
		expected: 'any',
		payload: new Uint8Array(0),
	},
	{
		name: 'store, millisecond counter',
		intent: 'store',
		namespace: 'my.app-name_v2',
		counter: '1756290000000',
		expected: 'any',
		payload: encoder.encode('hello waxdb'),
	},
	{
		name: 'store, expected none',
		intent: 'store',
		namespace: 'app.scope-1',
		counter: '1',
		expected: 'none',
		payload: encoder.encode('{"first":"push"}'),
	},
	{
		name: 'store, expected an exact counter',
		intent: 'store',
		namespace: 'app.scope-1',
		counter: '1756290000001',
		expected: '1756290000000',
		payload: encoder.encode('conditional'),
	},
	{
		name: 'store, every byte value',
		intent: 'store',
		namespace: 'binary',
		counter: '42',
		expected: 'any',
		payload: allBytes,
	},
	{
		name: 'store, namespace using the whole charset',
		intent: 'store',
		namespace: 'abcdefghijklmnopqrstuvwxyz0123456789._-',
		counter: '7',
		expected: 'any',
		payload: encoder.encode('charset'),
	},
	{
		name: 'delete, minimal',
		intent: 'delete',
		namespace: 'app',
		counter: '1756290000002',
		expected: 'any',
	},
	{
		name: 'delete, expected an exact counter',
		intent: 'delete',
		namespace: 'app.scope-1',
		counter: '99',
		expected: '98',
	},
	{
		name: 'read token',
		intent: 'read',
		namespace: 'app',
		expires: '1756290000',
	},
	{
		name: 'read token, expires zero',
		intent: 'read',
		namespace: 'app',
		expires: '0',
	},
];

const vectors = [];

for (const testCase of cases) {
	const inputs = {
		namespace: testCase.namespace,
		owner,
	};
	let message;

	if (testCase.intent === 'store') {
		const hash = await payloadHash(testCase.payload);
		inputs.counter = testCase.counter;
		inputs.expected = testCase.expected;
		inputs.payload = hexOf(testCase.payload);
		inputs.payloadHash = hash;
		message = storeMessage({
			namespace: testCase.namespace,
			owner,
			counter: testCase.counter,
			expected: testCase.expected,
			payloadHash: hash,
		});
	} else if (testCase.intent === 'delete') {
		inputs.counter = testCase.counter;
		inputs.expected = testCase.expected;
		message = deleteMessage({
			namespace: testCase.namespace,
			owner,
			counter: testCase.counter,
			expected: testCase.expected,
		});
	} else {
		inputs.expires = testCase.expires;
		message = readMessage({
			namespace: testCase.namespace,
			owner,
			expires: testCase.expires,
		});
	}

	const signature = await wallet.signMessage(message);

	vectors.push({
		name: testCase.name,
		intent: testCase.intent,
		inputs,
		storageKey: storageKey(testCase.namespace, owner),
		message,
		// the EIP-191 prefix counts BYTES; the charsets make this equal the
		// character count today, and pinning it is what would catch the day it
		// stops being equal
		messageByteLength: encoder.encode(message).length,
		digest: hexOf(eip191Digest(message)),
		signature,
		signer: owner,
	});
}

const document = {
	$comment:
		'Cross-implementation vectors for the waxdb signed message. See SPEC.md, ' +
		'"Cross-implementation vectors". Regenerate with `pnpm --filter ' +
		'waxdb-server run vectors`. A change to the encoding that does not update ' +
		'this file in the same commit surfaces only as signature_mismatch in ' +
		'production.',
	privateKey: PRIVATE_KEY,
	signer: owner,
	hashes: {
		payload: 'SHA-256',
		messageDigest: 'keccak256, via EIP-191 personal_sign',
	},
	vectors,
};

fs.writeFileSync(target, JSON.stringify(document, null, '\t') + '\n');
console.log(`wrote ${target} (${vectors.length} vectors)`);
