import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { RemoteConnectionState } from "@vetta/remote-control";
import { type DesktopConfig, readDesktopConfig, writeDesktopConfig } from "../config/desktop-config-store.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";
import { startDesktopRemoteAccess, stopDesktopRemoteAccess } from "./desktop-remote-access-service.js";
import {
	type DesktopRemoteDesktopHostHandle,
	startDesktopRemoteDesktopHost,
	stopDesktopRemoteDesktopHost,
} from "./desktop-remote-desktop-host.js";

const log = getAppLogger("remote-pairing");
const CREDENTIAL_NAMESPACE = "remote-control";
const CREDENTIAL_OWNER = "desktop";
const CREDENTIAL_NAME = "desktop-secret";

export interface DesktopRemotePairingServiceOptions {
	readonly appRoot: string;
	readonly isPackaged: boolean;
	readonly devServerUrl?: string;
	readonly conversationCwd: string;
	readonly defaultRelayBaseUrl?: string;
}

export interface DesktopRemotePairingState {
	readonly status: "idle" | "ready" | "connected" | "error";
	readonly relayBaseUrl?: string;
	readonly pairingId?: string;
	readonly inviteUri?: string;
	readonly inputEnabled: boolean;
	readonly inputSupported: boolean;
	readonly error?: string;
}

export class DesktopRemotePairingService {
	private readonly vault = getDesktopCredentialVault();
	private state: DesktopRemotePairingState = {
		status: "idle",
		inputEnabled: false,
		inputSupported: false,
	};
	private host: DesktopRemoteDesktopHostHandle | undefined;
	private connectionState: RemoteConnectionState = "idle";

	constructor(private readonly options: DesktopRemotePairingServiceOptions) {}

	getState(): DesktopRemotePairingState {
		return { ...this.state };
	}

	async restore(): Promise<void> {
		const config = await readDesktopConfig();
		const remote = config.remoteControl;
		const secret = this.readDesktopSecret();
		if (!remote?.pairingId || !remote.relayBaseUrl || !secret) return;
		this.state = {
			status: "ready",
			relayBaseUrl: remote.relayBaseUrl,
			pairingId: remote.pairingId,
			inputEnabled: remote.inputEnabled === true,
			inputSupported: false,
		};
		try {
			await this.startActive(remote.relayBaseUrl, remote.pairingId, secret, remote.inputEnabled === true);
			this.state = {
				...this.state,
				status: this.connectionState === "online" ? "connected" : this.state.status,
				inputEnabled: remote.inputEnabled === true && this.host?.inputSupported === true,
				inputSupported: this.host?.inputSupported === true,
			};
			log.info("remote pairing restored", { pairingId: remote.pairingId });
		} catch (error) {
			this.state = {
				status: "error",
				inputEnabled: remote.inputEnabled === true,
				inputSupported: false,
				error: error instanceof Error ? error.message : String(error),
			};
			log.warn("remote pairing restore failed", { error: this.state.error });
		}
	}

	async create(relayBaseUrl?: string): Promise<DesktopRemotePairingState> {
		const relay = normalizeRelayBaseUrl(relayBaseUrl ?? this.options.defaultRelayBaseUrl);
		if (!relay) throw new Error("请输入有效的中继地址");
		if (!this.vault.isAvailable()) throw new Error("当前系统无法使用安全凭据存储");
		await this.revoke(false);
		const pairingId = randomBytes(24).toString("base64url");
		const desktopSecret = randomBytes(32).toString("base64url");
		const bootstrapSecret = randomBytes(32).toString("base64url");
		this.vault.put(
			{ namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: CREDENTIAL_NAME },
			desktopSecret,
			{ kind: "remote-desktop", consumer: "desktop" },
		);
		const config = await readDesktopConfig();
		await this.persistRemoteConfig(config, { relayBaseUrl: relay, pairingId, inputEnabled: false });
		await this.startActive(relay, pairingId, desktopSecret, false, bootstrapSecret);
		this.state = {
			status: this.connectionState === "online" ? "connected" : "ready",
			relayBaseUrl: relay,
			pairingId,
			inviteUri: buildInviteUri(relay, pairingId, bootstrapSecret),
			inputEnabled: false,
			inputSupported: this.host?.inputSupported === true,
		};
		log.info("remote pairing created", { pairingId, host: hostname() });
		return this.getState();
	}

