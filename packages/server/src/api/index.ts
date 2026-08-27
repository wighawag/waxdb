/**
 * Routing (SPEC.md, "HTTP API").
 */
import {Hono} from 'hono';
import type {Env} from '../env.js';
import {WaxdbError} from './errors.js';
import {handleRead, handleWrite, parseTarget} from './records.js';
import {CORS_HEADERS, errorResponse, withCors} from './responses.js';

export function registerRoutes<CustomEnv extends Env>(
	app: Hono<{Bindings: CustomEnv}>,
) {
	// Preflight. Answered for any path, since a browser preflights before it
	// could learn whether the path is one we serve.
	app.options(
		'*',
		() => new Response(null, {status: 204, headers: withCors(new Headers())}),
	);

	app.on(['GET', 'HEAD'], '/records/:namespace/:owner', (c) =>
		run(() => {
			const {storage, env} = c.get('config');
			return handleRead({
				request: c.req.raw,
				storage,
				env,
				target: parseTarget(c.req.param('namespace'), c.req.param('owner')),
				bodyless: c.req.method === 'HEAD',
			});
		}),
	);

	app.put('/records/:namespace/:owner', (c) =>
		run(() => {
			const {storage, env} = c.get('config');
			return handleWrite({
				request: c.req.raw,
				storage,
				env,
				target: parseTarget(c.req.param('namespace'), c.req.param('owner')),
				intent: 'store',
			});
		}),
	);

	app.delete('/records/:namespace/:owner', (c) =>
		run(() => {
			const {storage, env} = c.get('config');
			return handleWrite({
				request: c.req.raw,
				storage,
				env,
				target: parseTarget(c.req.param('namespace'), c.req.param('owner')),
				intent: 'delete',
			});
		}),
	);

	// A verb outside the ones above, on a path we do serve.
	app.all('/records/:namespace/:owner', () =>
		errorResponse(
			new WaxdbError(
				'method_not_allowed',
				405,
				'a record supports GET, HEAD, PUT, DELETE and OPTIONS',
				{
					headers: {Allow: CORS_HEADERS['Access-Control-Allow-Methods']!},
				},
			),
		),
	);

	// Anything else. SPEC.md's table has no code for an unserved path, so this
	// adds `not_found`, in the same envelope as every other failure.
	app.all('*', () =>
		errorResponse(
			new WaxdbError(
				'not_found',
				404,
				'no such endpoint; records live at /records/{namespace}/{owner}',
			),
		),
	);

	return app;
}

/**
 * Turns a thrown {@link WaxdbError} into its response.
 *
 * Anything else is a bug in this server rather than a client error, so it
 * becomes an opaque `storage_error` with no engine text, exactly as a storage
 * failure does. A parser exception must never reach a client (DECISIONS.md #9).
 */
async function run(
	handler: () => Promise<Response> | Response,
): Promise<Response> {
	try {
		return await handler();
	} catch (err) {
		if (err instanceof WaxdbError) return errorResponse(err);
		return errorResponse(
			new WaxdbError(
				'storage_error',
				500,
				'the request could not be completed',
			),
		);
	}
}
