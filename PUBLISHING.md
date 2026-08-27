# Publishing

Releases go out through changesets and npm Trusted Publishing (OIDC). **There is no `NPM_TOKEN` secret**, and there should never be one: npm trusts this repository and this workflow directly, and every publish is stamped with provenance.

## The normal flow

1. Open a PR. If it changes a published package, add a changeset:

   ```bash
   pnpm changeset
   ```

   Pick the packages and the bump, write a line a human would want in a changelog. CI reports whether a changeset is present, but does not insist: docs and CI changes legitimately have none.

2. Merge to `main`. `.github/workflows/release.yml` opens (or updates) a **"Version Packages"** PR that applies the pending changesets: versions bumped, changelogs written, changeset files removed.

3. Merge that PR. The same workflow then runs `pnpm release:ci`, which format-checks, builds, runs the whole test suite, and publishes whatever changed.

Publishing is gated on the full contract suite on purpose. This is a protocol, and the suite is the only thing standing between a bug here and every client that trusted it.

## What you never have to think about

**Publish order.** `waxdb` depends on `@waxdb/server` via `workspace:*`, which pnpm rewrites to a real version at publish time. Publishing the CLI first would leave `npm i waxdb` unresolvable, so changesets publishes in dependency order and `updateInternalDependencies: "patch"` bumps `waxdb` whenever `@waxdb/server` moves. It cannot go out pointing at a version that does not exist.

**`@waxdb/cf-worker`** is in `ignore`, and is `private` besides. It is a deployment, not a package.

## The one-time bootstrap

Trusted publishing is configured **per package on npmjs.com**, and that setting lives on the package. A package that does not exist yet has nowhere to hold it, so each name has to exist once before OIDC can take over.

Current state:

| package | on npm | needs |
| --- | --- | --- |
| `waxdb` | `0.0.0` | trusted publisher |
| `@waxdb/server` | **not published** | first publish, then trusted publisher |
| `@waxdb/client` | **not published** | first publish, then trusted publisher |

The scoped pair are new names under the `@waxdb` org. Publish each once from your own machine so the package exists and can hold the setting:

```bash
npm login
pnpm build
cd packages/server && npm publish --access public   # at 0.0.1, as committed
cd ../client      && npm publish --access public
```

`--access public` matters for a scoped package: npm defaults a new scoped package to **restricted**, which would publish it private and fail on a free org. Both `package.json` files already set `publishConfig.access`, and the flag is belt and braces.

Then on npmjs.com, for **each** of the three packages, under *Settings → Trusted publisher*:

- Publisher: **GitHub Actions**
- Organization or user: `wighawag`
- Repository: `waxdb`
- Workflow filename: `release.yml`
- Environment: leave empty

Note that this is configured **per package**, not per org, so a fourth package added later needs the same two steps. That is worth remembering precisely because it will be a year from now and the failure looks like an unrelated auth error.

npm has been extending trusted publishing to cover first publishes of new packages in an org you own. If that works for `@waxdb/*` by the time you try, the manual step above collapses to configuring the publisher. Check before doing it by hand; the fallback above always works.

After that, delete any npm automation token you were using. The workflow needs none, and a token that exists is a token that can leak.

## Requirements the workflow already satisfies

- `id-token: write` permission, for the OIDC handshake
- Node >= 22, for npm's OIDC support (it uses 24)
- a recent pnpm, via `pnpm/action-setup`
- a `repository` field in every published `package.json`, which provenance requires and verifies

## Checking a release afterwards

```bash
npm view @waxdb/client
npm view @waxdb/client --json | jq .dist.attestations
```

And that the CLI resolves, which is the thing publish order exists to protect:

```bash
npx waxdb@latest --help
```

The attestations block is the provenance. If it is missing, the publish did not go through OIDC and something fell back to a token.

## Licensing, when you add a package

`packages/client` is **MIT** and everything else is **AGPL-3.0-only** (DECISIONS.md #20). A new package should say which it is, ship its own `LICENSE` in `files` if it differs from the root, and never import across the boundary in the direction that would relicense a consumer. `packages/client/test/licensing.test.ts` enforces that for the client; a second permissive package would want the same guard.
