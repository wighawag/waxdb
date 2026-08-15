- [x] make it platform generic
- [x] use https://github.com/franciscop/polystore

  Used on the Node platform only. The Cloudflare adapter talks to KV directly:
  polystore wraps values (`{expires, value}`), which would rewrite the 2594
  live records into a format existing clients cannot read.

- [ ] fix the issues in [KNOWN-ISSUES.md](KNOWN-ISSUES.md), in that order.
      The first two are the ones that matter: `reset` allows replaying old
      writes, and the signed message can be re-split into a different
      namespace. Both are currently unreachable/unexploited, neither is
      safe to leave.
- [ ] publish the CLI (`platforms/nodejs`) and move the `helper-services/`
      of the dependent repos over to it. They currently install the old
      `secp256k1-db@0.0.1` source package purely to run the worker locally,
      and their wrangler.toml points at a KV namespace id that no longer
      exists. See "The npm package" below.
- [ ] retire `manual-test/`, superseded by the contract suite and the CLI
      smoke test

## The npm package

`secp256k1-db@0.0.1` (published 2023-09-15) ships only `src/handler.ts`,
`src/index.ts`, `package.json` and `tsconfig.json`. No `main`, no `bin`, no
`types`: it is not importable, and it was never meant to be. Dependent repos
consume it as a *source drop*, with a local `helper-services/secp256k1-db/`
whose wrangler.toml says:

    main = "node_modules/secp256k1-db/src/index.ts"

so that `wrangler dev` runs this service locally on a spare port. That is
exactly the job `platforms/nodejs` now does, better.

Two things to settle before publishing:

- the meaning of the package changes from "worker source" to "CLI", so it
  goes out as `0.1.0`. Nothing auto-upgrades: `^0.0.1` expands to
  `>=0.0.1 <0.0.2-0`, so the pinned repos stay on the old source drop until
  they are moved over deliberately.
- `secp256k1-db` depends on `secp256k1-db-server` via `workspace:*`, which
  pnpm rewrites to a real version at publish time. So the server package
  has to be published first, or `npm i secp256k1-db` cannot resolve.
- those helper-services pin KV namespace `6a9b71a2…`, which was deleted as
  unused. Local `wrangler dev` is unaffected (miniflare treats the id as a
  local label), but `--remote` or a deploy from those directories now fails.
  Replacing the whole helper-service with `npx secp256k1-db --port <port>`
  removes the problem rather than fixing it.
