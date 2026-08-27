/**
 * The signed message (SPEC.md, "The signed message").
 *
 * Labelled text with a fixed line count, fixed labels, and fields whose
 * charsets exclude a newline. That combination is what makes the encoding
 * unambiguous: the message determines exactly one tuple, and there is no second
 * `(namespace, counter, payload)` producing the same bytes.
 *
 * This is the reason waxdb exists as a separate protocol. The predecessor
 * joined its fields with `:`, so a payload containing an ISO-8601 timestamp
 * could be re-read as a different namespace (DECISIONS.md #3).
 *
 * The `waxdb store` / `waxdb delete` / `waxdb read` header lines do two jobs:
 * they give the three intents different bytes, so a store signature can never
 * be replayed as a delete, and they separate this format from any other that
 * might ever sign with the same key. That is the job a version field would
 * otherwise do, done by bytes that have to exist anyway (DECISIONS.md #6).
 */

export type StoreMessageInputs = {
	namespace: string;
	/** lowercase, always */
	owner: string;
	counter: string;
	expected: string;
	/** `0x` + 64 lowercase hex, SHA-256 of the payload the server received */
	payloadHash: string;
};

export type DeleteMessageInputs = Omit<StoreMessageInputs, 'payloadHash'>;

export type ReadMessageInputs = {
	namespace: string;
	owner: string;
	/** unix seconds */
	expires: string;
};

/** six lines */
export function storeMessage(inputs: StoreMessageInputs): string {
	return [
		'waxdb store',
		`Namespace: ${inputs.namespace}`,
		`Owner: ${inputs.owner}`,
		`Counter: ${inputs.counter}`,
		`Expected: ${inputs.expected}`,
		`Data: ${inputs.payloadHash}`,
	].join('\n');
}

/** five lines */
export function deleteMessage(inputs: DeleteMessageInputs): string {
	return [
		'waxdb delete',
		`Namespace: ${inputs.namespace}`,
		`Owner: ${inputs.owner}`,
		`Counter: ${inputs.counter}`,
		`Expected: ${inputs.expected}`,
	].join('\n');
}

/** four lines */
export function readMessage(inputs: ReadMessageInputs): string {
	return [
		'waxdb read',
		`Namespace: ${inputs.namespace}`,
		`Owner: ${inputs.owner}`,
		`Expires: ${inputs.expires}`,
	].join('\n');
}
