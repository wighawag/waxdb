- [x] make it platform generic
- [x] use https://github.com/franciscop/polystore

  Used on the Node platform only. The Cloudflare adapter talks to KV directly:
  polystore wraps values (`{expires, value}`), which would rewrite the 2594
  live records into a format existing clients cannot read.

- [ ] publish the CLI (`platforms/nodejs`, package `secp256k1-db`) so projects
      can `npx secp256k1-db` for offline development
- [ ] decide whether the contract's quirks (see `packages/server/test/README.md`)
      are worth fixing behind a version flag, e.g. errors that serialise to `{}`
      and the usage hint missing its closing brace
- [ ] `reset` is still replayable (no counter), and inert until `TOKEN_ADMIN` is set
