# waxdb (CLI)

Runs waxdb as a local Node process, so a project can develop against it offline instead of against a deployed Cloudflare worker.

```bash
npx waxdb                                   # in memory, port 2000
npx waxdb --port 3000 --db ./waxdb-data     # persisted to a directory
npx waxdb --db ./waxdb-data --clear         # start from an empty store
npx waxdb --public-reads                    # anonymous reads, no token
```

| option                     | default    | meaning                                      |
| -------------------------- | ---------- | -------------------------------------------- |
| `-p, --port`               | `2000`     | port to listen on                            |
| `-d, --db`                 | `:memory:` | `:memory:`, or a **directory** to persist to |
| `-c, --clear`              | off        | empty the store before listening             |
| `--public-reads`           | off        | serve reads anonymously, with no read token  |
| `--max-payload-bytes`      | `10485760` | largest payload accepted on a write          |
| `--max-read-token-seconds` | `3600`     | longest read-token lifetime accepted         |

`--clear` deletes **every** record. It is a no-op with the default `:memory:` store, which starts empty anyway.

**Reads are authenticated by default**, exactly as they are on a deployment, so a client developing offline has to sign read tokens just as it will in production. `--public-reads` is the escape hatch, and it matches the `PUBLIC_READS` deployment setting.

This is not a mock. It answers what the deployed service answers, because one contract suite runs against both, and that is the whole point: a consumer developing offline is exercising the real protocol.

## Storage

`--db` is a **directory**, not a file. Each record is stored as two ordinary files at a path mirroring its storage key:

```
<db>/<namespace>/<owner>        the payload, verbatim
<db>/<namespace>/<owner>.json   {"counter", "signature", "deleted", "dataHash"}
```

So a payload is a file you can open, `head` reads only the sidecar, and a write touches one record rather than rewriting the store. Reads stream straight off disk.

This replaced [polystore](https://github.com/franciscop/polystore) (DECISIONS.md #14). polystore stores JSON-shaped values with an optional TTL and has no metadata channel, so a byte payload had to be base64'd and wrapped in an envelope, a third larger on disk, and its persistent backend rewrote the entire store on every write. Both are wrong for a blob store. **`--db ./data.json` no longer works**: pass a directory, and the CLI will tell you if you point it at a file.

That layout is also why the namespace charset is lowercase, `/`-free, `:`-free, never `.` or `..`, and capped at 255 bytes: it makes every key a valid path component on every filesystem. 255 rather than 256 because that is `NAME_MAX`, and a longer namespace is a write Cloudflare would accept and this backend would reject.

## Tests

```bash
pnpm test
```

Runs the shared contract against both backends, in both read modes, plus a smoke test that spawns the built CLI and checks a record survives a restart.
