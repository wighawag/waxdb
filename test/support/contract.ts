import { describe, expect, it } from 'vitest';
import { Wallet } from '@ethersproject/wallet';
import {
	getRequest,
	putMessage,
	putRequest,
	resetRequest,
	storageKey,
	uniqueNamespace,
} from './rpc';

/**
 * A harness is any way of talking to a running instance of the service.
 * The same contract is executed against:
 *  - the current handler in-process (with an in-memory KV)
 *  - the current worker running on workerd (via wrangler unstable_dev)
 *  - (later) the platform-agnostic rewrite
 *
 * Every assertion below is a *characterisation* of the behaviour that is live
 * today. Deliberate quirks are called out in comments: they are part of the
 * contract until an explicit decision says otherwise.
 */
export type ContractHarness = {
	name: string;
	/** perform a raw HTTP request against the service */
	raw(init: {
		method: string;
		body?: string;
		headers?: Record<string, string>;
		/** path + query, defaults to '/' */
		path?: string;
	}): Promise<Response>;
	/** the TOKEN_ADMIN value configured on this instance (undefined = unset) */
	adminToken?: string;
	/**
	 * false for deployments that predate the `reset` method (the currently live
	 * worker is one of them: it answers `"reset" not supported`).
	 */
	resetImplemented?: boolean;
	/** direct access to the underlying store, when the harness can provide it */
	kv?: {
		get(key: string): Promise<string | null>;
		put(key: string, value: string): Promise<void>;
	};
};

type RpcBody = {
	jsonrpc?: string;
	id?: unknown;
	result?: any;
	error?: any;
};

