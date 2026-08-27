import type {Env} from 'waxdb-server';

export type CloudflareEnv = Env & {
	RECORDS: KVNamespace;
};
