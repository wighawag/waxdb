import {verifyMessage} from '@ethersproject/wallet';
import {Hono} from 'hono';
import {logs} from 'named-logs';
import {Env} from '../env.js';
import {
	EMPTY_RECORD,
	StoredRecord,
	deserialiseRecord,
	serialiseRecord,
	storageKey,
} from '../record.js';
import {setup} from '../setup.js';
import {Storage} from '../storage.js';
import {ServerOptions} from '../types.js';

const logger = logs('secp256k1-db');

/**
 * NOTE: these are written by hand, not via hono/cors, because the exact header
 * set (and the bare-OPTIONS fallback below) is part of the contract that live
 * clients see today.
 */
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Access-Control-Max-Age': '86400',
};

async function setData(
	storage: Storage,
	namespace: string,
	key: string,
	data: string,
	counter: BigInt,
	signature: string,
): Promise<StoredRecord> {
	const record = {data, counter: counter.toString(), signature};
	await storage.put(storageKey(namespace, key), serialiseRecord(record));
	return record;
}

async function getData(
	storage: Storage,
	namespace: string,
	key: string,
): Promise<StoredRecord> {
	const str = await storage.get(storageKey(namespace, key));
	if (!str) {
		return {...EMPTY_RECORD};
	}
	return deserialiseRecord(str);
}

async function deleteData(
	storage: Storage,
	namespace: string,
	key: string,
): Promise<{ok: boolean}> {
	await storage.delete(storageKey(namespace, key));
	return {ok: true};
}

type JSONRequest = {method: string; params: any[]; id: number};

function handleOptions(request: Request) {
	if (
		request.headers.get('Origin') !== null &&
		request.headers.get('Access-Control-Request-Method') !== null &&
		request.headers.get('Access-Control-Request-Headers') !== null
	) {
		// Handle CORS pre-flight request.
		return new Response(null, {
			headers: corsHeaders,
		});
	} else {
		// Handle standard OPTIONS request.
		return new Response(null, {
			headers: {
				Allow: 'GET, HEAD, POST, OPTIONS',
			},
		});
	}
}

export async function handleRPC(
	request: Request,
	storage: Storage,
	env: Env,
): Promise<Response> {
	if (request.method === 'OPTIONS') {
		return handleOptions(request);
	} else if (request.method === 'POST') {
		let jsonRequest: JSONRequest;
		try {
			jsonRequest = await request.json();
		} catch (e: any) {
			return new Response(e, {status: 400});
		}
		const method = jsonRequest.method;
		switch (method) {
			case 'reset':
				// TODO fix replayability, use counter
				if (
					env.TOKEN_ADMIN &&
					request.headers.get('TOKEN') === env.TOKEN_ADMIN
				) {
					return handleReset(jsonRequest, storage);
				} else {
					return wrapResponse(jsonRequest, null, 'not admin');
				}

			case 'wallet_getString':
				return handleGetString(jsonRequest, storage);
			case 'wallet_putString':
				return handlePutString(jsonRequest, storage);
			default:
				return wrapResponse(
					jsonRequest,
					null,
					`"${method}" not supported`,
					'all',
				);
		}
	} else {
		return new Response('please use jsonrpc POST request');
	}
}

type ParsedRequest = {
	namespace: string;
	address: string;
};

type ParsedReadRequest = ParsedRequest;

type ParsedWriteRequest = ParsedRequest & {
	signature: string;
	data: string;
	counter: bigint;
};

function parseReadRequest(
	jsonRequest: JSONRequest,
	numParams?: number,
): ParsedReadRequest {
	if (
		numParams &&
		(!jsonRequest.params || jsonRequest.params.length !== numParams)
	) {
		throw new Error(
			`invalid number of parameters, expected ${numParams}, receiped ${
				jsonRequest.params ? jsonRequest.params.length : 'none'
			}`,
		);
	}
	const address = jsonRequest.params[0];
	if (typeof address !== 'string') {
		throw new Error(`invalid address: not a string`);
	}
	if (!address.startsWith('0x')) {
		throw new Error(`invalid address: not 0x prefix`);
	}
	if (address.length !== 42) {
		throw new Error('invalid address length');
	}
	const namespace = jsonRequest.params[1];
	if (typeof namespace !== 'string') {
		throw new Error(`invalid namespace: not a string`);
	}
	if (namespace.length === 0) {
		throw new Error('invalid namespace length');
	}

	return {address, namespace};
}

function parseWriteRequest(jsonRequest: JSONRequest): ParsedWriteRequest {
	if (!jsonRequest.params || jsonRequest.params.length !== 5) {
		throw new Error(
			`invalid number of parameters, expected 5, receiped ${
				jsonRequest.params ? jsonRequest.params.length : 'none'
			}`,
		);
	}
	const {namespace, address} = parseReadRequest(jsonRequest);

	const counterMs = jsonRequest.params[2];
	if (typeof counterMs !== 'string') {
		throw new Error(`invalid counter: not a string`);
	}
	const counter = BigInt(counterMs);

	const data = jsonRequest.params[3];
	if (typeof data !== 'string') {
		throw new Error(`invalid data: not a string`);
	}

	const signature = jsonRequest.params[4];
	if (typeof signature !== 'string') {
		throw new Error(`invalid signature: not a string`);
	}
	if (!signature.startsWith('0x')) {
		throw new Error(`invalid signature: not 0x prefix`);
	}
	if (signature.length !== 132) {
		throw new Error('invalid signature length');
	}
	return {namespace, address, signature, data, counter};
}

