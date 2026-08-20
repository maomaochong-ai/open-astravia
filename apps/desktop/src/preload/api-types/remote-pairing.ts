export interface RemotePairingState {
	status: "idle" | "ready" | "error";
	relayBaseUrl?: string;
	pairingId?: string;
	inviteUri?: string;
	inputEnabled: boolean;
	inputSupported: boolean;
	error?: string;
}

export interface RemotePairingApi {
	getState(): Promise<RemotePairingState>;
	create(relayBaseUrl?: string): Promise<RemotePairingState>;
	setInputEnabled(enabled: boolean): Promise<RemotePairingState>;
	revoke(): Promise<RemotePairingState>;
}
