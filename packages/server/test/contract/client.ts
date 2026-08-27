/**
 * A minimal waxdb client, for the contract suite.
 *
 * **It re-implements the signed message rather than importing it**, exactly as
 * the predecessor's suite re-implemented the storage key. If the tests built
 * their messages with `src/protocol/message.ts`, an error in that file would
 * cancel out on both sides and the suite would pass while every real client
 * failed. Signing goes through ethers rather than `@noble/curves` for the same
 * reason: the two sides of every assertion share no code.
 */
import {Wallet} from '@ethersproject/wallet';

export {Wallet};

const encoder = new TextEncoder();

let namespaceCounter = 0;

/**
 * A namespace no other test has used.
 *
 * The workerd harness runs against one shared KV namespace, so tests that
 * assume a fresh record need one of these rather than a fixed string.
 */
export function uniqueNamespace(prefix = 'test'): string {
	namespaceCounter += 1;
	return `${prefix}.${Date.now().toString(36)}-${namespaceCounter}`;
}

export function recordPath(namespace: string, owner: string): string {
	return `/records/${namespace}/${owner}`;
}

// --- the signed messages, spelled out literally ----------------------------

export function storeMessage(inputs: {
	namespace: string;
	owner: string;
	counter: string;
	expected: string;
	dataHash: string;
}): string {
	return (
		`waxdb store\n` +
		`Namespace: ${inputs.namespace}\n` +
		`Owner: ${inputs.owner}\n` +
		`Counter: ${inputs.counter}\n` +
		`Expected: ${inputs.expected}\n` +
		`Data: ${inputs.dataHash}`
	);
}

export function deleteMessage(inputs: {
	namespace: string;
	owner: string;
	counter: string;
	expected: string;
}): string {
	return (
		`waxdb delete\n` +
		`Namespace: ${inputs.namespace}\n` +
		`Owner: ${inputs.owner}\n` +
		`Counter: ${inputs.counter}\n` +
		`Expected: ${inputs.expected}`
	);
}

export function readMessage(inputs: {
	namespace: string;
	owner: string;
	expires: string;
}): string {
	return (
		`waxdb read\n` +
		`Namespace: ${inputs.namespace}\n` +
		`Owner: ${inputs.owner}\n` +
		`Expires: ${inputs.expires}`
	);
}

// --- helpers ---------------------------------------------------------------

export function bytes(value: string): Uint8Array {
	return encoder.encode(value);
}

export async function sha256Hex(payload: Uint8Array): Promise<string> {
	const copy = new Uint8Array(payload.byteLength);
	copy.set(payload);
	const digest = await crypto.subtle.digest('SHA-256', copy);
	let out = '0x';
	for (const b of new Uint8Array(digest))
		out += b.toString(16).padStart(2, '0');
	return out;
}

export type SignedWrite = {
	headers: Record<string, string>;
	body: Uint8Array;
};

export async function signStore(
	wallet: Wallet,
	inputs: {
		namespace: string;
		counter: string;
		expected?: string;
		payload: Uint8Array;
		/** override what goes in the header, to test data_hash_mismatch */
		declaredHash?: string;
	},
): Promise<SignedWrite> {
	const owner = wallet.address.toLowerCase();
	const expected = inputs.expected ?? 'any';
	const dataHash = await sha256Hex(inputs.payload);
	const signature = await wallet.signMessage(
		storeMessage({
			namespace: inputs.namespace,
			owner,
			counter: inputs.counter,
			expected,
			dataHash,
		}),
	);
	return {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Waxdb-Counter': inputs.counter,
			'Waxdb-Expected': expected,
			'Waxdb-Data-Hash': inputs.declaredHash ?? dataHash,
			'Waxdb-Signature': signature,
		},
		body: inputs.payload,
	};
}

export async function signDelete(
	wallet: Wallet,
	inputs: {namespace: string; counter: string; expected?: string},
): Promise<Record<string, string>> {
	const owner = wallet.address.toLowerCase();
	const expected = inputs.expected ?? 'any';
	const signature = await wallet.signMessage(
		deleteMessage({
			namespace: inputs.namespace,
			owner,
			counter: inputs.counter,
			expected,
		}),
	);
	return {
		'Waxdb-Counter': inputs.counter,
		'Waxdb-Expected': expected,
		'Waxdb-Signature': signature,
	};
}

export async function signReadToken(
	wallet: Wallet,
	inputs: {namespace: string; expiresInSeconds?: number; expires?: string},
): Promise<Record<string, string>> {
	const owner = wallet.address.toLowerCase();
	const expires =
		inputs.expires ??
		String(Math.floor(Date.now() / 1000) + (inputs.expiresInSeconds ?? 300));
	const signature = await wallet.signMessage(
		readMessage({namespace: inputs.namespace, owner, expires}),
	);
	return {
		'Waxdb-Read-Expires': expires,
		'Waxdb-Read-Signature': signature,
	};
}
