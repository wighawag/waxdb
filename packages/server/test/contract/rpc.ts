import { Wallet } from '@ethersproject/wallet';

/**
 * The exact message that `wallet_putString` requires a signature over.
 *
 * NOTE: the server re-serialises the counter through `BigInt(...)` before
 * building this message, so the counter here is the *normalised* decimal form
 * (e.g. a request counter of "0123" is verified against "put:ns:123:data").
 */
export function putMessage(
	namespace: string,
	counter: string | bigint,
	data: string
): string {
	return 'put:' + namespace + ':' + counter + ':' + data;
}

export type PutOptions = {
	namespace: string;
	counter?: string;
	data?: string;
	/** override the message actually signed (to forge/break the signature) */
	signMessage?: string;
	/** sign with this wallet but claim the address of `wallet` */
	signer?: Wallet;
	/** override the address param */
	address?: string;
	id?: unknown;
};

export async function putRequest(wallet: Wallet, options: PutOptions) {
	const counter = options.counter ?? Math.floor(Date.now()).toString();
	const data = options.data ?? JSON.stringify({ hello: 'world' });
	const signer = options.signer ?? wallet;
	const message =
		options.signMessage ??
		putMessage(options.namespace, BigInt(counter).toString(), data);
	const signature = await signer.signMessage(message);
	return {
		jsonrpc: '2.0',
		id: options.id ?? 1,
		method: 'wallet_putString',
		params: [
			options.address ?? wallet.address,
			options.namespace,
			counter,
			data,
			signature,
		],
	};
}

export function getRequest(address: string, namespace: string, id: unknown = 2) {
	return {
		jsonrpc: '2.0',
		id,
		method: 'wallet_getString',
		params: [address, namespace],
	};
}

export function resetRequest(address: string, namespace: string, id: unknown = 3) {
	return {
		jsonrpc: '2.0',
		id,
		method: 'reset',
		params: [address, namespace],
	};
}

let namespaceCounter = 0;
/** unique namespace per test so runs never collide with persisted local state */
export function uniqueNamespace(prefix = 'ns'): string {
	namespaceCounter++;
	return `${prefix}-${Date.now().toString(36)}-${namespaceCounter}-${Math.floor(
		Math.random() * 1e9
	).toString(36)}`;
}

export function storageKey(namespace: string, address: string): string {
	return (namespace && namespace !== '' ? namespace + '_' : '') + address.toLowerCase();
}