export function runContractTests(harness: ContractHarness) {
	/** storage-level tests only run on harnesses that expose the underlying KV */
	const itKV = harness.kv ? it : it.skip;

	const post = (
		body: unknown,
		headers?: Record<string, string>,
		path?: string
	) =>
		harness.raw({
			method: 'POST',
			body: typeof body === 'string' ? body : JSON.stringify(body),
			headers,
			path,
		});

	const postJSON = async (
		body: unknown,
		headers?: Record<string, string>,
		path?: string
	): Promise<{ response: Response; body: RpcBody }> => {
		const response = await post(body, headers, path);
		const text = await response.text();
		let parsed: RpcBody;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			throw new Error(`response is not JSON: ${response.status} ${text}`);
		}
		return { response, body: parsed };
	};

	/** every JSON-RPC response carries the same content-type + CORS headers */
	function expectJSONResponseHeaders(response: Response) {
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe(
			'application/json;charset=UTF-8'
		);
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
		expect(response.headers.get('access-control-allow-methods')).toBe(
			'GET,HEAD,POST,OPTIONS'
		);
		expect(response.headers.get('access-control-allow-headers')).toBe(
			'Content-Type'
		);
		expect(response.headers.get('access-control-max-age')).toBe('86400');
	}

	/**
	 * QUIRK: a thrown `Error` reaches the JSON-RPC `error` field in one of two
	 * shapes, depending on whether the call site passed a `usage` hint:
	 *  - with a usage hint it is interpolated into a template literal, so the
	 *    client sees `"Error: <message>" + usage`
	 *  - without one the raw `Error` is JSON.stringify'd, which yields `{}`
	 */
	function expectOpaqueError(body: RpcBody) {
		expect(body.result).toBe(null);
		expect(body.error).toEqual({});
	}

	/** usage hints appended to errors; note the getString one is missing its closing brace */
	const GET_USAGE =
		'\n{"method":"wallet_getString", "params":["<address>","<namespace>"]';
	const PUT_USAGE =
		'\n{"method":"wallet_putString", "params":["<address>","<namespace>","<counter>","<data>","<signature>"]}';

	function expectValidationError(
		body: RpcBody,
		message: string,
		usage: 'wallet_getString' | 'wallet_putString' | 'all'
	) {
		const suffix =
			usage === 'all'
				? GET_USAGE + PUT_USAGE
				: usage === 'wallet_getString'
				? GET_USAGE
				: PUT_USAGE;
		expect(body.result).toBe(null);
		expect(body.error).toBe(message + suffix);
	}

	describe(`[${harness.name}] transport`, () => {
		it('GET returns the plain-text usage hint, with no CORS headers', async () => {
			const response = await harness.raw({ method: 'GET' });
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('please use jsonrpc POST request');
			expect(response.headers.get('access-control-allow-origin')).toBe(null);
		});

		it('PUT (any non POST/OPTIONS method) returns the same usage hint', async () => {
			const response = await harness.raw({ method: 'PUT', body: '{}' });
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('please use jsonrpc POST request');
		});

		it('OPTIONS preflight (Origin + AC-Request-Method + AC-Request-Headers) returns CORS headers', async () => {
			const response = await harness.raw({
				method: 'OPTIONS',
				headers: {
					Origin: 'https://example.com',
					'Access-Control-Request-Method': 'POST',
					'Access-Control-Request-Headers': 'Content-Type',
				},
			});
			expect(response.status).toBe(200);
			expect(response.headers.get('access-control-allow-origin')).toBe('*');
			expect(response.headers.get('access-control-allow-methods')).toBe(
				'GET,HEAD,POST,OPTIONS'
			);
			expect(response.headers.get('access-control-allow-headers')).toBe(
				'Content-Type'
			);
			expect(response.headers.get('access-control-max-age')).toBe('86400');
			expect(await response.text()).toBe('');
		});

		it('bare OPTIONS returns only the Allow header', async () => {
			const response = await harness.raw({ method: 'OPTIONS' });
			expect(response.status).toBe(200);
			expect(response.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');
			expect(response.headers.get('access-control-allow-origin')).toBe(null);
			expect(await response.text()).toBe('');
		});

		it('OPTIONS with only some preflight headers falls back to Allow', async () => {
			const response = await harness.raw({
				method: 'OPTIONS',
				headers: { Origin: 'https://example.com' },
			});
			expect(response.status).toBe(200);
			expect(response.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');
			expect(response.headers.get('access-control-allow-origin')).toBe(null);
		});

		it('serves the RPC on any path, not just /', async () => {
			// the handler never looks at the URL; live clients rely on this
			const wallet = Wallet.createRandom();
			const namespace = uniqueNamespace();
			for (const path of ['/', '/some/deep/path', '/?query=1', '/rpc']) {
				const { body } = await postJSON(
					getRequest(wallet.address, namespace),
					undefined,
					path
				);
				expect(body.result).toEqual({
					data: '',
					counter: '0',
					signature: '',
				});
			}
		});

		it('serves a full put/get round-trip on a subpath', async () => {
			const wallet = Wallet.createRandom();
			const namespace = uniqueNamespace();
			const counter = (Date.now() - 1000).toString();
			const put = await postJSON(
				await putRequest(wallet, { namespace, counter, data: 'subpath' }),
				undefined,
				'/some/deep/path'
			);
			expect(put.body.result.success).toBe(true);
			const read = await postJSON(
				getRequest(wallet.address, namespace),
				undefined,
				'/other/path'
			);
			expect(read.body.result.data).toBe('subpath');
		});

		it('returns the usage hint for a GET on any path', async () => {
			const response = await harness.raw({
				method: 'GET',
				path: '/deep/path',
			});
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('please use jsonrpc POST request');
		});

		it('HEAD returns 200 with an empty body', async () => {
			const response = await harness.raw({ method: 'HEAD' });
			expect(response.status).toBe(200);
		});

		it('POST with a non-JSON body returns 400 with the raw parser error as text', async () => {
			const response = await harness.raw({
				method: 'POST',
				body: 'not json at all',
			});
			expect(response.status).toBe(400);
			expect(response.headers.get('content-type')).toBe(
				'text/plain;charset=UTF-8'
			);
			expect(await response.text()).toMatch(/^SyntaxError: /);
			expect(response.headers.get('access-control-allow-origin')).toBe(null);
		});

		it('POST with an empty body returns 400', async () => {
			const response = await harness.raw({ method: 'POST' });
			expect(response.status).toBe(400);
			expect(await response.text()).toMatch(/^SyntaxError: /);
		});

		it('a Content-Type header is neither required nor checked', async () => {
			const wallet = Wallet.createRandom();
			const namespace = uniqueNamespace();
			for (const headers of [
				undefined,
				{ 'Content-Type': 'application/json' },
				{ 'Content-Type': 'text/plain' },
			]) {
				const { body } = await postJSON(
					getRequest(wallet.address, namespace),
					headers
				);
				expect(body.result).toEqual({
					data: '',
					counter: '0',
					signature: '',
				});
			}
		});
	});

	describe(`[${harness.name}] jsonrpc envelope`, () => {
		it('unknown method returns result null + usage for both methods', async () => {
			const { response, body } = await postJSON({
				jsonrpc: '2.0',
				id: 42,
				method: 'wallet_unknown',
				params: [],
			});
			expectJSONResponseHeaders(response);
			expect(body.jsonrpc).toBe('2.0');
			expect(body.id).toBe(42);
			expect(body.result).toBe(null);
			expect(body.error).toBe(
				'"wallet_unknown" not supported\n' +
					'{"method":"wallet_getString", "params":["<address>","<namespace>"]\n' +
					'{"method":"wallet_putString", "params":["<address>","<namespace>","<counter>","<data>","<signature>"]}'
			);
		});

		it('missing method is reported as "undefined" not supported', async () => {
			const { body } = await postJSON({ id: 1, params: [] });
			expect(body.error).toContain('"undefined" not supported');
		});

		it('a JSON array body is treated as a request with no method', async () => {
			const { body } = await postJSON([]);
			expect(body.error).toContain('"undefined" not supported');
		});

		it('the request id is echoed verbatim (string ids too)', async () => {
			const { body } = await postJSON({ id: 'abc', method: 'nope' });
			expect(body.id).toBe('abc');
		});

		it('a missing id yields a response without an id field', async () => {
			const { body } = await postJSON({ method: 'nope' });
			expect('id' in body).toBe(false);
		});

		it('serialises the envelope as {jsonrpc, id, result} in that exact order', async () => {
			// byte-exact: a rewrite must not reorder keys or add `"error":null`
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const response = await post(getRequest(wallet.address, namespace, 7));
			expect(await response.text()).toBe(
				'{"jsonrpc":"2.0","id":7,"result":{"data":"","counter":"0","signature":""}}'
			);
		});

		it('serialises a put result byte-for-byte as {success, currentData}', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			const data = 'golden';
			const request = await putRequest(wallet, { namespace, counter, data });
			const response = await post({ ...request, id: 9 });
			expect(await response.text()).toBe(
				`{"jsonrpc":"2.0","id":9,"result":{"success":true,"currentData":{"data":"golden","counter":"${counter}","signature":"${request.params[4]}"}}}`
			);
		});

		it('serialises a string error as {jsonrpc, id, result, error}', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const request = await putRequest(wallet, {
				namespace,
				counter: (Date.now() - 1000).toString(),
				signer: Wallet.createRandom(),
				id: 11,
			});
			const response = await post(request);
			expect(await response.text()).toBe(
				'{"jsonrpc":"2.0","id":11,"result":null,"error":"invalid signature"}'
			);
		});

		it('a successful response has no error field at all', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const { body } = await postJSON(getRequest(wallet.address, namespace));
			expect('error' in body).toBe(false);
		});
	});

	describe(`[${harness.name}] wallet_getString`, () => {
		it('returns the empty record for an unknown address', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const { response, body } = await postJSON(
				getRequest(wallet.address, namespace)
			);
			expectJSONResponseHeaders(response);
			expect(body.result).toEqual({ data: '', counter: '0', signature: '' });
		});

		it('rejects a wrong number of params', async () => {
			const wallet = Wallet.createRandom();
			const cases: [any[], string][] = [
				[[], 'invalid number of parameters, expected 2, receiped 0'],
				[[wallet.address], 'invalid number of parameters, expected 2, receiped 1'],
				[
					[wallet.address, 'ns', 'extra'],
					'invalid number of parameters, expected 2, receiped 3',
				],
			];
			for (const [params, message] of cases) {
				const { body } = await postJSON({
					jsonrpc: '2.0',
					id: 1,
					method: 'wallet_getString',
					params,
				});
				expectValidationError(body, `Error: ${message}`, 'wallet_getString');
			}
		});

		it('reports missing params as "none"', async () => {
			const { body } = await postJSON({
				jsonrpc: '2.0',
				id: 1,
				method: 'wallet_getString',
			});
			expectValidationError(
				body,
				'Error: invalid number of parameters, expected 2, receiped none',
				'wallet_getString'
			);
		});

		it('rejects malformed addresses', async () => {
			const cases: [any, string][] = [
				[123, 'invalid address: not a string'],
				[null, 'invalid address: not a string'],
				['', 'invalid address: not 0x prefix'],
				['not-an-address', 'invalid address: not 0x prefix'],
				['0x123', 'invalid address length'],
				[
					'0x00000000000000000000000000000000000000000',
					'invalid address length',
				],
			];
			for (const [address, message] of cases) {
				const { body } = await postJSON({
					jsonrpc: '2.0',
					id: 1,
					method: 'wallet_getString',
					params: [address, 'ns'],
				});
				expectValidationError(body, `Error: ${message}`, 'wallet_getString');
			}
		});

		it('rejects malformed namespaces', async () => {
			const wallet = Wallet.createRandom();
			const cases: [any, string][] = [
				[123, 'invalid namespace: not a string'],
				[null, 'invalid namespace: not a string'],
				['', 'invalid namespace length'],
			];
			for (const [namespace, message] of cases) {
				const { body } = await postJSON({
					jsonrpc: '2.0',
					id: 1,
					method: 'wallet_getString',
					params: [wallet.address, namespace],
				});
				expectValidationError(body, `Error: ${message}`, 'wallet_getString');
			}
		});

		it('rejects an undefined namespace as a wrong param count', async () => {
			// QUIRK: `[address, undefined]` serialises to `[address, null]` over the
			// wire, so this is really the "not a string" path.
			const wallet = Wallet.createRandom();
			const { body } = await postJSON({
				jsonrpc: '2.0',
				id: 1,
				method: 'wallet_getString',
				params: [wallet.address, undefined],
			});
			expectValidationError(
				body,
				'Error: invalid namespace: not a string',
				'wallet_getString'
			);
		});

		it('accepts any address casing and normalises to lowercase', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			const data = 'case-test';
			await postJSON(await putRequest(wallet, { namespace, counter, data }));

			for (const address of [
				wallet.address,
				wallet.address.toLowerCase(),
				wallet.address.toUpperCase().replace('0X', '0x'),
			]) {
				const { body } = await postJSON(getRequest(address, namespace));
				expect(body.result.data).toBe(data);
			}
		});
	});

	describe(`[${harness.name}] wallet_putString`, () => {
		it('stores a signed value and returns it', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			const data = JSON.stringify({ hello: 'world' });
			const request = await putRequest(wallet, { namespace, counter, data });
			const signature = request.params[4];

			const { response, body } = await postJSON(request);
			expectJSONResponseHeaders(response);
			expect(body.result).toEqual({
				success: true,
				currentData: { data, counter, signature },
			});
			expect('error' in body).toBe(false);

			const read = await postJSON(getRequest(wallet.address, namespace));
			expect(read.body.result).toEqual({ data, counter, signature });
		});

		itKV('persists under `<namespace>_<lowercase address>` as a JSON {data, counter, signature}', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			const data = 'storage-format';
			const request = await putRequest(wallet, { namespace, counter, data });
			await postJSON(request);

			const raw = await harness.kv!.get(storageKey(namespace, wallet.address));
			expect(raw).toBe(
				JSON.stringify({ data, counter, signature: request.params[4] })
			);
		});

		it('rejects a wrong number of params', async () => {
			const wallet = Wallet.createRandom();
			const namespace = uniqueNamespace();
			const request = await putRequest(wallet, { namespace });
			const cases: [any[] | undefined, string][] = [
				[[], 'invalid number of parameters, expected 5, receiped 0'],
				[
					request.params.slice(0, 4),
					'invalid number of parameters, expected 5, receiped 4',
				],
				[
					[...request.params, 'extra'],
					'invalid number of parameters, expected 5, receiped 6',
				],
				[undefined, 'invalid number of parameters, expected 5, receiped none'],
			];
			for (const [params, message] of cases) {
				const { body } = await postJSON({ ...request, params });
				expectValidationError(body, `Error: ${message}`, 'wallet_putString');
			}
		});

		it('applies the read-path validation to the address and namespace', async () => {
			// QUIRK: the put path reuses parseReadRequest, so those errors come back
			// with the *putString* usage hint.
			const wallet = Wallet.createRandom();
			const namespace = uniqueNamespace();
			const request = await putRequest(wallet, { namespace });
			const params: any[] = [...request.params];
			params[0] = '0x123';
			const { body } = await postJSON({ ...request, params });
			expectValidationError(
				body,
				'Error: invalid address length',
				'wallet_putString'
			);
		});

		it('rejects a non-string counter', async () => {
			const wallet = Wallet.createRandom();
			const namespace = uniqueNamespace();
			const request = await putRequest(wallet, { namespace });
			const params: any[] = [...request.params];
			params[2] = 12345;
			const { body } = await postJSON({ ...request, params });
			expectValidationError(
				body,
				'Error: invalid counter: not a string',
				'wallet_putString'
			);
		});

		it('rejects a counter that is not a number', async () => {
			// the raw engine SyntaxError from BigInt() leaks to the client
			const wallet = Wallet.createRandom();
			const namespace = uniqueNamespace();
			const request = await putRequest(wallet, { namespace });
			const params = [...request.params];
			params[2] = 'not-a-number';
			const { body } = await postJSON({ ...request, params });
			expect(body.result).toBe(null);
			expect(String(body.error)).toMatch(/^SyntaxError: /);
			expect(String(body.error)).toContain(PUT_USAGE);
		});

		it('rejects non-string data', async () => {
			const wallet = Wallet.createRandom();
			const namespace = uniqueNamespace();
			const request = await putRequest(wallet, { namespace });
			const params: any[] = [...request.params];
			params[3] = { not: 'a string' };
			const { body } = await postJSON({ ...request, params });
			expectValidationError(
				body,
				'Error: invalid data: not a string',
				'wallet_putString'
			);
		});

		it('rejects malformed signatures', async () => {
			const wallet = Wallet.createRandom();
			const namespace = uniqueNamespace();
			const request = await putRequest(wallet, { namespace });
			const cases: [any, string][] = [
				[123, 'invalid signature: not a string'],
				[null, 'invalid signature: not a string'],
				['', 'invalid signature: not 0x prefix'],
				['no-0x-prefix', 'invalid signature: not 0x prefix'],
				['0x1234', 'invalid signature length'],
				[request.params[4] + '00', 'invalid signature length'],
			];
			for (const [signature, message] of cases) {
				const params: any[] = [...request.params];
				params[4] = signature;
				const { body } = await postJSON({ ...request, params });
				expectValidationError(body, `Error: ${message}`, 'wallet_putString');
			}
		});

		it('rejects a signature over a different message', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			const request = await putRequest(wallet, {
				namespace,
				counter,
				data: 'hello',
				signMessage: putMessage(namespace, counter, 'goodbye'),
			});
			const { body } = await postJSON(request);
			expect(body.result).toBe(null);
			expect(body.error).toBe('invalid signature');
		});

		it('rejects a signature from another wallet', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const attacker = Wallet.createRandom();
			const request = await putRequest(wallet, {
				namespace,
				counter: (Date.now() - 1000).toString(),
				signer: attacker,
			});
			const { body } = await postJSON(request);
			expect(body.result).toBe(null);
			expect(body.error).toBe('invalid signature');
		});

		it('rejects a well-formed but non-recoverable signature', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const request = await putRequest(wallet, { namespace });
			const params: any[] = [...request.params];
			params[4] = '0x' + '11'.repeat(65);
			const { body } = await postJSON({ ...request, params });
			expect(body.result).toBe(null);
			expect(body.error).toBe('invalid signature');
		});

		it('rejects a counter in the future', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() + 1000000).toString();
			const { body } = await postJSON(
				await putRequest(wallet, { namespace, counter })
			);
			expect(body.result).toBe(null);
			expect(String(body.error)).toMatch(
				new RegExp(`^cannot use counter \\(${counter}\\) > timestamp \\(\\d+\\) in ms$`)
			);
		});

		it('rejects counter 0 on a fresh key (empty record counter is "0")', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const { body } = await postJSON(
				await putRequest(wallet, { namespace, counter: '0' })
			);
			expect(body.result).toEqual({
				success: false,
				currentData: { data: '', counter: '0', signature: '' },
			});
			expect(body.error).toBe('cannot override with older/same counter');
		});

		it('rejects an equal or older counter and returns the current record', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			const data = 'first';
			const first = await putRequest(wallet, { namespace, counter, data });
			await postJSON(first);

			for (const attempt of [counter, (BigInt(counter) - 1n).toString()]) {
				const { body } = await postJSON(
					await putRequest(wallet, {
						namespace,
						counter: attempt,
						data: 'second',
					})
				);
				expect(body.result).toEqual({
					success: false,
					currentData: { data, counter, signature: first.params[4] },
				});
				expect(body.error).toBe('cannot override with older/same counter');
			}

			const read = await postJSON(getRequest(wallet.address, namespace));
			expect(read.body.result.data).toBe(data);
		});

		it('accepts a newer counter and overwrites', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			await postJSON(
				await putRequest(wallet, { namespace, counter, data: 'first' })
			);
			const newer = (BigInt(counter) + 1n).toString();
			const { body } = await postJSON(
				await putRequest(wallet, {
					namespace,
					counter: newer,
					data: 'second',
				})
			);
			expect(body.result.success).toBe(true);
			const read = await postJSON(getRequest(wallet.address, namespace));
			expect(read.body.result).toEqual({
				data: 'second',
				counter: newer,
				signature: expect.any(String),
			});
		});

		it('normalises the counter through BigInt for both the message and storage', async () => {
			// QUIRK: "0123" is signed and stored as "123" (BigInt round-trip).
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = '0' + (Date.now() - 1000).toString();
			const normalised = BigInt(counter).toString();
			const { body } = await postJSON(
				await putRequest(wallet, { namespace, counter, data: 'padded' })
			);
			expect(body.result.success).toBe(true);
			expect(body.result.currentData.counter).toBe(normalised);
		});

		it('stores empty data', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			const { body } = await postJSON(
				await putRequest(wallet, { namespace, counter, data: '' })
			);
			expect(body.result.success).toBe(true);
			const read = await postJSON(getRequest(wallet.address, namespace));
			expect(read.body.result.data).toBe('');
		});

		it('round-trips data containing colons, newlines and unicode', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			const data = 'a:b\nc\t"d" \u00e9\u4f60\u597d \u{1f600} :::';
			await postJSON(await putRequest(wallet, { namespace, counter, data }));
			const read = await postJSON(getRequest(wallet.address, namespace));
			expect(read.body.result.data).toBe(data);
		});

		it('keeps namespaces isolated for the same address', async () => {
			const nsA = uniqueNamespace('a');
			const nsB = uniqueNamespace('b');
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			await postJSON(
				await putRequest(wallet, { namespace: nsA, counter, data: 'in-a' })
			);
			const readB = await postJSON(getRequest(wallet.address, nsB));
			expect(readB.body.result).toEqual({
				data: '',
				counter: '0',
				signature: '',
			});
		});

		it('namespaces containing a colon still verify against the raw message', async () => {
			const namespace = uniqueNamespace('we:ird');
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			const { body } = await postJSON(
				await putRequest(wallet, { namespace, counter, data: 'x' })
			);
			expect(body.result.success).toBe(true);
		});

		it('accepts a checksummed address and serves it back under any casing', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			await postJSON(
				await putRequest(wallet, {
					namespace,
					counter,
					data: 'checksum',
					address: wallet.address, // ethers returns the checksummed form
				})
			);
			if (harness.kv) {
				const raw = await harness.kv.get(
					storageKey(namespace, wallet.address)
				);
				expect(raw).not.toBe(null);
			}
			const read = await postJSON(
				getRequest(wallet.address.toLowerCase(), namespace)
			);
			expect(read.body.result.data).toBe('checksum');
		});

		it('verifies the signature against the address param, not the recovered one', async () => {
			// signing wallet is the attacker, claimed address is the victim
			const namespace = uniqueNamespace();
			const victim = Wallet.createRandom();
			const attacker = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			const request = await putRequest(attacker, {
				namespace,
				counter,
				data: 'stolen',
				address: victim.address,
			});
			const { body } = await postJSON(request);
			expect(body.result).toBe(null);
			expect(body.error).toBe('invalid signature');
		});
	});

	describe(`[${harness.name}] stored data compatibility`, () => {
		itKV('returns legacy records that have no signature field verbatim', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			await harness.kv!.put(
				storageKey(namespace, wallet.address),
				JSON.stringify({ data: 'legacy', counter: '1618828000000' })
			);
			const { body } = await postJSON(getRequest(wallet.address, namespace));
			expect(body.result).toEqual({ data: 'legacy', counter: '1618828000000' });
		});

		itKV('passes unknown extra fields through untouched', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			await harness.kv!.put(
				storageKey(namespace, wallet.address),
				JSON.stringify({
					data: 'x',
					counter: '1',
					signature: '0xdead',
					extra: 42,
				})
			);
			const { body } = await postJSON(getRequest(wallet.address, namespace));
			expect(body.result).toEqual({
				data: 'x',
				counter: '1',
				signature: '0xdead',
				extra: 42,
			});
		});

		itKV('a legacy record still gates writes by counter', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 5000).toString();
			await harness.kv!.put(
				storageKey(namespace, wallet.address),
				JSON.stringify({ data: 'legacy', counter })
			);
			const older = await postJSON(
				await putRequest(wallet, {
					namespace,
					counter: (BigInt(counter) - 1n).toString(),
					data: 'nope',
				})
			);
			expect(older.body.result.success).toBe(false);

			const newer = await postJSON(
				await putRequest(wallet, {
					namespace,
					counter: (BigInt(counter) + 1n).toString(),
					data: 'yes',
				})
			);
			expect(newer.body.result.success).toBe(true);
		});

		itKV('corrupted stored JSON surfaces as an opaque error', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			await harness.kv!.put(
				storageKey(namespace, wallet.address),
				'{not json'
			);
			const { body } = await postJSON(getRequest(wallet.address, namespace));
			expectOpaqueError(body);
		});
	});

	describe(`[${harness.name}] reset`, () => {
		if (harness.resetImplemented === false) {
			it('is not a known method on this deployment', async () => {
				const wallet = Wallet.createRandom();
				const { body } = await postJSON(
					resetRequest(wallet.address, uniqueNamespace()),
					{ TOKEN: 'anything' }
				);
				expect(body.result).toBe(null);
				expect(body.error).toBe(
					'"reset" not supported' + GET_USAGE + PUT_USAGE
				);
			});
			return;
		}

		if (!harness.adminToken) {
			it('is refused when TOKEN_ADMIN is not configured', async () => {
				const wallet = Wallet.createRandom();
				const { response, body } = await postJSON(
					resetRequest(wallet.address, uniqueNamespace()),
					{ TOKEN: 'anything' }
				);
				expectJSONResponseHeaders(response);
				expect(body.result).toBe(null);
				expect(body.error).toBe('not admin');
			});
			return;
		}

		const adminToken = harness.adminToken;

		it('is refused without the TOKEN header', async () => {
			const wallet = Wallet.createRandom();
			const { body } = await postJSON(
				resetRequest(wallet.address, uniqueNamespace())
			);
			expect(body.result).toBe(null);
			expect(body.error).toBe('not admin');
		});

		it('is refused with a wrong TOKEN header', async () => {
			const wallet = Wallet.createRandom();
			const { body } = await postJSON(
				resetRequest(wallet.address, uniqueNamespace()),
				{ TOKEN: adminToken + 'x' }
			);
			expect(body.result).toBe(null);
			expect(body.error).toBe('not admin');
		});

		it('deletes the record with the right TOKEN header', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			await postJSON(
				await putRequest(wallet, { namespace, counter, data: 'to-delete' })
			);

			const { response, body } = await postJSON(
				resetRequest(wallet.address, namespace),
				{ TOKEN: adminToken }
			);
			expectJSONResponseHeaders(response);
			expect(body.result).toEqual({ ok: true });
			expect('error' in body).toBe(false);

			const read = await postJSON(getRequest(wallet.address, namespace));
			expect(read.body.result).toEqual({
				data: '',
				counter: '0',
				signature: '',
			});
			if (harness.kv) {
				expect(await harness.kv.get(storageKey(namespace, wallet.address))).toBe(
					null
				);
			}
		});

		it('after reset, any counter above 0 can be written again', async () => {
			const namespace = uniqueNamespace();
			const wallet = Wallet.createRandom();
			const counter = (Date.now() - 1000).toString();
			await postJSON(
				await putRequest(wallet, { namespace, counter, data: 'first' })
			);
			await postJSON(resetRequest(wallet.address, namespace), {
				TOKEN: adminToken,
			});
			const { body } = await postJSON(
				await putRequest(wallet, { namespace, counter: '1', data: 'again' })
			);
			expect(body.result.success).toBe(true);
		});

		it('deleting a non-existing record still reports ok', async () => {
			const wallet = Wallet.createRandom();
			const { body } = await postJSON(
				resetRequest(wallet.address, uniqueNamespace()),
				{ TOKEN: adminToken }
			);
			expect(body.result).toEqual({ ok: true });
		});

		it('validates its params like the read path', async () => {
			const { body } = await postJSON(
				{ jsonrpc: '2.0', id: 1, method: 'reset', params: ['0x123', 'ns'] },
				{ TOKEN: adminToken }
			);
			expectOpaqueError(body);
		});
	});
}