	async setInputEnabled(enabled: boolean): Promise<DesktopRemotePairingState> {
		const effective = enabled && this.host?.inputSupported === true;
		if (effective) this.host?.grantInput();
		else this.host?.revokeInput();
		this.state = { ...this.state, inputEnabled: effective };
		const config = await readDesktopConfig();
		if (config.remoteControl) await this.persistRemoteConfig(config, { inputEnabled: effective });
		return this.getState();
	}

	async revoke(clearCredential = true): Promise<void> {
		await stopDesktopRemoteAccess();
		await stopDesktopRemoteDesktopHost();
		this.host = undefined;
		this.connectionState = "idle";
		if (clearCredential)
			this.vault.remove({ namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: CREDENTIAL_NAME });
		const config = await readDesktopConfig();
		if (config.remoteControl) await writeDesktopConfig({ ...config, remoteControl: undefined });
		this.state = { status: "idle", inputEnabled: false, inputSupported: false };
		log.info("remote pairing revoked");
	}

	private async startActive(
		relay: string,
		pairingId: string,
		desktopSecret: string,
		inputEnabled: boolean,
		bootstrapSecret?: string,
	): Promise<void> {
		const controlTarget = `${relay}/v1/relay/${pairingId}/desktop#${new URLSearchParams({ pairing: desktopSecret, ...(bootstrapSecret ? { bootstrap: bootstrapSecret } : {}) }).toString()}`;
		const signalingTarget = `${relay}/v1/desktop/${pairingId}/host#pairing=${encodeURIComponent(desktopSecret)}`;
		await startDesktopRemoteAccess({
			controlTarget,
			conversationCwd: this.options.conversationCwd,
			onStateChange: (state) => this.handleConnectionState(state),
		});
		this.host = await startDesktopRemoteDesktopHost({
			signalingTarget,
			inputEnabled,
			appRoot: this.options.appRoot,
			isPackaged: this.options.isPackaged,
			devServerUrl: this.options.devServerUrl,
		});
	}

	private handleConnectionState(state: RemoteConnectionState): void {
		this.connectionState = state;
		if (state === "online") {
			this.state = { ...this.state, status: "connected", error: undefined };
			return;
		}
		if (state === "connecting" || state === "reconnecting" || state === "recovering") {
			this.state = { ...this.state, status: "ready", error: undefined };
			return;
		}
		if (state === "failed") {
			this.state = { ...this.state, status: "error", error: "远程连接失败" };
		}
	}

	private readDesktopSecret(): string | undefined {
		return this.vault.get({ namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: CREDENTIAL_NAME });
	}

	private async persistRemoteConfig(
		config: DesktopConfig,
		patch: NonNullable<DesktopConfig["remoteControl"]>,
	): Promise<void> {
		await writeDesktopConfig({ ...config, remoteControl: { ...config.remoteControl, ...patch } });
	}
}

function normalizeRelayBaseUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const parsed = new URL(value.trim());
	if (
		parsed.protocol !== "http:" &&
		parsed.protocol !== "https:" &&
		parsed.protocol !== "ws:" &&
		parsed.protocol !== "wss:"
	)
		return undefined;
	const protocol = parsed.protocol === "http:" ? "ws:" : parsed.protocol === "https:" ? "wss:" : parsed.protocol;
	return `${protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
}

function buildInviteUri(relay: string, pairingId: string, bootstrap: string): string {
	const webRelay = relay.replace(/^ws/, "http");
	return `vetta://pair?relay=${encodeURIComponent(webRelay)}&pairingId=${encodeURIComponent(pairingId)}&bootstrap=${encodeURIComponent(bootstrap)}`;
}
