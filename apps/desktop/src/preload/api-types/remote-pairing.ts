export type RemotePairingChannel = "lan" | "relay";

export interface RemotePairingDevice {
	id: string;
	name: string;
	/** False while the invite is still waiting for its first phone. */
	claimed: boolean;
	online: boolean;
	channels: RemotePairingChannel[];
	createdAt: number;
	lastSeenAt?: number;
}

export interface RemotePairingInvite {
	pairingId: string;
	inviteUri: string;
	expiresAt: number;
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
}
