# secp256k1-db (CLI)

Runs secp256k1-db as a local Node process, so a project can develop against it offline instead of the deployed Cloudflare worker.

```bash
npx secp256k1-db                                  # in memory, port 2000
npx secp256k1-db --port 3000 --db ./data.json     # persisted to a JSON file
npx secp256k1-db --token-admin <token>            # enables the reset method
npx secp256k1-db --db ./data.json --clear         # start from an empty store
```

| option | default | meaning |
| --- | --- | --- |
| `-p, --port` | `2000` | port to listen on |
| `-d, --db` | `:memory:` | `:memory:`, or a path to a JSON file to persist to |
| `-t, --token-admin` | unset | value the `TOKEN` header must match for `reset` (also read from `TOKEN_ADMIN`) |
| `-c, --clear` | off | empty the store before listening |

`--clear` deletes **every** record, which is not what the `reset` RPC method does (one record, and only with the admin token). It is a no-op with the default `:memory:` store, which starts empty anyway.

It answers exactly what the deployed service answers: the same contract suite runs against both.

## Storage

Persistence goes through [polystore](https://github.com/franciscop/polystore), with a `Map` for `:memory:` and a single JSON file otherwise.

Single file, not a file per key, on purpose: real keys contain characters like `:` (namespaces look like `conquest-0xABC…:0xDEF…`), which do not survive being used as filenames.

The file layout is polystore's own (`{key: {expires, value}}`), which is *not* the layout of the Cloudflare KV namespace. That is fine here, where there is no legacy data, and it is exactly why the Cloudflare adapter does not go through polystore: it would rewrite records that live clients already depend on.
