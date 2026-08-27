# Changesets

Every PR that changes a published package should add a changeset:

```bash
pnpm changeset
```

That writes a small Markdown file describing the change and how each package
should bump. Landing it on `main` makes the release workflow open (or update) a
"Version Packages" PR; merging that PR publishes.

Two things specific to this repo.

**Publish order is not something you have to think about.** `waxdb` depends on
`@waxdb/server` through `workspace:*`, which pnpm rewrites to a real version at
publish time. Changesets publishes in dependency order, and
`updateInternalDependencies` bumps a dependent when its dependency moves, so
`waxdb` cannot go out pointing at a `@waxdb/server` version that does not exist.

**A protocol change needs `vectors.json` in the same changeset.** The vectors
are the only thing keeping the client and the server in agreement about the
encoding, and a change that skips them surfaces as `signature_mismatch` in
somebody's production rather than as a failing test here.
