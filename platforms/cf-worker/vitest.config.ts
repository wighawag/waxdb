import {cloudflareTest} from '@cloudflare/vitest-pool-workers';
import {defineConfig} from 'vitest/config';

export default defineConfig({
	plugins: [
		// `@cloudflare/vitest-pool-workers` 0.22 replaced `defineWorkersConfig`
		// (imported from the now-removed `./config` subpath) with a Vite plugin.
		cloudflareTest({
			// bindings come from wrangler.toml, but everything runs in miniflare
			// with isolated local storage: the real KV namespace is never touched
			wrangler: {configPath: './wrangler.toml'},
			miniflare: {
				// required by the pool itself; kept out of wrangler.toml so the
				// deployed worker's runtime flags stay exactly as they are today
				compatibilityFlags: ['nodejs_compat'],
			},
		}),
	],
});
