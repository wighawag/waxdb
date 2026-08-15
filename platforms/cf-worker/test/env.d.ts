import type {CloudflareEnv} from '../src/env.js';

declare module 'cloudflare:test' {
	// Controls the type of `import("cloudflare:test").env`
	interface ProvidedEnv extends CloudflareEnv {}
}
