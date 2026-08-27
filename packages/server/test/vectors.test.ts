/**
 * The cross-implementation vectors (SPEC.md, "Cross-implementation vectors").
 *
 * The message encoding is the only thing keeping a client and the server in
 * agreement, and it has no external standard to fall back on. `vectors.json`
 * pins `(inputs -> message -> digest)` and is committed, so a change to the
 * encoding that does not update it in the same commit fails here rather than
 * surfacing as `signature_mismatch` in production.
 *
 * The signatures were produced by ethers rather than by `@noble/curves`, so
 * every recovery assertion below crosses implementations rather than agreeing
 * with itself.
 */
import {verifyMessage} from '@ethersproject/wallet';
import {describe, expect, it} from 'vitest';
import vectorsDocument from '../../../vectors.json' with {type: 'json'};
import {
	deleteMessage,
	eip191Digest,
	fromHex,
	payloadHash,
	readMessage,
	recoverSigner,
	storageKey,
	storeMessage,
	toHex,
} from '../src/protocol/index.js';

type Vector = (typeof vectorsDocument.vectors)[number] & {
	inputs: {
		namespace: string;
		owner: string;
		counter?: string;
		expected?: string;
		expires?: string;
		payload?: string;
		payloadHash?: string;
	};
};

const vectors = vectorsDocument.vectors as Vector[];

describe('vectors.json', () => {
	it('has vectors for all three intents', () => {
		const intents = new Set(vectors.map((v) => v.intent));
		expect(intents).toEqual(new Set(['store', 'delete', 'read']));
	});

	for (const vector of vectors) {
		describe(vector.name, () => {
			it('builds the pinned message', async () => {
				expect(await buildMessage(vector)).toBe(vector.message);
			});

			/**
			 * The EIP-191 prefix counts BYTES. Every charset is ASCII, so this
			 * equals the character count today. Pinning it is what catches the day
			 * that stops being true.
			 */
			it('has the pinned byte length', () => {
				const encoded = new TextEncoder().encode(vector.message);
				expect(encoded.length).toBe(vector.messageByteLength);
				expect(encoded.length).toBe(vector.message.length);
			});

			it('produces the pinned digest', () => {
				expect(toHex(eip191Digest(vector.message))).toBe(vector.digest);
			});

			it('recovers the pinned signer', () => {
				expect(recoverSigner(vector.message, vector.signature)).toBe(
					vector.signer,
				);
			});

			it('agrees with an independent implementation', () => {
				expect(
					verifyMessage(vector.message, vector.signature).toLowerCase(),
				).toBe(vector.signer);
			});

			it('builds the pinned storage key', () => {
				expect(storageKey(vector.inputs.namespace, vector.inputs.owner)).toBe(
					vector.storageKey,
				);
			});

			if (vector.intent === 'store') {
				it('hashes the payload to the pinned hash', async () => {
					const payload = fromHex(vector.inputs.payload!);
					expect(await payloadHash(payload)).toBe(vector.inputs.payloadHash);
				});
			}

			it('is not verifiable under a different message', () => {
				const tampered = vector.message.replace(
					/Namespace: .*/,
					'Namespace: tampered',
				);
				expect(recoverSigner(tampered, vector.signature)).not.toBe(
					vector.signer,
				);
			});
		});
	}

	/**
	 * The `waxdb store` / `waxdb delete` / `waxdb read` header lines are what
	 * give the three intents different bytes, so a signature for one can never
	 * authorise another. This is the job a version field would otherwise do
	 * (DECISIONS.md #6).
	 */
	it('gives the three intents different digests for the same fields', () => {
		const common = {namespace: 'app', owner: `0x${'ab'.repeat(20)}`};
		const store = storeMessage({
			...common,
			counter: '1',
			expected: 'any',
			payloadHash: `0x${'cd'.repeat(32)}`,
		});
		const remove = deleteMessage({...common, counter: '1', expected: 'any'});
		const read = readMessage({...common, expires: '1'});

		const digests = new Set(
			[store, remove, read].map((m) => toHex(eip191Digest(m))),
		);
		expect(digests.size).toBe(3);
	});

	it('has the line counts SPEC.md fixes', () => {
		for (const vector of vectors) {
			const expectedLines =
				vector.intent === 'store' ? 6 : vector.intent === 'delete' ? 5 : 4;
			expect(vector.message.split('\n')).toHaveLength(expectedLines);
			expect(vector.message.endsWith('\n')).toBe(false);
		}
	});
});

async function buildMessage(vector: Vector): Promise<string> {
	const {namespace, owner} = vector.inputs;
	if (vector.intent === 'store') {
		return storeMessage({
			namespace,
			owner,
			counter: vector.inputs.counter!,
			expected: vector.inputs.expected!,
			payloadHash: await payloadHash(fromHex(vector.inputs.payload!)),
		});
	}
	if (vector.intent === 'delete') {
		return deleteMessage({
			namespace,
			owner,
			counter: vector.inputs.counter!,
			expected: vector.inputs.expected!,
		});
	}
	return readMessage({namespace, owner, expires: vector.inputs.expires!});
}
