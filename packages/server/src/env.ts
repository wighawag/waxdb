export type Env = {
	DEV?: string;
	/**
	 * Maximum payload accepted on a write, in bytes. Deployment policy rather
	 * than protocol (SPEC.md, Limits): raising it is safe, lowering it breaks
	 * any client already above it. Defaults to 10 MiB when unset, and wants to
	 * be far lower on a plan with a small CPU budget.
	 */
	MAX_PAYLOAD_BYTES?: string;
	/**
	 * When set, reads are anonymous: no read token is required and none is
	 * checked. Unset means reads are authenticated, which is the default
	 * (SPEC.md, "Reading, and the read token"). Deployment-wide: it is not part
	 * of the format, so it can be changed without invalidating any signature.
	 */
	PUBLIC_READS?: string;
	/**
	 * Longest read-token lifetime accepted, in seconds. Bounds how long a
	 * captured token stays usable (SPEC.md, "Reading a private record").
	 * Defaults to 3600 when unset.
	 */
	MAX_READ_TOKEN_SECONDS?: string;
};
