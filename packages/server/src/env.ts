export type Env = {
	DEV?: string;
	/** when set, `reset` is allowed for requests carrying it in the TOKEN header */
	TOKEN_ADMIN?: string;
};
