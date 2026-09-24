import { parseOfferedProtocols, REMOTE_WEBSOCKET_PROTOCOL } from "@vetta/remote-control";

export { REMOTE_WEBSOCKET_PROTOCOL };

const pairingIdPattern = /^[A-Za-z0-9_-]{16,128}$/;
const pairingSecretPattern = /^[A-Za-z0-9_-]{32,256}$/;
const sha256HexPattern = /^[0-9a-f]{64}$/;

export type RelayRole = "mobile" | "desktop";

export interface RelayRoute {
	readonly pairingId: string;
	readonly role: RelayRole;
}

export function parseRelayRoute(pathname: string): RelayRoute | undefined {
	const match = /^\/v2\/relay\/([^/]+)\/(mobile|desktop)$/.exec(pathname);
	if (!match) return undefined;
	const pairingId = match[1];
	const role = match[2];
	if (!pairingId || !pairingIdPattern.test(pairingId) || (role !== "mobile" && role !== "desktop")) {
		return undefined;
	}
	return { pairingId, role };
}

export function parseDesktopRoute(
	pathname: string,
): { readonly pairingId: string; readonly role: "host" | "viewer" } | undefined {
	const match = /^\/v2\/desktop\/([^/]+)\/(host|viewer)$/.exec(pathname);
	if (!match) return undefined;
	const pairingId = match[1];
	if (!pairingId || !pairingIdPattern.test(pairingId) || (match[2] !== "host" && match[2] !== "viewer"))
		return undefined;
	return { pairingId, role: match[2] };
}

export interface PairingCredentials {
	readonly pairingSecret: string;
	/** SHA-256 hex of the phone's secret, offered by the desktop when it registers the room. */
	readonly peerCredentialHash?: string;
}

/**
 * Reads credentials from the `Sec-WebSocket-Protocol` offer. Secrets never
 * appear in the URL, so proxies and logs only ever see the pairing id.
 */
export function pairingSecretFromHeaders(
	headers: Headers,
	requiredProtocol = REMOTE_WEBSOCKET_PROTOCOL,
): PairingCredentials | undefined {
	const header = headers.get("Sec-WebSocket-Protocol");
	const offered = parseOfferedProtocols(header);
	const protocols = (header ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (!protocols.includes(requiredProtocol)) return undefined;
	const secret = offered.pairingSecret;
	if (!secret || !pairingSecretPattern.test(secret)) return undefined;
	const peerCredentialHash = offered.peerCredentialHash;
	return {
		pairingSecret: secret,
		...(peerCredentialHash && sha256HexPattern.test(peerCredentialHash) ? { peerCredentialHash } : {}),
	};
}

export async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
