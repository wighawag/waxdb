using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [ (name = "main", worker = .benchWorker) ],
  sockets = [ (name = "http", address = "*:8787", http = (), service = "main") ]
);

const benchWorker :Workerd.Worker = (
  modules = [
    (name = "worker", esModule = embed "bundle.js"),
    # the only way to get WASM into a Worker: workerd refuses to compile it at
    # runtime, so it has to be declared here. See src/worker.js.
    (name = "keccak.wasm", wasm = embed "keccak.wasm"),
  ],
  compatibilityDate = "2025-04-08",
  compatibilityFlags = ["nodejs_compat"],
);
