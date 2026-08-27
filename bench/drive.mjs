/**
 * Drives the bench worker over HTTP and reports per-hash cost.
 *
 * Timing is done here rather than inside the Worker because a Worker's clock
 * does not advance during pure compute. The handler is pure compute over a
 * cached payload, so a warm request costs hashing plus a fixed per-request
 * overhead; that overhead is measured separately with `alg=none` at the same
 * size and iteration count, and subtracted.
 *
 * `min` is the headline rather than the median: the work is CPU-bound, so the
 * fastest sample is the one least contaminated by scheduler noise. The median
 * is printed alongside so a noisy run is visible rather than silent.
 */

const BASE = process.env.BENCH_URL ?? 'http://127.0.0.1:8787';

const SIZES = [
	['100 KB', 100_000],
	['1 MiB', 1024 * 1024],
	['10 MiB', 10 * 1024 * 1024],
];

const ALGS = [
	'sha256-subtle',
	'sha256-noble',
	'keccak-wasm',
	'keccak-jssha3',
	'keccak-noble',
];

/** enough iterations that fixed overhead is noise, few enough to finish */
function itersFor(size) {
	if (size <= 100_000) return 50;
	if (size <= 1024 * 1024) return 10;
	return 2;
}

async function timeOnce(alg, size, iters) {
	const t0 = performance.now();
	const r = await fetch(`${BASE}/?alg=${alg}&size=${size}&iters=${iters}`);
	await r.arrayBuffer();
	return performance.now() - t0;
}

async function measure(alg, size, iters, reps) {
	const samples = [];
	for (let i = 0; i < reps; i++) samples.push(await timeOnce(alg, size, iters));
	samples.sort((a, b) => a - b);
	return {min: samples[0], median: samples[Math.floor(samples.length / 2)]};
}

// every keccak must agree before any number means anything
const selftest = await (await fetch(`${BASE}/?alg=selftest`)).json();
const keccaks = new Set(
	Object.entries(selftest)
		.filter(([k]) => k.startsWith('keccak-'))
		.map(([, v]) => v),
);
if (keccaks.size !== 1) {
	console.error('keccak implementations disagree:', selftest);
	process.exit(1);
}
if (selftest['sha256-subtle'] !== selftest['sha256-noble']) {
	console.error('sha256 implementations disagree:', selftest);
	process.exit(1);
}
console.log(`selftest ok: keccak256("waxdb") = ${[...keccaks][0]}`);

const results = [];

for (const [label, size] of SIZES) {
	const iters = itersFor(size);

	// warm every path for this size before timing any of it, so JIT warmup and
	// payload generation are not billed to whichever alg happens to run first
	for (const alg of ['none', ...ALGS]) await timeOnce(alg, size, iters);

	const overhead = await measure('none', size, iters, 7);

	for (const alg of ALGS) {
		const total = await measure(alg, size, iters, 7);
		const msPerHash = (total.min - overhead.min) / iters;
		results.push({
			size: label,
			bytes: size,
			alg,
			msPerHash,
			msPerHashMedian: (total.median - overhead.median) / iters,
			mibPerSec: size / 1024 / 1024 / (msPerHash / 1000),
		});
	}
}

// the two constant costs, for context: keccak stays in the protocol for the
// EIP-191 digest, and every authenticated read pays one recovery
const constants = [];
{
	const size = 16;
	const iters = 200;
	for (const alg of ['none', 'keccak-message', 'recover']) {
		await timeOnce(alg, size, iters);
	}
	const overhead = await measure('none', size, iters, 9);
	for (const alg of ['keccak-message', 'recover']) {
		const total = await measure(alg, size, iters, 9);
		constants.push({
			alg,
			usPerOp: ((total.min - overhead.min) / iters) * 1000,
		});
	}
}

const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);

console.log();
console.log(
	`${pad('payload', 10)}${pad('algorithm', 16)}${padl('ms / hash', 12)}${padl('(median)', 11)}${padl('MiB/s', 9)}`,
);
console.log('-'.repeat(58));
let lastSize = null;
for (const r of results) {
	if (lastSize !== null && r.size !== lastSize) console.log();
	lastSize = r.size;
	console.log(
		`${pad(r.size, 10)}${pad(r.alg, 16)}${padl(r.msPerHash.toFixed(3), 12)}` +
			`${padl(r.msPerHashMedian.toFixed(3), 11)}${padl(r.mibPerSec.toFixed(0), 9)}`,
	);
}
console.log();
for (const c of constants) {
	console.log(`${pad(c.alg, 26)}${padl(c.usPerOp.toFixed(1), 10)} us`);
}
console.log();

fs_writeResults();

function fs_writeResults() {
	const out = new URL('./results.json', import.meta.url);
	const body = JSON.stringify(
		{measuredAt: new Date().toISOString(), results, constants},
		null,
		'\t',
	);
	import('node:fs').then((fs) => {
		fs.writeFileSync(out, body + '\n');
		console.log(`wrote ${out.pathname}`);
	});
}
