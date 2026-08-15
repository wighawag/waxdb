import type {Env} from 'secp256k1-db-server';

export type CloudflareEnv = Env & {
	PRIVATE_STORE: KVNamespace;
};
