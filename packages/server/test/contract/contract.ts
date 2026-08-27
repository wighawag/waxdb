/**
 * The waxdb contract.
 *
 * One `runContractTests(harness)` containing every assertion, transport
 * agnostic, executed against the in-process server, the worker on real workerd,
 * and both Node backends. Every assertion cites SPEC.md rather than describing
 * whatever the implementation happens to do.
 */
import {beforeAll, describe, expect, it} from 'vitest';
import type {ContractHarness} from './harness.js';
import {
	bytes,
	recordPath,
	sha256Hex,
	signDelete,
	signReadToken,
	signStore,
	storeMessage,
	uniqueNamespace,
	Wallet,
} from './client.js';

export function runContractTests(harness: ContractHarness) {
	describe(harness.name, () => {
		let wallet: Wallet;
		let owner: string;

		beforeAll(() => {
			wallet = Wallet.createRandom();
			owner = wallet.address.toLowerCase();
		});

		/** read headers appropriate to this deployment's read policy */
		async function readAuth(
			namespace: string,
		): Promise<Record<string, string>> {
			if (harness.publicReads) return {};
			return signReadToken(wallet, {namespace});
		}

		async function get(namespace: string, extra?: Record<string, string>) {
			return harness.fetch({
				method: 'GET',
				path: recordPath(namespace, owner),
				headers: {...(await readAuth(namespace)), ...extra},
			});
		}

		async function head(namespace: string, extra?: Record<string, string>) {
			return harness.fetch({
				method: 'HEAD',
				path: recordPath(namespace, owner),
				headers: {...(await readAuth(namespace)), ...extra},
			});
		}

		async function put(
			namespace: string,
			inputs: {
				counter: string;
				expected?: string;
				payload: Uint8Array;
				declaredHash?: string;
			},
		) {
			const signed = await signStore(wallet, {namespace, ...inputs});
			return harness.fetch({
				method: 'PUT',
				path: recordPath(namespace, owner),
				headers: signed.headers,
				body: signed.body,
			});
		}

		async function del(
			namespace: string,
			inputs: {counter: string; expected?: string},
		) {
			return harness.fetch({
				method: 'DELETE',
				path: recordPath(namespace, owner),
				headers: await signDelete(wallet, {namespace, ...inputs}),
			});
		}

		async function seed(
			namespace: string,
			payload: Uint8Array,
			counter = '1000',
		) {
			const response = await put(namespace, {counter, payload});
			expect(response.status, await response.text()).toBe(200);
		}

		// ------------------------------------------------------------------
		// CORS
		// ------------------------------------------------------------------

		describe('CORS', () => {
			it('sends the full header block on every response', async () => {
				const response = await get(uniqueNamespace());
				expectCors(response);
			});

			it('sends it on errors too', async () => {
				const response = await harness.fetch({
					method: 'GET',
					path: `/records/NOT-VALID/${owner}`,
				});
				expect(response.status).toBe(400);
				expectCors(response);
			});

			/**
			 * Without this, browser JavaScript can read none of the response
			 * headers, which is where the entire record lives: a read would
			 * succeed and be useless.
			 */
			it('exposes every Waxdb-* response header plus ETag', async () => {
				const response = await get(uniqueNamespace());
				const exposed = (
					response.headers.get('access-control-expose-headers') ?? ''
				)
					.split(',')
					.map((h) => h.trim().toLowerCase());
				for (const required of [
					'etag',
					'waxdb-counter',
					'waxdb-signature',
					'waxdb-data-hash',
					'waxdb-deleted',
					'waxdb-server-time',
				]) {
					expect(exposed, `missing ${required}`).toContain(required);
				}
			});

			it('allows every request header the protocol uses', async () => {
				const response = await harness.fetch({method: 'OPTIONS', path: '/'});
				const allowed = (
					response.headers.get('access-control-allow-headers') ?? ''
				)
					.split(',')
					.map((h) => h.trim().toLowerCase());
				for (const required of [
					'content-type',
					'if-none-match',
					'waxdb-counter',
					'waxdb-expected',
					'waxdb-signature',
					'waxdb-data-hash',
					'waxdb-read-expires',
					'waxdb-read-signature',
				]) {
					expect(allowed, `missing ${required}`).toContain(required);
				}
			});

			it('answers a preflight', async () => {
				const response = await harness.fetch({
					method: 'OPTIONS',
					path: recordPath(uniqueNamespace(), owner),
				});
				expect(response.status).toBe(204);
				expect(response.headers.get('access-control-max-age')).toBe('86400');
			});
		});

		// ------------------------------------------------------------------
		// Routing
		// ------------------------------------------------------------------

		describe('routing', () => {
			it('rejects a verb outside the protocol with 405', async () => {
				const response = await harness.fetch({
					method: 'POST',
					path: recordPath(uniqueNamespace(), owner),
					body: 'x',
				});
				expect(response.status).toBe(405);
				await expectError(response, 'method_not_allowed');
			});

			it('answers an unserved path with 404 in the error shape', async () => {
				const response = await harness.fetch({method: 'GET', path: '/'});
				expect(response.status).toBe(404);
				await expectError(response, 'not_found');
			});
		});

		// ------------------------------------------------------------------
		// Field forms: rejected, never normalised (DECISIONS.md #10)
		// ------------------------------------------------------------------

		describe('field forms', () => {
			/**
			 * Namespaces that reach the handler and must be rejected there.
			 *
			 * The separator case is sent percent-encoded on purpose: `%2F` is the
			 * one form that survives URL parsing and arrives as a literal `/`, so it
			 * is the only way a client could try to smuggle a second key segment.
			 */
			const badNamespaces: [string, string][] = [
				['uppercase', 'Conquest'],
				['a colon, illegal in Windows filenames', 'conquest-0xab:0xcd'],
				['an encoded slash, which would split the key', '%2F'],
				['an encoded slash between segments', 'a%2Fb'],
				['a leading dot', '.hidden'],
				['a space', 'has%20space'],
				['a tilde', 'a~b'],
				['one byte over NAME_MAX', 'a'.repeat(256)],
			];

			for (const [label, namespace] of badNamespaces) {
				it(`rejects a namespace with ${label}`, async () => {
					const response = await harness.fetch({
						method: 'GET',
						path: `/records/${namespace}/${owner}`,
					});
					expect(response.status).toBe(400);
					await expectError(response, 'invalid_namespace');
				});
			}

			/**
			 * `.`, `..` and the empty string cannot reach the handler at all: the
			 * WHATWG URL parser resolves dot segments before the request is made,
			 * including percent-encoded ones (`%2E%2E` is decoded and then
			 * collapsed), and an empty segment leaves a `//` that matches no route.
			 * So what a client observes is "that is not a record path", not
			 * "that namespace is invalid".
			 *
			 * The rule against them in `isValidNamespace` is therefore protecting
			 * the *storage key*, where the directory backend turns it into a
			 * filesystem path, and it is unit-tested there rather than here. That it
			 * is unreachable over HTTP is a property worth pinning, because it is
			 * what makes traversal structurally impossible rather than merely
			 * checked.
			 */
			for (const [label, namespace] of [
				['dot', '.'],
				['dot dot', '..'],
				['encoded dot dot', '%2E%2E'],
				['empty', ''],
			] as [string, string][]) {
				it(`answers 404 for ${label}, which the URL layer collapses`, async () => {
					const response = await harness.fetch({
						method: 'GET',
						path: `/records/${namespace}/${owner}`,
					});
					expect(response.status).toBe(404);
					await expectError(response, 'not_found');
				});
			}

			it('accepts the full legal namespace charset', async () => {
				const namespace = `${uniqueNamespace()}_a-b.c0`;
				await seed(namespace, bytes('ok'));
				const response = await get(namespace);
				expect(response.status).toBe(200);
			});

			/**
			 * 255 is `NAME_MAX`, so this is the longest namespace that can be a
			 * directory name. The limit is one byte below the round number for
			 * exactly that reason: at 256 Cloudflare accepts the write and a
			 * file-backed store fails with ENAMETOOLONG.
			 */
			it('accepts a 255 character namespace', async () => {
				const namespace = ('n' + uniqueNamespace().replace(/\./g, '-')).padEnd(
					255,
					'x',
				);
				expect(namespace.length).toBe(255);
				await seed(namespace, bytes('ok'));
				expect((await get(namespace)).status).toBe(200);
			});

			for (const [label, badOwner] of [
				['too short', '0x1234'],
				['no 0x', 'a'.repeat(40)],
				['not hex', `0x${'z'.repeat(40)}`],
			] as [string, string][]) {
				it(`rejects an owner that is ${label}`, async () => {
					const response = await harness.fetch({
						method: 'GET',
						path: `/records/${uniqueNamespace()}/${badOwner}`,
					});
					expect(response.status).toBe(400);
					await expectError(response, 'invalid_owner');
				});
			}

			/**
			 * The owner may be sent in any case in a URL and is lowercased before
			 * use. The signed message always uses the lowercase form.
			 */
			it('accepts a checksummed owner in the URL', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('mixed case'));
				const response = await harness.fetch({
					method: 'GET',
					path: recordPath(namespace, wallet.address),
					headers: await readAuth(namespace),
				});
				expect(response.status).toBe(200);
			});

			/**
			 * DECISIONS.md #10: the predecessor normalised counters through
			 * BigInt, so a client that padded its counter got an unexplained
			 * invalid-signature error. A non-canonical counter is now an error.
			 */
			for (const [label, counter] of [
				['leading zeros', '0123'],
				['hex', '0x10'],
				['an exponent', '1e3'],
				['a sign', '+5'],
				['a decimal point', '1.0'],
				['empty', ''],
			] as [string, string][]) {
				it(`rejects a counter with ${label}, never normalising it`, async () => {
					const namespace = uniqueNamespace();
					const payload = bytes('x');
					const response = await harness.fetch({
						method: 'PUT',
						path: recordPath(namespace, owner),
						headers: {
							'Waxdb-Counter': counter,
							'Waxdb-Expected': 'any',
							'Waxdb-Data-Hash': await sha256Hex(payload),
							'Waxdb-Signature': `0x${'11'.repeat(65)}`,
						},
						body: payload,
					});
					expect(response.status).toBe(400);
					await expectError(response, 'invalid_counter');
				});
			}

			/**
			 * HTTP strips leading and trailing whitespace from a header value before
			 * anything sees it, so ` 5` and `5` are the same request on the wire.
			 * That is the transport normalising, not the server: the counter reaches
			 * validation already canonical and gets as far as signature
			 * verification. Pinned so nobody later "fixes" it by trimming in the
			 * handler, which would be a normalisation the protocol forbids.
			 */
			it('never sees whitespace around a counter, because HTTP trims it', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('x');
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Counter': ' 5',
						'Waxdb-Expected': 'any',
						'Waxdb-Data-Hash': await sha256Hex(payload),
						'Waxdb-Signature': `0x${'11'.repeat(65)}`,
					},
					body: payload,
				});
				// past invalid_counter, so the value arrived as "5"
				expect(response.status).toBe(401);
			});

			it('requires Waxdb-Counter', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('x');
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Data-Hash': await sha256Hex(payload),
						'Waxdb-Signature': `0x${'11'.repeat(65)}`,
					},
					body: payload,
				});
				expect(response.status).toBe(400);
				await expectError(response, 'invalid_counter');
			});

			it('accepts counter 0, which is a real counter and not absence', async () => {
				const namespace = uniqueNamespace();
				const response = await put(namespace, {
					counter: '0',
					payload: bytes('zero'),
				});
				expect(response.status).toBe(200);
				expect((await response.json()).counter).toBe('0');
			});

			it('rejects a non-canonical Expected', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('x');
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Counter': '5',
						'Waxdb-Expected': 'maybe',
						'Waxdb-Data-Hash': await sha256Hex(payload),
						'Waxdb-Signature': `0x${'11'.repeat(65)}`,
					},
					body: payload,
				});
				expect(response.status).toBe(400);
				await expectError(response, 'invalid_expected');
			});

			it('rejects a malformed signature as a format error', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('x');
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Counter': '5',
						'Waxdb-Data-Hash': await sha256Hex(payload),
						'Waxdb-Signature': '0xdeadbeef',
					},
					body: payload,
				});
				expect(response.status).toBe(400);
				await expectError(response, 'invalid_signature_format');
			});

			it('rejects an uppercase data hash', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('x');
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Counter': '5',
						'Waxdb-Data-Hash': (await sha256Hex(payload)).toUpperCase(),
						'Waxdb-Signature': `0x${'11'.repeat(65)}`,
					},
					body: payload,
				});
				expect(response.status).toBe(400);
				await expectError(response, 'invalid_data_hash');
			});

			/**
			 * The header is not what the server hashes. It exists so a truncated
			 * upload is reported as data_hash_mismatch rather than as a
			 * misleading signature_mismatch.
			 */
			it('reports a body that does not match the declared hash', async () => {
				const namespace = uniqueNamespace();
				const response = await put(namespace, {
					counter: '5',
					payload: bytes('actual body'),
					declaredHash: await sha256Hex(bytes('something else')),
				});
				expect(response.status).toBe(400);
				await expectError(response, 'data_hash_mismatch');
			});
		});

		// ------------------------------------------------------------------
		// Write and read
		// ------------------------------------------------------------------

		describe('write and read', () => {
			it('round trips a payload byte for byte', async () => {
				const namespace = uniqueNamespace();
				// every byte value, so nothing can be silently re-encoded
				const payload = new Uint8Array(256);
				for (let i = 0; i < 256; i++) payload[i] = i;

				await seed(namespace, payload);

				const response = await get(namespace);
				expect(response.status).toBe(200);
				expect(response.headers.get('content-type')).toBe(
					'application/octet-stream',
				);
				const received = new Uint8Array(await response.arrayBuffer());
				expect([...received]).toEqual([...payload]);
			});

			it('returns the record headers', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('with headers');
				await seed(namespace, payload, '1234');

				const response = await get(namespace);
				expect(response.headers.get('waxdb-counter')).toBe('1234');
				expect(response.headers.get('etag')).toBe('"1234"');
				expect(response.headers.get('cache-control')).toBe('no-cache');
				expect(response.headers.get('waxdb-deleted')).toBe('false');
				expect(response.headers.get('waxdb-data-hash')).toBe(
					await sha256Hex(payload),
				);
				expect(response.headers.get('waxdb-signature')).toMatch(
					/^0x[0-9a-fA-F]{130}$/,
				);
			});

			/**
			 * The stored signature must verify against the message the client
			 * signed, which is only checkable because the data hash is stored
			 * alongside it rather than recomputed.
			 */
			it('returns a signature that verifies against the stored data hash', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('verifiable');
				await seed(namespace, payload, '77');

				const response = await get(namespace);
				const signature = response.headers.get('waxdb-signature')!;
				const dataHash = response.headers.get('waxdb-data-hash')!;
				const message = storeMessage({
					namespace,
					owner,
					counter: '77',
					expected: 'any',
					dataHash,
				});
				const {verifyMessage} = await import('@ethersproject/wallet');
				expect(verifyMessage(message, signature).toLowerCase()).toBe(owner);
			});

			it('stores an empty payload as a real record, not a tombstone', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, new Uint8Array(0));

				const response = await get(namespace);
				expect(response.status).toBe(200);
				expect(response.headers.get('waxdb-deleted')).toBe('false');
				expect((await response.arrayBuffer()).byteLength).toBe(0);
			});

			it('answers absence with 404 and {"found": false}', async () => {
				const response = await get(uniqueNamespace());
				expect(response.status).toBe(404);
				expect(response.headers.get('content-type')).toBe('application/json');
				const body = await response.json();
				expect(body).toEqual({found: false});
				// absence is an answer, not a failure
				expect(body).not.toHaveProperty('error');
			});

			it('overwrites at a higher counter', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('first'), '10');
				expect(
					(await put(namespace, {counter: '20', payload: bytes('second')}))
						.status,
				).toBe(200);

				const response = await get(namespace);
				expect(await response.text()).toBe('second');
				expect(response.headers.get('waxdb-counter')).toBe('20');
			});

			it('handles a payload larger than one stream chunk', async () => {
				const namespace = uniqueNamespace();
				const size = Math.min(1024 * 1024, harness.maxPayloadBytes);
				const payload = new Uint8Array(size);
				for (let i = 0; i < size; i++) payload[i] = (i * 31) & 0xff;

				await seed(namespace, payload);
				const received = new Uint8Array(
					await (await get(namespace)).arrayBuffer(),
				);
				expect(received.byteLength).toBe(size);
				expect(received[0]).toBe(payload[0]);
				expect(received[size - 1]).toBe(payload[size - 1]);
			});
		});

		// ------------------------------------------------------------------
		// Counter rules
		// ------------------------------------------------------------------

		describe('counter rules', () => {
			it('rejects an equal counter, with the current record attached', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('a'), '100');

				const response = await put(namespace, {
					counter: '100',
					payload: bytes('b'),
				});
				expect(response.status).toBe(409);
				const body = await response.json();
				expect(body.ok).toBe(false);
				expect(body.error.code).toBe('counter_not_increasing');
				// so a client can converge without a second round trip
				expect(body.current).toEqual({
					found: true,
					counter: '100',
					deleted: false,
				});
				// a response never carries both a result and an error
				expect(body).not.toHaveProperty('counter');
			});

			it('rejects a lower counter', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('a'), '100');
				const response = await put(namespace, {
					counter: '99',
					payload: bytes('b'),
				});
				expect(response.status).toBe(409);
				await expectError(response, 'counter_not_increasing');
			});

			it('accepts any counter when no record exists', async () => {
				const namespace = uniqueNamespace();
				const response = await put(namespace, {
					counter: '1',
					payload: bytes('fresh'),
				});
				expect(response.status).toBe(200);
			});

			/**
			 * Rule 3, which bounds the damage from a client with a broken clock:
			 * without it one absurd write bricks a record permanently, for
			 * everybody including the owner (DECISIONS.md #4).
			 */
			it('rejects a counter beyond the clock ceiling', async () => {
				const namespace = uniqueNamespace();
				const response = await put(namespace, {
					counter: String(Date.now() + 10 * 60 * 1000),
					payload: bytes('too far ahead'),
				});
				expect(response.status).toBe(400);
				await expectError(response, 'counter_in_future');
				// carries the server clock so a client can measure its own skew
				const serverTime = response.headers.get('waxdb-server-time');
				expect(serverTime).toMatch(/^\d+$/);
				// generous, because this only has to prove it is a wall clock in
				// milliseconds rather than seconds or a counter
				expect(Math.abs(Number(serverTime) - Date.now())).toBeLessThan(
					10 * 60_000,
				);
			});

			it('accepts a counter inside the 60 second tolerance', async () => {
				const namespace = uniqueNamespace();
				const response = await put(namespace, {
					counter: String(Date.now() + 30_000),
					payload: bytes('slightly ahead'),
				});
				expect(response.status).toBe(200);
			});
		});

		// ------------------------------------------------------------------
		// Preconditions
		// ------------------------------------------------------------------

		describe('preconditions', () => {
			it('applies a "none" write only when nothing exists', async () => {
				const namespace = uniqueNamespace();
				expect(
					(
						await put(namespace, {
							counter: '10',
							expected: 'none',
							payload: bytes('first push'),
						})
					).status,
				).toBe(200);

				const second = await put(namespace, {
					counter: '20',
					expected: 'none',
					payload: bytes('second device'),
				});
				expect(second.status).toBe(409);
				const body = await second.json();
				expect(body.error.code).toBe('precondition_failed');
				expect(body.current).toEqual({
					found: true,
					counter: '10',
					deleted: false,
				});
			});

			it('applies an exact-counter write only on a match', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('a'), '10');

				const stale = await put(namespace, {
					counter: '30',
					expected: '5',
					payload: bytes('stale'),
				});
				expect(stale.status).toBe(409);
				await expectError(stale, 'precondition_failed');

				const fresh = await put(namespace, {
					counter: '30',
					expected: '10',
					payload: bytes('fresh'),
				});
				expect(fresh.status).toBe(200);
			});

			it('reports a missing record for an exact-counter precondition', async () => {
				const namespace = uniqueNamespace();
				const response = await put(namespace, {
					counter: '10',
					expected: '5',
					payload: bytes('x'),
				});
				expect(response.status).toBe(409);
				expect((await response.json()).current).toEqual({found: false});
			});

			it('treats an absent Waxdb-Expected as "any"', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('no expected header');
				const dataHash = await sha256Hex(payload);
				const signature = await wallet.signMessage(
					storeMessage({
						namespace,
						owner,
						counter: '10',
						expected: 'any',
						dataHash,
					}),
				);
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Counter': '10',
						'Waxdb-Data-Hash': dataHash,
						'Waxdb-Signature': signature,
					},
					body: payload,
				});
				expect(response.status).toBe(200);
			});

			/** Expected is signed, so a proxy cannot downgrade it to `any` */
			it('rejects a stripped precondition, because it is signed', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('x');
				const dataHash = await sha256Hex(payload);
				// signed with none, sent as any
				const signature = await wallet.signMessage(
					storeMessage({
						namespace,
						owner,
						counter: '10',
						expected: 'none',
						dataHash,
					}),
				);
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Counter': '10',
						'Waxdb-Expected': 'any',
						'Waxdb-Data-Hash': dataHash,
						'Waxdb-Signature': signature,
					},
					body: payload,
				});
				expect(response.status).toBe(401);
				await expectError(response, 'signature_mismatch');
			});
		});

		// ------------------------------------------------------------------
		// Signature verification
		// ------------------------------------------------------------------

		describe('signature verification', () => {
			it('rejects a signature from another key', async () => {
				const namespace = uniqueNamespace();
				const stranger = Wallet.createRandom();
				const payload = bytes('not yours');
				const dataHash = await sha256Hex(payload);
				const signature = await stranger.signMessage(
					storeMessage({
						namespace,
						owner,
						counter: '10',
						expected: 'any',
						dataHash,
					}),
				);
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Counter': '10',
						'Waxdb-Expected': 'any',
						'Waxdb-Data-Hash': dataHash,
						'Waxdb-Signature': signature,
					},
					body: payload,
				});
				expect(response.status).toBe(401);
				await expectError(response, 'signature_mismatch');
			});

			it('rejects a message signed for a different counter', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('x');
				const dataHash = await sha256Hex(payload);
				const signature = await wallet.signMessage(
					storeMessage({
						namespace,
						owner,
						counter: '11',
						expected: 'any',
						dataHash,
					}),
				);
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Counter': '10',
						'Waxdb-Expected': 'any',
						'Waxdb-Data-Hash': dataHash,
						'Waxdb-Signature': signature,
					},
					body: payload,
				});
				expect(response.status).toBe(401);
			});

			/**
			 * The signed message uses the lowercase owner, so a client that signs
			 * a checksummed spelling fails verification rather than writing
			 * something it did not intend.
			 */
			it('rejects a message signed with a checksummed owner', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('x');
				const dataHash = await sha256Hex(payload);
				const signature = await wallet.signMessage(
					storeMessage({
						namespace,
						owner: wallet.address, // checksummed
						counter: '10',
						expected: 'any',
						dataHash,
					}),
				);
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Counter': '10',
						'Waxdb-Expected': 'any',
						'Waxdb-Data-Hash': dataHash,
						'Waxdb-Signature': signature,
					},
					body: payload,
				});
				expect(response.status).toBe(401);
			});

			/**
			 * The two headers give the two intents different bytes, so a store
			 * signature can never be replayed as a delete.
			 */
			it('will not accept a store signature as a delete', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('x');
				const dataHash = await sha256Hex(payload);
				const storeSignature = await wallet.signMessage(
					storeMessage({
						namespace,
						owner,
						counter: '10',
						expected: 'any',
						dataHash,
					}),
				);
				const response = await harness.fetch({
					method: 'DELETE',
					path: recordPath(namespace, owner),
					headers: {
						'Waxdb-Counter': '10',
						'Waxdb-Expected': 'any',
						'Waxdb-Signature': storeSignature,
					},
				});
				expect(response.status).toBe(401);
				await expectError(response, 'signature_mismatch');
			});

			it('will not accept a delete signature as a store', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('x');
				const deleteHeaders = await signDelete(wallet, {
					namespace,
					counter: '10',
				});
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						...deleteHeaders,
						'Waxdb-Data-Hash': await sha256Hex(payload),
					},
					body: payload,
				});
				expect(response.status).toBe(401);
			});

			/**
			 * THE LEAK DEFENCE. If storage were consulted first, the difference
			 * between signature_mismatch and counter_not_increasing would tell an
			 * unauthenticated prober whether a record exists, handing back through
			 * the write path exactly what the read path refuses to say.
			 */
			it('verifies the signature before it consults storage', async () => {
				const existing = uniqueNamespace();
				const absent = uniqueNamespace();
				await seed(existing, bytes('a record that exists'), '5000');

				// a bad signature and a stale counter against a record that exists
				const badAgainstExisting = await probeWithBadSignature(existing);
				// the same request against a namespace with nothing in it
				const badAgainstAbsent = await probeWithBadSignature(absent);

				// identical, so the prober learns nothing
				expect(badAgainstExisting.status).toBe(401);
				expect(badAgainstAbsent.status).toBe(401);
				expect(badAgainstExisting.body).toEqual(badAgainstAbsent.body);
			});

			async function probeWithBadSignature(namespace: string) {
				const payload = bytes('probe');
				const response = await harness.fetch({
					method: 'PUT',
					path: recordPath(namespace, owner),
					headers: {
						// a counter that would be rejected as not increasing, if the
						// server ever got as far as looking
						'Waxdb-Counter': '1',
						'Waxdb-Expected': 'any',
						'Waxdb-Data-Hash': await sha256Hex(payload),
						'Waxdb-Signature': `0x${'11'.repeat(65)}`,
					},
					body: payload,
				});
				return {status: response.status, body: await response.json()};
			}
		});

		// ------------------------------------------------------------------
		// Delete, as a tombstone
		// ------------------------------------------------------------------

		describe('delete', () => {
			it('writes a tombstone that reads back as a record', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('doomed'), '10');

				const deleted = await del(namespace, {counter: '20'});
				expect(deleted.status).toBe(200);
				expect(await deleted.json()).toEqual({
					ok: true,
					counter: '20',
					deleted: true,
				});

				// a tombstone is 200, not 404 and not 410: a client needs its
				// counter to write again, so it arrives on the success path
				const response = await get(namespace);
				expect(response.status).toBe(200);
				expect(response.headers.get('waxdb-deleted')).toBe('true');
				expect(response.headers.get('waxdb-counter')).toBe('20');
				expect((await response.arrayBuffer()).byteLength).toBe(0);
			});

			/** a tombstone has no signed Data: line, so it has no payload hash */
			it('omits the data hash on a tombstone', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('doomed'), '10');
				await del(namespace, {counter: '20'});

				const response = await get(namespace);
				expect(response.headers.get('waxdb-data-hash')).toBeNull();
			});

			/**
			 * DECISIONS.md #7: the predecessor's reset took the counter back to
			 * zero, which re-enabled every harvested signature. A tombstone is a
			 * record, so it raises the bar for everything after it.
			 */
			it('keeps the high-water mark after a delete', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('a'), '10');
				await del(namespace, {counter: '20'});

				const replay = await put(namespace, {
					counter: '15',
					payload: bytes('replayed'),
				});
				expect(replay.status).toBe(409);
				await expectError(replay, 'counter_not_increasing');
			});

			it('allows a write above the tombstone', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('a'), '10');
				await del(namespace, {counter: '20'});

				expect(
					(await put(namespace, {counter: '30', payload: bytes('reborn')}))
						.status,
				).toBe(200);
				const response = await get(namespace);
				expect(response.headers.get('waxdb-deleted')).toBe('false');
				expect(await response.text()).toBe('reborn');
			});

			it('can delete a record that does not exist', async () => {
				const namespace = uniqueNamespace();
				expect((await del(namespace, {counter: '5'})).status).toBe(200);
				const response = await get(namespace);
				expect(response.status).toBe(200);
				expect(response.headers.get('waxdb-deleted')).toBe('true');
			});
		});

		// ------------------------------------------------------------------
		// Conditional reads and HEAD
		// ------------------------------------------------------------------

		describe('conditional reads', () => {
			it('answers 304 for a matching If-None-Match', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('cached'), '42');

				const response = await get(namespace, {'If-None-Match': '"42"'});
				expect(response.status).toBe(304);
				expect(await response.text()).toBe('');
			});

			it('answers 200 for a stale If-None-Match', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('changed'), '42');

				const response = await get(namespace, {'If-None-Match': '"41"'});
				expect(response.status).toBe(200);
				expect(await response.text()).toBe('changed');
			});

			it('honours a weak validator and a list', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('cached'), '42');
				expect((await get(namespace, {'If-None-Match': 'W/"42"'})).status).toBe(
					304,
				);
				expect(
					(await get(namespace, {'If-None-Match': '"1", "42"'})).status,
				).toBe(304);
			});

			it('does not 304 a record that is absent', async () => {
				const response = await get(uniqueNamespace(), {
					'If-None-Match': '"42"',
				});
				expect(response.status).toBe(404);
			});
		});

		describe('HEAD', () => {
			it('returns the record headers with no body', async () => {
				const namespace = uniqueNamespace();
				const payload = bytes('head me');
				await seed(namespace, payload, '42');

				const response = await head(namespace);
				expect(response.status).toBe(200);
				expect(response.headers.get('waxdb-counter')).toBe('42');
				expect(response.headers.get('etag')).toBe('"42"');
				expect(response.headers.get('waxdb-data-hash')).toBe(
					await sha256Hex(payload),
				);
				expect((await response.arrayBuffer()).byteLength).toBe(0);
			});

			it('answers absence with 404', async () => {
				expect((await head(uniqueNamespace())).status).toBe(404);
			});

			it('answers 304 for a matching If-None-Match', async () => {
				const namespace = uniqueNamespace();
				await seed(namespace, bytes('x'), '42');
				expect((await head(namespace, {'If-None-Match': '"42"'})).status).toBe(
					304,
				);
			});
		});

		// ------------------------------------------------------------------
		// Read authentication
		// ------------------------------------------------------------------

		describe(
			harness.publicReads ? 'public reads' : 'authenticated reads',
			() => {
				if (harness.publicReads) {
					it('serves a read with no token at all', async () => {
						const namespace = uniqueNamespace();
						await seed(namespace, bytes('open'));
						const response = await harness.fetch({
							method: 'GET',
							path: recordPath(namespace, owner),
						});
						expect(response.status).toBe(200);
						expect(await response.text()).toBe('open');
					});

					it('ignores a malformed token rather than rejecting it', async () => {
						const namespace = uniqueNamespace();
						await seed(namespace, bytes('open'));
						const response = await harness.fetch({
							method: 'GET',
							path: recordPath(namespace, owner),
							headers: {
								'Waxdb-Read-Expires': 'not-a-number',
								'Waxdb-Read-Signature': 'nonsense',
							},
						});
						expect(response.status).toBe(200);
					});
					return;
				}

				it('serves a read with a valid token', async () => {
					const namespace = uniqueNamespace();
					await seed(namespace, bytes('private'));
					const response = await harness.fetch({
						method: 'GET',
						path: recordPath(namespace, owner),
						headers: await signReadToken(wallet, {namespace}),
					});
					expect(response.status).toBe(200);
					expect(await response.text()).toBe('private');
				});

				/**
				 * Every one of these answers exactly what absence answers. A 401
				 * would tell an unauthenticated prober that a record exists, which
				 * is precisely the metadata the token protects.
				 */
				it('answers 404 with no token, identically to absence', async () => {
					const namespace = uniqueNamespace();
					await seed(namespace, bytes('private'));

					const present = await harness.fetch({
						method: 'GET',
						path: recordPath(namespace, owner),
					});
					const absent = await harness.fetch({
						method: 'GET',
						path: recordPath(uniqueNamespace(), owner),
					});

					expect(present.status).toBe(404);
					expect(absent.status).toBe(404);
					expect(await present.json()).toEqual({found: false});
					expect(await absent.json()).toEqual({found: false});
					// nothing in the headers distinguishes them either
					expect(present.headers.get('waxdb-counter')).toBeNull();
				});

				it('answers 404 for a token signed by the wrong key', async () => {
					const namespace = uniqueNamespace();
					await seed(namespace, bytes('private'));
					const stranger = Wallet.createRandom();
					const expires = String(Math.floor(Date.now() / 1000) + 300);
					const signature = await stranger.signMessage(
						`waxdb read\nNamespace: ${namespace}\nOwner: ${owner}\nExpires: ${expires}`,
					);
					const response = await harness.fetch({
						method: 'GET',
						path: recordPath(namespace, owner),
						headers: {
							'Waxdb-Read-Expires': expires,
							'Waxdb-Read-Signature': signature,
						},
					});
					expect(response.status).toBe(404);
					expect(await response.json()).toEqual({found: false});
				});

				it('answers 404 for an expired token', async () => {
					const namespace = uniqueNamespace();
					await seed(namespace, bytes('private'));
					const response = await harness.fetch({
						method: 'GET',
						path: recordPath(namespace, owner),
						headers: await signReadToken(wallet, {
							namespace,
							// beyond the 60 second skew tolerance
							expiresInSeconds: -600,
						}),
					});
					expect(response.status).toBe(404);
				});

				/**
				 * An already-expired token still works inside the 60 second skew
				 * tolerance, so a client whose clock runs slightly behind is not
				 * locked out of its own data.
				 *
				 * Deliberately only a few seconds in the past. The assertion is
				 * "expiry in the past is still accepted", which any non-zero
				 * tolerance satisfies, and a bigger number would only buy a test
				 * that fails when the suite itself is slow: the tolerance is
				 * measured against the server's clock at request time, not at
				 * signing time.
				 */
				it('accepts a token just inside the skew tolerance', async () => {
					const namespace = uniqueNamespace();
					await seed(namespace, bytes('private'));
					const response = await harness.fetch({
						method: 'GET',
						path: recordPath(namespace, owner),
						headers: await signReadToken(wallet, {
							namespace,
							expiresInSeconds: -5,
						}),
					});
					expect(response.status).toBe(200);
				});

				it('answers 404 for an absurdly long-lived token', async () => {
					const namespace = uniqueNamespace();
					await seed(namespace, bytes('private'));
					const response = await harness.fetch({
						method: 'GET',
						path: recordPath(namespace, owner),
						headers: await signReadToken(wallet, {
							namespace,
							expiresInSeconds: 100 * 365 * 24 * 3600,
						}),
					});
					expect(response.status).toBe(404);
				});

				it('answers 404 for a token bound to another namespace', async () => {
					const namespace = uniqueNamespace();
					await seed(namespace, bytes('private'));
					const response = await harness.fetch({
						method: 'GET',
						path: recordPath(namespace, owner),
						headers: await signReadToken(wallet, {
							namespace: uniqueNamespace(),
						}),
					});
					expect(response.status).toBe(404);
				});

				/**
				 * The one exception, and the reason it is safe: a malformed token
				 * is decided before any storage lookup, so it reveals nothing about
				 * the record while staying debuggable.
				 */
				it('answers 400 for a malformed token, never 401', async () => {
					const namespace = uniqueNamespace();
					await seed(namespace, bytes('private'));
					const response = await harness.fetch({
						method: 'GET',
						path: recordPath(namespace, owner),
						headers: {
							'Waxdb-Read-Expires': '0123',
							'Waxdb-Read-Signature': `0x${'11'.repeat(65)}`,
						},
					});
					expect(response.status).toBe(400);
					await expectError(response, 'invalid_read_token');
				});

				it('answers 400 for a half-sent token', async () => {
					const response = await harness.fetch({
						method: 'GET',
						path: recordPath(uniqueNamespace(), owner),
						headers: {
							'Waxdb-Read-Expires': String(Math.floor(Date.now() / 1000) + 300),
						},
					});
					expect(response.status).toBe(400);
					await expectError(response, 'invalid_read_token');
				});

				it('applies the same rules to HEAD', async () => {
					const namespace = uniqueNamespace();
					await seed(namespace, bytes('private'));
					const response = await harness.fetch({
						method: 'HEAD',
						path: recordPath(namespace, owner),
					});
					expect(response.status).toBe(404);
				});

				/** a write needs no read token: the two paths are separate */
				it('does not require a read token to write', async () => {
					const namespace = uniqueNamespace();
					const response = await put(namespace, {
						counter: '10',
						payload: bytes('written without a read token'),
					});
					expect(response.status).toBe(200);
				});
			},
		);

		// ------------------------------------------------------------------
		// Limits
		// ------------------------------------------------------------------

		describe('limits', () => {
			it('rejects a payload above the cap', async () => {
				const namespace = uniqueNamespace();
				const payload = new Uint8Array(harness.maxPayloadBytes + 1024);
				const response = await put(namespace, {counter: '10', payload});
				expect(response.status).toBe(413);
				await expectError(response, 'payload_too_large');
			});

			it('accepts a payload at the cap', async () => {
				const namespace = uniqueNamespace();
				const payload = new Uint8Array(harness.maxPayloadBytes);
				payload[0] = 7;
				const response = await put(namespace, {counter: '10', payload});
				expect(response.status).toBe(200);
			});
		});
	});
}

// ---------------------------------------------------------------------------

function expectCors(response: Response) {
	expect(response.headers.get('access-control-allow-origin')).toBe('*');
	expect(response.headers.get('access-control-allow-methods')).toBe(
		'GET,HEAD,PUT,DELETE,OPTIONS',
	);
	expect(response.headers.get('access-control-max-age')).toBe('86400');
}

async function expectError(response: Response, code: string) {
	expect(response.headers.get('content-type')).toBe('application/json');
	const body = await response.json();
	expect(body.ok).toBe(false);
	expect(body.error.code).toBe(code);
	// messages are for a human reading a log, and must never carry engine text
	expect(typeof body.error.message).toBe('string');
	expect(body.error.message.length).toBeGreaterThan(0);
	expect(body.error.message).not.toMatch(/\bat .*\(.*:\d+:\d+\)/);
}
