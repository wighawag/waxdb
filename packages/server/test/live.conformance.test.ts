/**
 * The contract, against a deployed instance. Opt-in.
 *
 * ```bash
 * LIVE_URL=https://waxdb.example.workers.dev pnpm test:live
 * LIVE_URL=… LIVE_PUBLIC_READS=true LIVE_MAX_PAYLOAD_BYTES=10485760 pnpm test:live
 * ```
 *
 * **It writes to that deployment.** Every test signs with a freshly generated
 * key and a namespace no other run uses, so it cannot touch an existing
 * record, but it does create records that nothing later removes, and it counts
 * against the deployment's KV write quota. On Workers Free that quota is 1,000
 * writes a day and this suite spends a few hundred, so do not point it at a
 * free-tier deployment you care about.
 *
 * Skipped entirely when `LIVE_URL` is unset, which is why it can live in the
 * default test run without needing a network.
 */
import {describe, it} from 'vitest';
import {runContractTests} from './contract/contract.js';
import type {ContractHarness} from './contract/harness.js';

const url = process.env.LIVE_URL;

if (!url) {
	describe('live conformance', () => {
		it.skip('set LIVE_URL to run the contract against a deployment', () => {});
	});
} else {
	const base = url.replace(/\/$/, '');

	const harness: ContractHarness = {
		name: `live (${base})`,
		publicReads: process.env.LIVE_PUBLIC_READS === 'true',
		maxPayloadBytes: Number(
			process.env.LIVE_MAX_PAYLOAD_BYTES ?? 10 * 1024 * 1024,
		),
		// Real Cloudflare KV, unlike miniflare's, is eventually consistent. This
		// is the only harness where that is true, and declaring it is what lets
		// the shared contract distinguish a protocol failure from propagation.
		eventuallyConsistent: true,
		async fetch(init) {
			return fetch(`${base}${init.path}`, {
				method: init.method,
				headers: init.headers,
				body: init.body ?? undefined,
			});
		},
	};

	runContractTests(harness);
}
