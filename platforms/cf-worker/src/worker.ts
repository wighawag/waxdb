import {createServer} from 'waxdb-server';
import type {CloudflareEnv} from './env.js';
import {KVStorage} from './storage.js';

export const app = createServer<CloudflareEnv>({
	getStorage: (c) => new KVStorage(c.env.RECORDS),
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
