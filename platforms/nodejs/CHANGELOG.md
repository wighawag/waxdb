# waxdb

## 0.2.0

### Minor Changes

- 6112489: First working release: the waxdb protocol, implemented and verified.

  `@waxdb/server` implements SPEC.md in full and holds no platform API, so the
  same contract suite runs in-process, on real workerd, and on both Node
  backends. The write path validates, hashes, **verifies the signature, and only
  then consults storage**, because doing it in any other order lets the
  difference between `signature_mismatch` and `counter_not_increasing` tell an
  unauthenticated prober whether a record exists. Reads are authenticated by
  default, and every failure of a read token answers exactly what absence
  answers.

  `@waxdb/client` is new, and **MIT** rather than AGPL, so an application can
  embed it. It carries its own implementation of the wire format instead of
  importing the server's, which the licence requires and which correctness
  wanted anyway: two independent implementations held to `vectors.json` cannot
  drift silently.

  `waxdb` (the CLI) drops polystore for two purpose-built backends. `--db` is now
  a **directory**, not a JSON file: each record is its payload as an ordinary
  file plus a small JSON sidecar, so reads stream and a write touches one record
  rather than rewriting the store.

  Two protocol details worth knowing if you are writing a client:

  - The payload hash on the `Data:` line is **SHA-256**, not keccak. keccak stays
    for the EIP-191 message digest only. It is 35x faster in a Worker and it is
    what makes a 10 MiB write fit inside the free plan's CPU budget.
  - The `namespace` limit is **255 bytes**, not 256, because that is `NAME_MAX`
    and a namespace is one path component in a file-backed store.

### Patch Changes

- Updated dependencies [6112489]
  - @waxdb/server@0.1.0
