/**
 * What the protocol hands back, modelled honestly.
 *
 * The shapes here refuse to collapse distinctions the protocol makes on
 * purpose. Absence is not an error, a tombstone is not absence, and a rejected
 * write is not a failure: it is the normal outcome of two devices disagreeing,
 * and the caller needs the current record to converge.
 */

/** anything that can sign an EIP-191 message. An ethers Wallet satisfies it */
export type Signer = {
	signMessage(message: string): string | Promise<string>;
	/** ethers exposes both; either is enough to learn the owner */
	address?: string;
	getAddress?(): string | Promise<string>;
};

export type Meta = {
	counter: string;
	signature: string;
	deleted: boolean;
	/** absent on a tombstone, which has no signed `Data:` line */
	dataHash?: string;
};

export type Record = Meta & {payload: Uint8Array};

/**
 * A read.
 *
 * `found: false` covers genuine absence and, on a deployment with
 * authenticated reads, a token that was wrong, expired or missing. The server
 * makes those indistinguishable on purpose: telling them apart would reveal
 * that a record exists, which is what the token protects.
 */
export type ReadResult =
	| {found: false}
	| {found: true; notModified: true; counter: string}
	| ({found: true; notModified: false} & Record);

export type HeadResult = {found: false} | ({found: true} & Meta);

export type CurrentRecord =
	{found: true; counter: string; deleted: boolean} | {found: false};

/**
 * A write.
 *
 * `ok: false` is returned rather than thrown for the two `409`s, because a
 * conflict is an expected sync outcome and `current` is what lets the caller
 * converge without another round trip. Everything else throws.
 */
export type WriteResult =
	| {ok: true; counter: string; deleted: boolean}
	| {
			ok: false;
			error: {
				code: 'counter_not_increasing' | 'precondition_failed';
				message: string;
			};
			current: CurrentRecord;
	  };

export type Expected = 'any' | 'none' | (string & {});
