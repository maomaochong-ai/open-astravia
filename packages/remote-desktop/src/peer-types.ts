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

export interface RemoteDesktopPeerOptions {
	readonly sessionId: string;
	readonly rtcConfiguration?: RTCConfiguration;
	readonly logger?: RemoteDesktopLogger;
	readonly createPeerConnection?: (configuration?: RTCConfiguration) => RTCPeerConnection;
}
