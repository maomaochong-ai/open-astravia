import { decodePublicKey } from "./crypto.js";
import { RemoteProtocolError } from "./protocol.js";

export const PAIRING_URI_SCHEME = "vetta";
export const PAIRING_URI_HOST = "pair";
export const PAIRING_URI_VERSION = 2;

/**
 * Everything a phone needs to reach one desktop, carried by the QR code or
 * typed in by hand. The mobile secret is a long-lived per-device credential:
 * the desktop pins the first identity key that presents it and rejects any
 * other, so a photographed code cannot be reused once the real phone paired.
 */
export interface RemotePairingInvite {
	readonly version: typeof PAIRING_URI_VERSION;
	readonly pairingId: string;
	readonly mobileSecret: string;
	readonly desktopIdentityKey: string;
	readonly desktopName: string;
	/** `host:port` pairs reachable on the local network, most preferred first. */
	readonly lanEndpoints: readonly string[];
	/** Relay base URL (`wss://host`) or undefined when the desktop keeps cloud access off. */
	readonly relayBaseUrl?: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const HOST_PORT_PATTERN = /^(\[[0-9a-fA-F:.%a-zA-Z]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/;

export function buildPairingUri(invite: RemotePairingInvite): string {
	const params = new URLSearchParams();
	params.set("v", String(invite.version));
	params.set("id", invite.pairingId);
	params.set("s", invite.mobileSecret);
	params.set("k", invite.desktopIdentityKey);
	params.set("n", invite.desktopName);
	if (invite.lanEndpoints.length > 0) params.set("lan", invite.lanEndpoints.join(","));
	if (invite.relayBaseUrl) params.set("relay", invite.relayBaseUrl);
	return `${PAIRING_URI_SCHEME}://${PAIRING_URI_HOST}?${params.toString()}`;
}

export function parsePairingUri(text: string): RemotePairingInvite {
	let url: URL;
	try {
		url = new URL(text.trim());
	} catch {
		throw new RemoteProtocolError("pairing link is not a valid URL");
	}
	if (
		url.protocol !== `${PAIRING_URI_SCHEME}:` ||
		(url.host !== PAIRING_URI_HOST && url.pathname !== `//${PAIRING_URI_HOST}`)
	) {
		throw new RemoteProtocolError("pairing link must start with vetta://pair");
	}
	const params = url.searchParams;
	if (params.get("v") !== String(PAIRING_URI_VERSION))
		throw new RemoteProtocolError("pairing link version is unsupported");
	const pairingId = params.get("id") ?? "";
	const mobileSecret = params.get("s") ?? "";
	const desktopIdentityKey = params.get("k") ?? "";
	const desktopName = (params.get("n") ?? "").trim();
	if (!ID_PATTERN.test(pairingId)) throw new RemoteProtocolError("pairing link id is invalid");
	if (!ID_PATTERN.test(mobileSecret)) throw new RemoteProtocolError("pairing link secret is invalid");
	decodePublicKey(desktopIdentityKey, "desktop identity key");
	if (!desktopName || desktopName.length > 128) throw new RemoteProtocolError("pairing link device name is invalid");
	const lanEndpoints = (params.get("lan") ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	for (const endpoint of lanEndpoints) {
		if (!isValidHostPort(endpoint)) throw new RemoteProtocolError("pairing link LAN endpoint is invalid");
	}
	const relayBaseUrl = normalizeRelayBaseUrl(params.get("relay") ?? undefined);
	return {
		version: PAIRING_URI_VERSION,
		pairingId,
		mobileSecret,
		desktopIdentityKey,
		desktopName,
		lanEndpoints,
		...(relayBaseUrl ? { relayBaseUrl } : {}),
	};
}

export function isValidHostPort(value: string): boolean {
	const match = HOST_PORT_PATTERN.exec(value);
	if (!match) return false;
	const port = Number(match[2]);
	return port >= 1 && port <= 65_535;
}

/** Accepts http(s)/ws(s) and returns a `ws(s)://host[/path]` base without a trailing slash. */
export function normalizeRelayBaseUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	let parsed: URL;
	try {
		parsed = new URL(value.trim());
	} catch {
		return undefined;
	}
	const protocol =
		parsed.protocol === "http:" || parsed.protocol === "ws:"
			? "ws:"
			: parsed.protocol === "https:" || parsed.protocol === "wss:"
				? "wss:"
				: undefined;
	if (!protocol) return undefined;
	return `${protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
}

export function lanControlUrl(endpoint: string, pairingId: string): string {
	return `ws://${endpoint}/v2/lan/${encodeURIComponent(pairingId)}`;
}

export function relayControlUrl(relayBaseUrl: string, pairingId: string, role: "mobile" | "desktop"): string {
	return `${relayBaseUrl}/v2/relay/${encodeURIComponent(pairingId)}/${role}`;
}
