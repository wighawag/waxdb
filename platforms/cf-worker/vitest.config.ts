import {defineWorkersConfig} from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				// bindings come from wrangler.toml, but everything runs in miniflare
				// with isolated local storage: the real KV namespace is never touched
				wrangler: {configPath: './wrangler.toml'},
				miniflare: {
					// required by the pool itself; kept out of wrangler.toml so the
					// deployed worker's runtime flags stay exactly as they are today
					compatibilityFlags: ['nodejs_compat'],
				},
			},
		},
	},
});
