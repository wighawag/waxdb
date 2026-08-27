export type Env = {
	DEV?: string;
	/**
	 * Maximum payload accepted on a write, in bytes. Deployment policy rather
	 * than protocol (SPEC.md, Limits): raising it is safe, lowering it breaks
	 * any client already above it. Defaults to 10 MiB when unset, and wants to
	 * be far lower on a plan with a small CPU budget.
	 */
	MAX_PAYLOAD_BYTES?: string;
};
