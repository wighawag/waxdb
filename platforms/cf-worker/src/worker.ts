import {createServer} from 'secp256k1-db-server';
import type {CloudflareEnv} from './env.js';
import {KVStorage} from './storage.js';

export const app = createServer<CloudflareEnv>({
	getStorage: (c) => new KVStorage(c.env.PRIVATE_STORE),
	getEnv: (c) => c.env,
});

export default {
	fetch(
		request: Request,
		env: CloudflareEnv,
		ctx: ExecutionContext,
	): Response | Promise<Response> {
		return app.fetch(request, env, ctx);
	},
};
