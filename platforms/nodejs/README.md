# waxdb (CLI)

Runs waxdb as a local Node process, so a project can develop against it offline instead of against a deployed Cloudflare worker.

```bash
npx waxdb                                   # in memory, port 2000
npx waxdb --port 3000 --db ./waxdb-data     # persisted
npx waxdb --db ./waxdb-data --clear         # start from an empty store
```

| option | default | meaning |
| --- | --- | --- |
| `-p, --port` | `2000` | port to listen on |
| `-d, --db` | `:memory:` | `:memory:`, or a path to persist to |
| `-c, --clear` | off | empty the store before listening |

`--clear` deletes **every** record. It is a no-op with the default `:memory:` store, which starts empty anyway.

This is not a mock. It answers what the deployed service answers, because one contract suite runs against both, and that is the whole point: a consumer developing offline is exercising the real protocol.

## Storage

Still on [polystore](https://github.com/franciscop/polystore), which is what the predecessor used, and which is being replaced.

polystore stores JSON-shaped values with an optional TTL and has no metadata channel, so a byte payload has to be base64'd and wrapped in an envelope, and its persistent backend rewrites the entire store on every write. Both are wrong for a blob store (DECISIONS.md #14). The replacement is two small purpose-built backends: a `Map` for `:memory:`, and a directory where each record is its payload as an ordinary file plus a small JSON sidecar, at a path mirroring the key.

That is also why the namespace charset is lowercase, `/`-free, `:`-free and never `.` or `..`: it makes every key a valid path on every filesystem, so a payload can be stored as a file you can open rather than as base64 inside JSON.
