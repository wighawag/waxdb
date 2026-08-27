/**
 * waxdb client. MIT, unlike the rest of this repository.
 *
 * A client library that cannot be embedded freely is not much of a client
 * library, so this package is permissively licensed and carries its own
 * implementation of the wire format rather than importing the AGPL server's.
 * `vectors.json` is what holds the two to the same answer.
 */
export {WaxdbClient, type WaxdbClientOptions} from './client.js';
export {WaxdbError, WaxdbRateLimitError} from './errors.js';
export type {
	CurrentRecord,
	Expected,
	HeadResult,
	Meta,
	ReadResult,
	Record,
	Signer,
	WriteResult,
} from './types.js';

// the wire format, exported because a consumer building its own transport, or
// verifying a signature it read back, needs exactly these
export {
	deleteMessage,
	isCanonicalCounter,
	isValidExpected,
	isValidNamespace,
	messageByteLength,
	normaliseOwner,
	payloadHash,
	readMessage,
	storeMessage,
	toHex,
	type StoreInputs,
} from './protocol.js';
