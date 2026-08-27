/**
 * The bench worker. Runs on real workerd, not on miniflare-in-vitest.
 *
 * It exists to answer one question: what does hashing a payload cost inside a
 * Worker, for each hash the protocol could have chosen. The answer decided
 * SPEC.md's `Data:` line (DECISIONS.md #17).
 *
 * Two things shape the design:
 *
 *  - Payloads are generated once per isolate and cached, so a warm request pays
 *    for hashing and nothing else. Otherwise this measures buffer allocation.
 *  - Timing happens on the *client*, not here. `Date.now()` and
 *    `performance.now()` do not advance inside a Worker during pure compute
 *    (Spectre clamping: the clock moves only on I/O), so in-isolate timing
 *    reports zero. `drive.mjs` times requests from outside and subtracts a
 *    measured `alg=none` baseline.
 */
import {keccak_256} from '@noble/hashes/sha3.js';
import {sha256 as nobleSha256} from '@noble/hashes/sha2.js';
import {secp256k1} from '@noble/curves/secp256k1';
import jsSha3 from 'js-sha3';
import keccakModule from 'keccak.wasm';

const payloads = new Map();

function payload(size) {
	let p = payloads.get(size);
	if (!p) {
		p = new Uint8Array(size);
		// non-trivial content, so nothing downstream can special-case a zero page
		for (let i = 0; i < size; i++) p[i] = (i * 2654435761) & 0xff;
		payloads.set(size, p);
	}
	return p;
}

/**
 * hash-wasm's keccak, wired by hand.
 *
 * This is here to give keccak its best possible case, and it is deliberately
 * NOT a realistic option. workerd refuses to compile WebAssembly at runtime:
 *
 *   CompileError: WebAssembly.compile(): Wasm code generation disallowed by
 *   embedder
 *
 * hash-wasm, and every other npm WASM hashing package, compiles an embedded
 * base64 blob at import time, so all of them fail outright in a Worker. The
 * only legal path is a `wasmModule` in the worker config, which means
 * extracting the raw `.wasm` (see extract-keccak-wasm.mjs) and driving its
 * private, undocumented ABI directly. That is a vendored fork, not a
 * dependency, which is the point this column is making.
 */
const MAX_HEAP = 16 * 1024;
let wasm = null;

function wasmKeccakInit() {
	if (wasm) return wasm;
	const instance = new WebAssembly.Instance(keccakModule, {});
	const offset = instance.exports.Hash_GetBuffer();
	const view = new Uint8Array(instance.exports.memory.buffer, offset, MAX_HEAP);
	wasm = {instance, view};
	return wasm;
}

function wasmKeccak256(bytes) {
	const {instance, view} = wasmKeccakInit();
	instance.exports.Hash_Init(256);
	let read = 0;
	while (read < bytes.length) {
		const chunk = bytes.subarray(read, read + MAX_HEAP);
		read += chunk.length;
		view.set(chunk);
		instance.exports.Hash_Update(chunk.length);
	}
	instance.exports.Hash_Final(0x01); // keccak padding; sha3 would be 0x06
	return view.slice(0, 32);
}

/** a realistically-sized EIP-191 preimage: the store message, ~200 bytes */
const MSG = new TextEncoder().encode(
	'\x19Ethereum Signed Message:\n176' +
		'waxdb store\n' +
		'Namespace: some.app-namespace\n' +
		'Owner: 0x1111111111111111111111111111111111111111\n' +
		'Counter: 1756290000000\n' +
		'Expected: any\n' +
		'Data: 0x' +
		'ab'.repeat(32),
);
const PRIV = new Uint8Array(32).fill(7);
let SIG = null;

async function hashOnce(alg, bytes) {
	switch (alg) {
		case 'none':
			return bytes.byteLength & 0xff;
		case 'sha256-subtle': {
			const d = await crypto.subtle.digest('SHA-256', bytes);
			return new Uint8Array(d)[0];
		}
		case 'sha256-noble':
			// the fallback a browser needs outside a secure context, where
			// crypto.subtle is undefined
			return nobleSha256(bytes)[0];
		case 'keccak-noble':
			return keccak_256(bytes)[0];
		case 'keccak-jssha3':
			// what @ethersproject/keccak256 uses, so the default for most clients
			return new Uint8Array(jsSha3.keccak256.arrayBuffer(bytes))[0];
		case 'keccak-wasm':
			return wasmKeccak256(bytes)[0];
		case 'keccak-message':
			// the EIP-191 digest input: a few hundred bytes whatever the payload,
			// which is why keccak stays in the protocol for free
			return keccak_256(MSG)[0];
		case 'recover': {
			// one whole verification: keccak of the message, one secp256k1 public
			// key recovery, one keccak to derive the address. Constant cost,
			// independent of payload size. Signing is done once and cached, so this
			// measures recovery only.
			const digest = keccak_256(MSG);
			SIG ??= secp256k1.sign(digest, PRIV, {prehash: false});
			const pub = SIG.recoverPublicKey(digest).toRawBytes(false);
			return keccak_256(pub.subarray(1))[31];
		}
		default:
			throw new Error(`unknown alg ${alg}`);
	}
}

const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');

export default {
	async fetch(request) {
		const url = new URL(request.url);
		const alg = url.searchParams.get('alg') ?? 'none';

		// every keccak here must agree, or the comparison is meaningless
		if (alg === 'selftest') {
			const v = new TextEncoder().encode('waxdb');
			return Response.json({
				'keccak-noble': hex(keccak_256(v)),
				'keccak-jssha3': jsSha3.keccak256(v),
				'keccak-wasm': hex(wasmKeccak256(v)),
				'sha256-subtle': hex(
					new Uint8Array(await crypto.subtle.digest('SHA-256', v)),
				),
				'sha256-noble': hex(nobleSha256(v)),
			});
		}

		const size = Number(url.searchParams.get('size') ?? 1024);
		const iters = Number(url.searchParams.get('iters') ?? 1);
		const bytes = payload(size);

		let acc = 0;
		for (let i = 0; i < iters; i++) acc += await hashOnce(alg, bytes);

		return Response.json({alg, size, iters, acc});
	},
};
