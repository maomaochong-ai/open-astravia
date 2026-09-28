export type RemotePairingChannel = "p2p" | "lan" | "relay";

export interface RemotePairingDevice {
	id: string;
	name: string;
	/** False while the invite is still waiting for its first phone. */
	claimed: boolean;
	online: boolean;
	channels: RemotePairingChannel[];
	/** May view and operate this desktop's screen. */
	desktopControl: boolean;
	createdAt: number;
	lastSeenAt?: number;
}

export interface RemotePairingInvite {
	pairingId: string;
	inviteUri: string;
	expiresAt: number;
	/** The same invite as a connection code and password, for a phone that is not here. */
	code?: {
		code: string;
		password: string;
		status: "preparing" | "ready" | "failed";
	};
}

export interface RemotePairingApproval {
	id: string;
	deviceName: string;
	code: string;
	requestedAt: number;
}

export interface RemotePairingState {
	devices: RemotePairingDevice[];
	invite?: RemotePairingInvite;
	approvals: RemotePairingApproval[];
	lanPort?: number;
	lanEndpoints: string[];
	cloudEnabled: boolean;
	relayBaseUrl?: string;
	vaultAvailable: boolean;
	error?: string;
}

export interface RemotePairingApi {
	getState(): Promise<RemotePairingState>;
	createInvite(): Promise<RemotePairingState>;
	cancelInvite(): Promise<RemotePairingState>;
	setCloudEnabled(enabled: boolean): Promise<RemotePairingState>;
	approve(id: string, allow: boolean): Promise<RemotePairingState>;
	revokeDevice(id: string): Promise<RemotePairingState>;
	renameDevice(id: string, name: string): Promise<RemotePairingState>;
	setDesktopControl(id: string, enabled: boolean): Promise<RemotePairingState>;
	/** Called with the new state whenever it changes; returns the unsubscribe. */
	onStateChanged(listener: (state: RemotePairingState) => void): () => void;
}
