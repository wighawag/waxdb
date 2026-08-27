/**
 * Extracts hash-wasm's raw keccak module to `keccak.wasm`.
 *
 * hash-wasm ships its WASM as base64 inside a JS bundle and compiles it at
 * import time, which workerd forbids. workerd will only accept a `.wasm` file
 * declared as a module in its config, so the blob has to come out of the
 * package first. There is no export for it, hence the interception below.
 *
 * The result is not committed: it is a build artifact of an MIT-licensed
 * dependency, and regenerating it is one command.
 */
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(import.meta.dirname, 'keccak.wasm');

const realCompile = WebAssembly.compile.bind(WebAssembly);
WebAssembly.compile = async (bytes) => {
	fs.writeFileSync(out, Buffer.from(bytes));
	return realCompile(bytes);
};

const {createKeccak} = await import('hash-wasm');
const h = await createKeccak(256);
h.init();
h.update(new TextEncoder().encode('waxdb'));
const digest = h.digest('hex');

const expected = '10bbf280dfc625d1a99288276dc40ea10265da1e46c6e81620aeee65a66ef0e3';
if (digest !== expected) {
	throw new Error(`keccak256("waxdb") = ${digest}, expected ${expected}`);
}
if (!fs.existsSync(out)) {
	throw new Error('hash-wasm did not compile a module; nothing was captured');
}

console.log(`wrote ${out} (${fs.statSync(out).size} bytes), keccak256 verified`);
