/// <reference lib="dom" />

export interface RemoteDesktopLogger {
	debug(message: string, fields?: Readonly<Record<string, string | number | boolean | undefined>>): void;
	info(message: string, fields?: Readonly<Record<string, string | number | boolean | undefined>>): void;
	warn(message: string, fields?: Readonly<Record<string, string | number | boolean | undefined>>): void;
}

export const NOOP_REMOTE_DESKTOP_LOGGER: RemoteDesktopLogger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
};

/**
 * STUN only, no TURN (ADR-0135). Mainland servers come first: Google's is reachable
 * there only through a proxy, which then hands out the proxy's address as this
 * machine's public one and sends a cross-network link around the world. The
 * overseas ones stay as fallbacks elsewhere. Keep in step with the phones' lists.
 */
export const REMOTE_DESKTOP_ICE_SERVERS: readonly RTCIceServer[] = [
	{ urls: ["stun:stun.miwifi.com:3478", "stun:stun.chat.bilibili.com:3478", "stun:stun.hitv.com:3478"] },
	{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

export interface RemoteDesktopPeerOptions {
	readonly sessionId: string;
	readonly rtcConfiguration?: RTCConfiguration;
	readonly logger?: RemoteDesktopLogger;
	readonly createPeerConnection?: (configuration?: RTCConfiguration) => RTCPeerConnection;
}