function parseResetRequest(
	jsonRequest: JSONRequest,
	numParams?: number,
): ParsedReadRequest {
	if (
		numParams &&
		(!jsonRequest.params || jsonRequest.params.length !== numParams)
	) {
		throw new Error(
			`invalid number of parameters, expected ${numParams}, receiped ${
				jsonRequest.params ? jsonRequest.params.length : 'none'
			}`,
		);
	}
	const address = jsonRequest.params[0];
	if (typeof address !== 'string') {
		throw new Error(`invalid address: not a string`);
	}
	if (!address.startsWith('0x')) {
		throw new Error(`invalid address: not 0x prefix`);
	}
	if (address.length !== 42) {
		throw new Error('invalid address length');
	}
	const namespace = jsonRequest.params[1];
	if (typeof namespace !== 'string') {
		throw new Error(`invalid namespace: not a string`);
	}
	if (namespace.length === 0) {
		throw new Error('invalid namespace length');
	}

	return {address, namespace};
}

type Usage = 'wallet_putString' | 'wallet_getString' | 'all' | 'reset';

function wrapRequest(
	jsonRequest: JSONRequest,
	data: any,
	error?: any,
	usage?: Usage,
) {
	if (usage && error) {
		if (usage === 'wallet_getString' || usage === 'all') {
			error = `${error}\n{"method":"wallet_getString", "params":["<address>","<namespace>"]`;
		}
		if (usage === 'wallet_putString' || usage === 'all') {
			error = `${error}\n{"method":"wallet_putString", "params":["<address>","<namespace>","<counter>","<data>","<signature>"]}`;
		}
	}
	return JSON.stringify({
		jsonrpc: '2.0',
		id: jsonRequest.id,
		result: data === undefined ? null : data,
		error,
	});
}

async function handleGetString(jsonRequest: JSONRequest, storage: Storage) {
	let request: ParsedReadRequest;
	try {
		request = parseReadRequest(jsonRequest, 2);
	} catch (e) {
		logger.error(e);
		return wrapResponse(jsonRequest, null, e, 'wallet_getString');
	}

	try {
		const data = await getData(
			storage,
			request.namespace,
			request.address.toLowerCase(),
		);
		return wrapResponse(jsonRequest, data);
	} catch (e) {
		logger.error(e);
		return wrapResponse(jsonRequest, null, e);
	}
}

async function handleReset(jsonRequest: JSONRequest, storage: Storage) {
	let request: ParsedReadRequest;
	try {
		request = parseResetRequest(jsonRequest, 2);
	} catch (e) {
		logger.error(e);
		return wrapResponse(jsonRequest, null, e, 'reset');
	}

	try {
		const data = await deleteData(
			storage,
			request.namespace,
			request.address.toLowerCase(),
		);
		return wrapResponse(jsonRequest, data);
	} catch (e) {
		logger.error(e);
		return wrapResponse(jsonRequest, null, e);
	}
}

function wrapResponse(
	jsonRequest: JSONRequest,
	data: any,
	error?: any,
	usage?: Usage,
): Response {
	return new Response(wrapRequest(jsonRequest, data, error, usage), {
		headers: {
			'content-type': 'application/json;charset=UTF-8',
			...corsHeaders,
		},
	});
}

async function handlePutString(jsonRequest: JSONRequest, storage: Storage) {
	let request: ParsedWriteRequest;
	try {
		request = parseWriteRequest(jsonRequest);
	} catch (e) {
		return wrapResponse(jsonRequest, null, e, 'wallet_putString');
	}

	const authorized = await isAuthorized(
		request.address,
		'put:' + request.namespace + ':' + request.counter + ':' + request.data,
		request.signature,
	);

	if (!authorized) {
		return wrapResponse(jsonRequest, null, 'invalid signature');
	}

	let currentData;
	try {
		currentData = await getData(
			storage,
			request.namespace,
			request.address.toLowerCase(),
		);
		if (request.counter <= BigInt(currentData.counter)) {
			return wrapResponse(
				jsonRequest,
				{success: false, currentData},
				`cannot override with older/same counter`,
			);
		}
		const now = Math.floor(Date.now());
		if (request.counter > BigInt(now)) {
			return wrapResponse(
				jsonRequest,
				null,
				`cannot use counter (${request.counter}) > timestamp (${now}) in ms`,
			);
		}
		currentData = await setData(
			storage,
			request.namespace,
			request.address.toLowerCase(),
			request.data,
			request.counter,
			request.signature,
		);
	} catch (e) {
		logger.error(e);
		return wrapResponse(jsonRequest, null, e);
	}

	return wrapResponse(jsonRequest, {success: true, currentData});
}

async function isAuthorized(
	address: string,
	message: string,
	signature: string,
): Promise<boolean> {
	let addressFromSignature;
	try {
		addressFromSignature = verifyMessage(message, signature);
	} catch (e) {
		logger.info(`invalid sig`);
		return false;
	}
	return address.toLowerCase() == addressFromSignature.toLowerCase();
}

export function getJSONRPCAPI<CustomEnv extends Env>(
	options: ServerOptions<CustomEnv>,
) {
	const app = new Hono<{Bindings: CustomEnv}>()
		.use(setup({serverOptions: options}))
		// every method and every path: the service has always ignored the URL
		.all('*', async (c) => {
			const config = c.get('config');
			return handleRPC(c.req.raw, config.storage, config.env);
		});

	return app;
}
