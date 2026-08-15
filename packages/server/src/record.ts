/**
 * On-disk format of a record. Frozen by 2594 live records: do not change the
 * key layout, the field order, or the fact that `counter` is a decimal string.
 *
 *   key:   `${namespace}_${address.toLowerCase()}`
 *   value: JSON.stringify({data, counter, signature})
 *
 * Records written before April 2021 have no `signature` field, and reads are a
 * raw passthrough, so anything else already in a record survives a read.
 */
export type StoredRecord = {
	data: string;
	counter: string;
	signature?: string;
};

export const EMPTY_RECORD: StoredRecord = {
	data: '',
	counter: '0',
	signature: '',
};

export function storageKey(namespace: string, address: string): string {
	return (namespace && namespace !== '' ? namespace + '_' : '') + address;
}

export function serialiseRecord(record: StoredRecord): string {
	// explicit field order: the shape below is what is already on disk
	return JSON.stringify({
		data: record.data,
		counter: record.counter,
		signature: record.signature,
	});
}

export function deserialiseRecord(stored: string): StoredRecord {
	return JSON.parse(stored);
}
