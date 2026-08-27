/**
 * The protocol layer: field forms, the storage key, the signed message, the
 * digest and recovery. No HTTP, no storage, no platform API.
 *
 * Exported from the package because a client implementation needs exactly
 * these pieces, and a client that re-implements them is a client that can drift
 * from the server. `vectors.json` pins the results either way.
 */
export * from './digest.js';
export * from './fields.js';
export * from './key.js';
export * from './message.js';
export * from './verify.js';
