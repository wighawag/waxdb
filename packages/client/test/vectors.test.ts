/**
 * The client, held to `vectors.json`.
 *
 * This is the file that makes the MIT/AGPL split safe. The client cannot
 * import the server's implementation of the wire format, so the two are
 * genuinely separate codebases that must nevertheless agree byte for byte. The
 * vectors are the contract between them, and a change to the encoding on
 * either side that does not update this file surfaces here rather than as
 * `signature_mismatch` in somebody's production.
 *
 * Note what is *not* imported below: anything from `waxdb-server`.
 */
import {describe, expect, it} from 'vitest';
import vectorsDocument from '../../../vectors.json' with {type: 'json'};
import {
	deleteMessage,
	isCanonicalCounter,
	isValidExpected,
	isValidNamespace,
	messageByteLength,
	normaliseOwner,
	payloadHash,
	readMessage,
	storeMessage,
} from '../src/protocol.js';

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

function fromHex(hex: string): Uint8Array {
	const body = hex.startsWith('0x') ? hex.slice(2) : hex;
	const out = new Uint8Array(body.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(body.substring(i * 2, i * 2 + 2), 16);
	}
	return out;
}

describe('client agrees with vectors.json', () => {
	it('covers all three intents', () => {
		expect(new Set(vectors.map((v) => v.intent))).toEqual(
			new Set(['store', 'delete', 'read']),
		);
	});

	for (const vector of vectors) {
		describe(vector.name, () => {
			it('builds the pinned message', async () => {
				const {namespace, owner} = vector.inputs;
				let message: string;
				if (vector.intent === 'store') {
					message = storeMessage({
						namespace,
						owner,
						counter: vector.inputs.counter!,
						expected: vector.inputs.expected!,
						payloadHash: await payloadHash(fromHex(vector.inputs.payload!)),
					});
				} else if (vector.intent === 'delete') {
					message = deleteMessage({
						namespace,
						owner,
						counter: vector.inputs.counter!,
						expected: vector.inputs.expected!,
					});
				} else {
					message = readMessage({
						namespace,
						owner,
						expires: vector.inputs.expires!,
					});
				}
				expect(message).toBe(vector.message);
			});

			/** bytes, not characters. Pinned so the invariant survives a charset change */
			it('computes the pinned byte length', () => {
				expect(messageByteLength(vector.message)).toBe(
					vector.messageByteLength,
				);
			});

			if (vector.intent === 'store') {
				it('hashes the payload with SHA-256 to the pinned hash', async () => {
					expect(await payloadHash(fromHex(vector.inputs.payload!))).toBe(
						vector.inputs.payloadHash,
					);
				});
			}

			it('accepts the vector fields as canonical', () => {
				expect(isValidNamespace(vector.inputs.namespace)).toBe(true);
				expect(normaliseOwner(vector.inputs.owner)).toBe(vector.inputs.owner);
				if (vector.inputs.counter !== undefined) {
					expect(isCanonicalCounter(vector.inputs.counter)).toBe(true);
				}
				if (vector.inputs.expected !== undefined) {
					expect(isValidExpected(vector.inputs.expected)).toBe(true);
				}
			});
		});
	}
});

describe('field forms are rejection rules', () => {
	it('rejects a non-canonical counter rather than normalising it', () => {
		for (const bad of ['0123', '', '+5', '1e3', '0x10', '1.0', ' 5', '-1']) {
			expect(isCanonicalCounter(bad), JSON.stringify(bad)).toBe(false);
		}
		expect(isCanonicalCounter('0')).toBe(true);
	});

	it('rejects namespaces the storage key could not survive', () => {
		for (const bad of [
			'',
			'.',
			'..',
			'.hidden',
			'A',
			'a/b',
			'a:b',
			'a b',
			'a'.repeat(256), // one byte over NAME_MAX
		]) {
			expect(isValidNamespace(bad), JSON.stringify(bad)).toBe(false);
		}
		expect(isValidNamespace('a'.repeat(255))).toBe(true);
	});

	it('lowercases an owner from a URL but treats only lowercase as canonical', () => {
		const mixed = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
		expect(normaliseOwner(mixed)).toBe(mixed.toLowerCase());
		expect(normaliseOwner('0x1234')).toBeNull();
	});
});
