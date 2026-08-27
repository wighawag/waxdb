/**
 * Publish-time invariants for every publishable package.
 *
 * This exists because a release failed on one of them. npm provenance verifies
 * that `repository.url` in the published package.json matches the repository
 * the OIDC token came from, and rejects the publish if it does not:
 *
 *   E422 Error verifying sigstore provenance bundle: Failed to validate
 *   repository information: package.json: "repository.url" is ""
 *
 * The field had been added and then silently removed again by a `git checkout`
 * that reverted an unrelated change. Nothing in the build, the tests or the
 * type checker had any opinion about it, so the first thing that noticed was
 * npm, after the version bump had already landed on main.
 *
 * So it is checked here, before `changeset publish` runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/wighawag/waxdb';
const EXPECTED_URL = `git+${REPO}.git`;

/** every workspace package, from the workspace globs */
function workspaceDirs() {
	const dirs = [];
	for (const group of ['packages', 'platforms']) {
		const base = path.join(root, group);
		if (!fs.existsSync(base)) continue;
		for (const entry of fs.readdirSync(base)) {
			const manifest = path.join(base, entry, 'package.json');
			if (fs.existsSync(manifest)) dirs.push(path.join(group, entry));
		}
	}
	return dirs;
}

const problems = [];
let checked = 0;

for (const dir of workspaceDirs()) {
	const manifestPath = path.join(root, dir, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	const fail = (message) => problems.push(`${pkg.name} (${dir}): ${message}`);

	// a private package is a deployment, not a release
	if (pkg.private) continue;
	checked++;

	if (!pkg.repository) {
		fail('no "repository" field. npm provenance requires one and will reject the publish');
	} else {
		if (pkg.repository.url !== EXPECTED_URL) {
			fail(`repository.url is ${JSON.stringify(pkg.repository.url)}, expected "${EXPECTED_URL}"`);
		}
		if (pkg.repository.directory !== dir) {
			fail(`repository.directory is ${JSON.stringify(pkg.repository.directory)}, expected "${dir}"`);
		}
	}

	if (!pkg.license) fail('no "license" field');

	// a scoped package defaults to restricted, which is not what any of these want
	if (pkg.name.startsWith('@') && pkg.publishConfig?.access !== 'public') {
		fail('scoped package without publishConfig.access "public": npm would publish it restricted');
	}

	// a package whose licence differs from the root must ship its own, or the
	// tarball claims a licence it does not carry
	const rootLicense = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
	const rootIsAgpl = /AFFERO/i.test(rootLicense);
	const pkgIsAgpl = pkg.license === 'AGPL-3.0-only';
	if (rootIsAgpl !== pkgIsAgpl) {
		const ownLicense = path.join(root, dir, 'LICENSE');
		if (!fs.existsSync(ownLicense)) {
			fail(`declares "${pkg.license}" but has no LICENSE of its own`);
		} else if (!(pkg.files ?? []).includes('LICENSE')) {
			fail(`declares "${pkg.license}" and has a LICENSE, but "files" does not ship it`);
		}
	}
}

if (problems.length > 0) {
	console.error('packaging check failed:\n');
	for (const problem of problems) console.error(`  - ${problem}`);
	console.error('');
	process.exit(1);
}

console.log(`packaging check passed (${checked} publishable packages)`);
