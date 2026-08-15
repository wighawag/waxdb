#!/usr/bin/env node
import {serve} from '@hono/node-server';
import {Command} from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import {createServer, type Env} from 'secp256k1-db-server';
import {createStorage} from './storage.js';

const __dirname = import.meta.dirname;

type NodeJSEnv = Env & {
	DB?: string;
};

async function main() {
	const pkg = JSON.parse(
		fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'),
	);
	const program = new Command();

	program
		.name('secp256k1-db')
		.version(pkg.version)
		.usage(`[--port 2000] [--db ./data.json]`)
		.description(
			'run secp256k1-db locally: an authenticated key-value store for ethereum addresses',
		)
		.option('-p, --port <port>', 'port to listen on', '2000')
		.option(
			'-d, --db <db>',
			'path to a JSON file to persist to, or :memory:',
			':memory:',
		)
		.option(
			'-t, --token-admin <token>',
			'enable the reset method for requests carrying this TOKEN header',
		)
		.option(
			'-c, --clear',
			'empty the store before starting (deletes every record, not just one like the reset method)',
		);

	program.parse(process.argv);

	const options: {
		port: string;
		db: string;
		tokenAdmin?: string;
		clear?: boolean;
	} = program.opts();
	const port = parseInt(options.port);

	const env: NodeJSEnv = {
		...process.env,
		DB: options.db,
		TOKEN_ADMIN: options.tokenAdmin ?? process.env.TOKEN_ADMIN,
	};

	const storage = createStorage(options.db);

	if (options.clear) {
		await storage.clear();
		console.log(`cleared the store (${options.db})`);
	}

	const app = createServer<NodeJSEnv>({
		getStorage: () => storage,
		getEnv: () => env,
	});

	serve({fetch: app.fetch, port});

	console.log(
		`secp256k1-db listening on http://localhost:${port} (store: ${options.db})`,
	);
}

main();
