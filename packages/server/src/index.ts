import {Hono} from 'hono';
import {Env} from './env.js';
import {setup} from './setup.js';
import {ServerOptions} from './types.js';

export type {Env};
export type {Storage} from './storage.js';
export type {ServerOptions};

/**
 * The waxdb service.
 *
 * The protocol is specified in SPEC.md and is not implemented yet. This builds
 * the app and wires the storage seam; every route answers `not_implemented` in
 * the error shape SPEC.md defines, so the envelope is already the real one when
 * the handler lands.
 */
export function createServer<CustomEnv extends Env>(
	options: ServerOptions<CustomEnv>,
) {
	const app = new Hono<{Bindings: CustomEnv}>();

	return app.use(setup({serverOptions: options})).all('*', (c) =>
		c.json(
			{
				ok: false,
				error: {
					code: 'not_implemented',
					message: 'waxdb is not implemented yet, see SPEC.md',
				},
			},
			501,
		),
	);
}

export type App = ReturnType<typeof createServer>;
