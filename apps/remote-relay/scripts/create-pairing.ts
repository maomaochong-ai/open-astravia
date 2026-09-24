import { randomBytes } from "node:crypto";
import { sha256Hex } from "../../../packages/remote-control/src/index.ts";

/**
 * Prints v2 pairing material for exercising a local relay by hand. In the
 * product the desktop generates these values and the phone receives them
 * through the QR code; the relay only ever sees the hashes.
 */
const relayBase = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const websocketBase = relayBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
const pairingId = randomBytes(24).toString("base64url");
const desktopSecret = randomBytes(32).toString("base64url");
const mobileSecret = randomBytes(32).toString("base64url");

console.info(`Desktop URL:   ${websocketBase}/v2/relay/${pairingId}/desktop`);
console.info(`Desktop protocols: vetta.remote.v2, vetta.pairing.${desktopSecret}, vetta.peer.${sha256Hex(mobileSecret)}`);
console.info(`Mobile URL:    ${websocketBase}/v2/relay/${pairingId}/mobile`);
console.info(`Mobile protocols:  vetta.remote.v2, vetta.pairing.${mobileSecret}`);
console.info("The desktop must connect first; the relay stores only SHA-256 hashes of both secrets.");
