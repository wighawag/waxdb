#!/usr/bin/env node
import {serve} from '@hono/node-server';
import {Command} from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import {createServer, type Env} from '@waxdb/server';
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
		.name('waxdb')
		.version(pkg.version)
		.usage(`[--port 2000] [--db ./waxdb-data]`)
		.description(
			'run waxdb locally: an authenticated key-value store for ethereum addresses',
		)
		.option('-p, --port <port>', 'port to listen on', '2000')
		.option(
			'-d, --db <db>',
			'directory to persist records to, or :memory:',
			':memory:',
		)
		.option(
			'-c, --clear',
			'empty the store before starting (every record, not one)',
		)
		.option(
			'--public-reads',
			'serve reads anonymously, with no read token (default: reads are authenticated)',
		)
		.option(
			'--max-payload-bytes <bytes>',
			'largest payload accepted on a write',
			String(10 * 1024 * 1024),
		)
		.option(
			'--max-read-token-seconds <seconds>',
			'longest read-token lifetime accepted',
			'3600',
		);

	program.parse(process.argv);

	const options: {
		port: string;
		db: string;
		clear?: boolean;
		publicReads?: boolean;
		maxPayloadBytes: string;
		maxReadTokenSeconds: string;
	} = program.opts();
	const port = parseInt(options.port);

	const env: NodeJSEnv = {
		...process.env,
		DB: options.db,
		MAX_PAYLOAD_BYTES: options.maxPayloadBytes,
		MAX_READ_TOKEN_SECONDS: options.maxReadTokenSeconds,
		// only set when asked for: the env type treats any value as "on", so
		// leaving it undefined is what keeps authenticated reads the default
		...(options.publicReads ? {PUBLIC_READS: 'true'} : {}),
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
		`waxdb listening on http://localhost:${port} (store: ${options.db}, reads: ${options.publicReads ? 'public' : 'authenticated'})`,
	);
}

main();
