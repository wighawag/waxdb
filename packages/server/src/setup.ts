import {MiddlewareHandler} from 'hono/types';
import {ServerOptions} from './types.js';
import {Env} from './env.js';
import {Storage} from './storage.js';

export type SetupOptions<CustomEnv extends Env> = {
	serverOptions: ServerOptions<CustomEnv>;
};

export type Config<CustomEnv extends Env> = {
	storage: Storage;
	env: CustomEnv;
};

declare module 'hono' {
	interface ContextVariableMap {
		config: Config<Env>; // We cannot use generics here, but that is fine as server code is expected to only use Env
	}
}

export function setup<CustomEnv extends Env>(
	options: SetupOptions<CustomEnv>,
): MiddlewareHandler {
	const {getStorage, getEnv} = options.serverOptions;

	return async (c, next) => {
		const env = getEnv(c);
		const storage = getStorage(c);

		c.set('config', {storage, env});

		return next();
	};
}
