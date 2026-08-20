export const REMOTE_WEBSOCKET_PROTOCOL = "vetta.remote.v1";
export const PAIRING_PROTOCOL_PREFIX = "vetta.pairing.";
export const BOOTSTRAP_PROTOCOL_PREFIX = "vetta.bootstrap.";
export const RESUME_PROTOCOL_PREFIX = "vetta.resume.";

const pairingIdPattern = /^[A-Za-z0-9_-]{24,128}$/;
const pairingSecretPattern = /^[A-Za-z0-9_-]{32,256}$/;

export type RelayRole = "mobile" | "desktop";

export interface RelayRoute {
	readonly pairingId: string;
	readonly role: RelayRole;
}

export function parseRelayRoute(pathname: string): RelayRoute | undefined {
	const match = /^\/v1\/relay\/([^/]+)\/(mobile|desktop)$/.exec(pathname);
	if (!match) return undefined;
	const pairingId = match[1];
	const role = match[2];
	if (!pairingId || !pairingIdPattern.test(pairingId) || (role !== "mobile" && role !== "desktop")) {
		return undefined;
	}
	return { pairingId, role };
}

export interface PairingCredentials {
	readonly pairingSecret: string;
	readonly bootstrapSecret?: string;
	readonly resumeSecret?: string;
}

export function pairingSecretFromHeaders(
	headers: Headers,
	requiredProtocol = REMOTE_WEBSOCKET_PROTOCOL,
): PairingCredentials | undefined {
	const protocols = headers
		.get("Sec-WebSocket-Protocol")
		?.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (!protocols?.includes(requiredProtocol)) return undefined;
	const pairingProtocol = protocols.find((value) => value.startsWith(PAIRING_PROTOCOL_PREFIX));
	const secret = pairingProtocol?.slice(PAIRING_PROTOCOL_PREFIX.length);
	if (!secret || !pairingSecretPattern.test(secret)) return undefined;
	const bootstrapProtocol = protocols.find((value) => value.startsWith(BOOTSTRAP_PROTOCOL_PREFIX));
	const bootstrapSecret = bootstrapProtocol?.slice(BOOTSTRAP_PROTOCOL_PREFIX.length);
	const resumeProtocol = protocols.find((value) => value.startsWith(RESUME_PROTOCOL_PREFIX));
	const resumeSecret = resumeProtocol?.slice(RESUME_PROTOCOL_PREFIX.length);
	return {
		pairingSecret: secret,
		...(bootstrapSecret && pairingSecretPattern.test(bootstrapSecret) ? { bootstrapSecret } : {}),
		...(resumeSecret && pairingSecretPattern.test(resumeSecret) ? { resumeSecret } : {}),
	};
}

export async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
