import {Hono} from 'hono';
import {Env} from './env.js';
import {ServerOptions} from './types.js';
import {getJSONRPCAPI} from './api/jsonrpc.js';

export type {Env};
export type {Storage} from './storage.js';
export type {ServerOptions};
export type {StoredRecord} from './record.js';
export {storageKey, serialiseRecord, deserialiseRecord} from './record.js';

/**
 * The whole service is one JSON-RPC endpoint answering on every path and every
 * method, so there is no routing to speak of and, deliberately, no cors
 * middleware: the handler emits the exact header set live clients already get.
 */
export function createServer<CustomEnv extends Env>(
	options: ServerOptions<CustomEnv>,
) {
	const app = new Hono<{Bindings: CustomEnv}>();

	return app.route('/', getJSONRPCAPI(options));
}

export type App = ReturnType<typeof createServer>;
