/**
 * Compatibility facade for Node hosts. Portable Coding Agent domains import
 * identity directly so loading them never performs host-environment discovery.
 */
export * from "./host/node-config.js";
export * from "./identity.js";
