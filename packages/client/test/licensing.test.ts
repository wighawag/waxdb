/**
 * The licence boundary, enforced rather than documented.
 *
 * This package is MIT and `@waxdb/server` is AGPL-3.0-only. If anything under
 * `src/` ever imports the server, the published artifact becomes a derivative
 * of AGPL code and every consumer of this client inherits that obligation,
 * silently, from a one-line import that would look entirely reasonable in
 * review.
 *
 * It is reasonable in `test/`, which is not published: testing against
 * software is not deriving from it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const packageDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
);
const srcDir = path.join(packageDir, 'src');

function sourceFiles(dir: string): string[] {
	return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		return entry.name.endsWith('.ts') ? [full] : [];
	});
}

describe('MIT boundary', () => {
	it('declares MIT and ships its own LICENSE', () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
		);
		expect(pkg.license).toBe('MIT');
		expect(pkg.files).toContain('LICENSE');

		const licence = fs.readFileSync(path.join(packageDir, 'LICENSE'), 'utf8');
		expect(licence).toMatch(/^MIT License/);
		expect(licence).not.toMatch(/AFFERO/i);
	});

	it('never imports the AGPL server from published source', () => {
		const offenders = sourceFiles(srcDir).filter((file) =>
			/from\s+['"]@waxdb\/server/.test(fs.readFileSync(file, 'utf8')),
		);
		expect(
			offenders.map((f) => path.relative(packageDir, f)),
			'an MIT package cannot import AGPL code',
		).toEqual([]);
	});

	it('has no runtime dependencies at all', () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
		);
		// Nothing to audit for licence compatibility downstream, and nothing to
		// go stale. The wire format is small enough to own outright.
		expect(pkg.dependencies ?? {}).toEqual({});
	});
});
