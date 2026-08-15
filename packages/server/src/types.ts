import {Context} from 'hono';
import {Bindings} from 'hono/types';
import {Storage} from './storage.js';

export type ServerOptions<Env extends Bindings = Bindings> = {
	getStorage: (c: Context<{Bindings: Env}>) => Storage;
	getEnv: (c: Context<{Bindings: Env}>) => Env;
};
