import { randomBytes } from "node:crypto";

const relayBase = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const websocketBase = relayBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
const pairingId = randomBytes(24).toString("base64url");
const token = randomBytes(32).toString("base64url");

console.info(`VETTA_REMOTE_CONTROL_URL=${websocketBase}/v1/relay/${pairingId}/desktop`);
console.info(`VETTA_REMOTE_PAIRING_TOKEN=${token}`);
console.info(`Mobile target: ${websocketBase}/v1/relay/${pairingId}/mobile#${token}`);
console.info("Optional input grant: VETTA_REMOTE_DESKTOP_INPUT_ENABLED=true");
