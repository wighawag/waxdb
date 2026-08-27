/**
 * Field forms and the storage key, at the unit level.
 *
 * The contract suite covers everything reachable over HTTP. This covers the
 * rules that are *not* reachable over HTTP but still load-bearing, because the
 * storage key is built from them and a file-backed backend turns that key into
 * a filesystem path.
 */
import {describe, expect, it} from 'vitest';
import {
	compareCounters,
	isCanonicalCounter,
	isCanonicalOwner,
	isValidDataHash,
	isValidExpected,
	isValidNamespace,
	isValidSignatureFormat,
	isValidStorageKey,
	normaliseOwnerFromUrl,
	parseStorageKey,
	storageKey,
} from '../src/protocol/index.js';

describe('namespace', () => {
	it('accepts the documented charset', () => {
		for (const value of [
			'a',
			'app',
			'my.app-name_v2',
			'abcdefghijklmnopqrstuvwxyz0123456789._-',
			'a'.repeat(255), // NAME_MAX, the longest a path component can be
		]) {
			expect(isValidNamespace(value), value).toBe(true);
		}
	});

	/**
	 * These cannot arrive over HTTP, because the URL parser collapses dot
	 * segments first. They are rejected anyway, because this is the function the
	 * directory backend's path safety rests on.
	 */
	it('rejects traversal', () => {
		for (const value of ['.', '..', '.hidden', '../etc', './x']) {
			expect(isValidNamespace(value), value).toBe(false);
		}
	});

	it('rejects everything outside the charset', () => {
		for (const value of [
			'', // empty
			'A', // uppercase, which a case-insensitive filesystem would merge
			'Conquest',
			'a/b', // would split the key into three segments
			'a\\b', // a path separator on Windows
			'a:b', // illegal in a Windows filename
			'a b',
			'a\nb', // would let a message be re-split
			'a\tb',
			'a~b',
			'a%b',
			'café',
			'日本',
			'a'.repeat(256), // one byte over NAME_MAX
		]) {
			expect(isValidNamespace(value), JSON.stringify(value)).toBe(false);
		}
	});
});

describe('owner', () => {
	const lower = `0x${'ab'.repeat(20)}`;

	it('accepts only the lowercase form as canonical', () => {
		expect(isCanonicalOwner(lower)).toBe(true);
		expect(isCanonicalOwner(lower.toUpperCase().replace('0X', '0x'))).toBe(
			false,
		);
	});

	it('lowercases what a URL carries', () => {
		expect(
			normaliseOwnerFromUrl('0xAbCdEf0123456789AbCdEf0123456789AbCdEf01'),
		).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
	});

	it('rejects anything that is not 20 bytes of hex', () => {
		for (const value of [
			'',
			'0x',
			'0x1234',
			'ab'.repeat(20), // no 0x
			`0x${'ab'.repeat(21)}`,
			`0x${'zz'.repeat(20)}`,
			`0X${'ab'.repeat(20)}`,
		]) {
			expect(normaliseOwnerFromUrl(value), JSON.stringify(value)).toBeNull();
		}
	});
});

describe('counter', () => {
	it('accepts canonical decimals', () => {
		for (const value of ['0', '1', '42', '1756290000000', '9'.repeat(40)]) {
			expect(isCanonicalCounter(value), value).toBe(true);
		}
	});

	/** DECISIONS.md #10: rejected, never normalised */
	it('rejects everything non-canonical', () => {
		for (const value of [
			'',
			'0123',
			'00',
			'-1',
			'+5',
			'1.0',
			'1e3',
			'0x10',
			' 5',
			'5 ',
			'5\n',
			'abc',
			'NaN',
			'Infinity',
		]) {
			expect(isCanonicalCounter(value), JSON.stringify(value)).toBe(false);
		}
	});

	it('compares beyond the safe integer range', () => {
		const big = '9007199254740993'; // 2^53 + 1, which Number cannot represent
		expect(compareCounters(big, '9007199254740992')).toBe(1);
		expect(compareCounters('9007199254740992', big)).toBe(-1);
		expect(compareCounters(big, big)).toBe(0);
	});
});

describe('expected', () => {
	it('accepts any, none, and a canonical counter', () => {
		expect(isValidExpected('any')).toBe(true);
		expect(isValidExpected('none')).toBe(true);
		expect(isValidExpected('0')).toBe(true);
		expect(isValidExpected('1756290000000')).toBe(true);
	});

	it('rejects near misses', () => {
		for (const value of [
			'',
			'ANY',
			'None',
			'null',
			'undefined',
			'0123',
			'-1',
		]) {
			expect(isValidExpected(value), JSON.stringify(value)).toBe(false);
		}
	});
});

describe('hashes and signatures', () => {
	it('requires a lowercase data hash', () => {
		const hash = `0x${'ab'.repeat(32)}`;
		expect(isValidDataHash(hash)).toBe(true);
		expect(isValidDataHash(hash.toUpperCase().replace('0X', '0x'))).toBe(false);
		expect(isValidDataHash(`0x${'ab'.repeat(31)}`)).toBe(false);
		expect(isValidDataHash('')).toBe(false);
	});

	/**
	 * SPEC.md spells out "lowercase" for the payload hash and not for the
	 * signature, which is read as deliberate: a signature is not part of the
	 * signed message, so its case cannot change what was signed.
	 */
	it('accepts a signature in either case', () => {
		expect(isValidSignatureFormat(`0x${'ab'.repeat(65)}`)).toBe(true);
		expect(isValidSignatureFormat(`0x${'AB'.repeat(65)}`)).toBe(true);
		expect(isValidSignatureFormat(`0x${'ab'.repeat(64)}`)).toBe(false);
		expect(isValidSignatureFormat(`0x${'ab'.repeat(66)}`)).toBe(false);
	});
});

describe('storage key', () => {
	const owner = `0x${'ab'.repeat(20)}`;

	it('is exactly two segments and round trips', () => {
		const key = storageKey('my.app-name_v2', owner);
		expect(key).toBe(`my.app-name_v2/${owner}`);
		expect(parseStorageKey(key)).toEqual({
			namespace: 'my.app-name_v2',
			owner,
		});
	});

	it('stays inside the platform key limit at its longest', () => {
		const key = storageKey('a'.repeat(255), owner);
		expect(key.length).toBe(255 + 1 + 42);
		expect(key.length).toBeLessThanOrEqual(512);
	});

	it('rejects a key it could not have produced', () => {
		for (const key of [
			'',
			'no-separator',
			`/${owner}`, // empty namespace
			`app/${owner}/extra`,
			`app/0xnothex${'0'.repeat(34)}`,
			`../${owner}`,
			`./${owner}`,
			`.hidden/${owner}`,
			`App/${owner}`,
			`app/${owner.toUpperCase().replace('0X', '0x')}`,
		]) {
			expect(isValidStorageKey(key), JSON.stringify(key)).toBe(false);
		}
	});

	/**
	 * Parsing right to left is what stops an extra separator being read as a
	 * valid namespace plus a mangled owner: the owner is whatever follows the
	 * last separator, and the namespace is then validated as a whole.
	 */
	it('parses right to left', () => {
		expect(parseStorageKey(`a/b/${owner}`)).toBeNull();
	});
});
