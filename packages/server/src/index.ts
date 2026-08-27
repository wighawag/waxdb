import {Hono} from 'hono';
import {Env} from './env.js';
import {registerRoutes} from './api/index.js';
import {setup} from './setup.js';
import {ServerOptions} from './types.js';

export type {Env};
export type {Meta, Record, Storage} from './storage.js';
export {StorageRateLimitError} from './storage.js';
export type {ServerOptions};

// The protocol layer, exported because a client needs exactly these pieces and
// a client that re-implements them is a client that can drift from the server.
export * from './protocol/index.js';

/**
 * The waxdb service (SPEC.md).
 *
 * Contains **no platform API**. It receives `getStorage` and `getEnv`
 * callbacks and each platform supplies its own, which is what lets one contract
 * suite run in-process, on workerd and on Node.
 */
export function createServer<CustomEnv extends Env>(
	options: ServerOptions<CustomEnv>,
) {
	const app = new Hono<{Bindings: CustomEnv}>();
	app.use(setup({serverOptions: options}));
	return registerRoutes(app);
}

export type App = ReturnType<typeof createServer>;
