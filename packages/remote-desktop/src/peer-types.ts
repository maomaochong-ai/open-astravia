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
 * STUN only, no TURN (ADR-0135), and only servers reachable in mainland China without a
 * proxy. Chromium keeps one public address per network interface, from whichever server
 * answers first; a proxy (Clash and the like) carries Google's and Cloudflare's, so with
 * them listed each new connection could take the proxy's exit as this machine's address
 * and route the phone through it, about 300 ms instead of tens. STUN only reports the
 * mapping, so these answer correctly from abroad too. Keep in step with the phones' lists.
 */
export const REMOTE_DESKTOP_ICE_SERVERS: readonly RTCIceServer[] = [
	{ urls: ["stun:stun.miwifi.com:3478", "stun:stun.chat.bilibili.com:3478", "stun:stun.hitv.com:3478"] },
];

export interface RemoteDesktopPeerOptions {
	readonly sessionId: string;
	readonly rtcConfiguration?: RTCConfiguration;
	readonly logger?: RemoteDesktopLogger;
	readonly createPeerConnection?: (configuration?: RTCConfiguration) => RTCPeerConnection;
}
