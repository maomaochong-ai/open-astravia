import type { RemoteDeviceStatus, RemoteIdentityKeyPair, RemoteTransport } from "@vetta/remote-control";

/** One paired desktop as persisted on the phone. The secret lives in the secure store. */
export interface DesktopRecord {
	/** base64url X25519 identity key of the desktop; primary key. */
	readonly desktopIdentityKey: string;
	readonly desktopName: string;
	readonly pairingId: string;
	readonly mobileSecret: string;
	readonly lanEndpoints: readonly string[];
	readonly relayBaseUrl?: string;
	readonly lastEventSequence: number;
	readonly pairedAt: number;
	readonly lastSeenAt: number;
}

export type LinkStatus = "offline" | "connecting" | "online";
export type LinkChannel = "lan" | "relay";

export interface LinkSnapshot {
	readonly status: LinkStatus;
	readonly channel: LinkChannel | null;
	readonly rttMs?: number;
	/** False when the transport is up but the relay reports the desktop absent. */
	readonly peerOnline: boolean;
	readonly desktop?: RemoteDeviceStatus;
	readonly lastError?: string;
	readonly reconnectAttempt: number;
}

export interface TransportOptions {
	readonly pairingSecret?: string;
	readonly manual?: boolean;
	readonly keepaliveIntervalMs?: number;
}

export type TransportFactory = (url: string, options: TransportOptions) => RemoteTransport;

export interface LinkIdentity {
	readonly identity: RemoteIdentityKeyPair;
	readonly deviceId: string;
	readonly deviceName: string;
}

export interface KeyValueStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
}
