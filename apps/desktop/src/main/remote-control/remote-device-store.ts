import {
	fromBase64Url,
	generateIdentityKeyPair,
	identityKeyPairFromSecret,
	type RemoteIdentityKeyPair,
	toBase64Url,
} from "@vetta/remote-control";
import type { DesktopConfig, RemoteControlConfig, RemoteControlDeviceRecord } from "../config/desktop-config-store.js";
import type { CredentialRef } from "../credentials/credential-vault.js";

const CREDENTIAL_NAMESPACE = "remote-control";
const CREDENTIAL_OWNER = "desktop";
const IDENTITY_CREDENTIAL = "identity-secret";

export interface RemoteDeviceStoreVault {
	isAvailable(): boolean;
	get(ref: CredentialRef): string | undefined;
	put(ref: CredentialRef, value: string, metadata?: { kind: string; consumer: string }): void;
	remove(ref: CredentialRef): void;
}

export interface RemoteDeviceStoreOptions {
	readonly readConfig: () => Promise<DesktopConfig>;
	readonly writeConfig: (config: DesktopConfig) => Promise<void>;
	readonly vault: RemoteDeviceStoreVault;
	readonly defaultRelayBaseUrl?: string;
}

export const EMPTY_REMOTE_CONTROL_CONFIG: RemoteControlConfig = { cloudEnabled: true, devices: [] };

/**
 * Persistence for paired phones. Non-secret facts live in the desktop config;
 * the desktop identity secret, each device's relay secret and a not-yet-claimed
 * invite's mobile secret live in the credential vault. The vault entries are
 * removed together with the device so a revoked phone leaves nothing behind.
 */
export class RemoteDeviceStore {
	constructor(private readonly options: RemoteDeviceStoreOptions) {}

	async read(): Promise<RemoteControlConfig> {
		const config = await this.options.readConfig();
		return this.withDefaults(config.remoteControl ?? EMPTY_REMOTE_CONTROL_CONFIG);
	}

	async update(mutate: (current: RemoteControlConfig) => RemoteControlConfig): Promise<RemoteControlConfig> {
		const config = await this.options.readConfig();
		const next = mutate(config.remoteControl ?? EMPTY_REMOTE_CONTROL_CONFIG);
		await this.options.writeConfig({ ...config, remoteControl: next });
		return this.withDefaults(next);
	}

	/** The default relay is a runtime fallback, never persisted, so a later default change reaches old configs. */
	private withDefaults(remote: RemoteControlConfig): RemoteControlConfig {
		return {
			...remote,
			relayBaseUrl: remote.relayBaseUrl ?? this.options.defaultRelayBaseUrl,
			devices: [...remote.devices],
		};
	}

	async upsertDevice(record: RemoteControlDeviceRecord): Promise<void> {
		await this.update((current) => ({
			...current,
			devices: [...current.devices.filter((device) => device.id !== record.id), record],
		}));
	}

	async patchDevice(
		id: string,
		patch: Partial<RemoteControlDeviceRecord>,
	): Promise<RemoteControlDeviceRecord | undefined> {
		let updated: RemoteControlDeviceRecord | undefined;
		await this.update((current) => ({
			...current,
			devices: current.devices.map((device) => {
				if (device.id !== id) return device;
				updated = { ...device, ...patch, id };
				return updated;
			}),
		}));
		return updated;
	}

	async removeDevice(id: string): Promise<void> {
		await this.update((current) => ({ ...current, devices: current.devices.filter((device) => device.id !== id) }));
		this.options.vault.remove(ref(relaySecretName(id)));
		this.options.vault.remove(ref(mobileSecretName(id)));
	}

	vaultAvailable(): boolean {
		return this.options.vault.isAvailable();
	}

	/** The desktop's long-term X25519 identity; created on first use and kept in the vault. */
	identity(): RemoteIdentityKeyPair {
		const stored = this.options.vault.get(ref(IDENTITY_CREDENTIAL));
		if (stored) {
			try {
				return identityKeyPairFromSecret(fromBase64Url(stored));
			} catch {
				// Corrupt entry: fall through and mint a new identity. Every phone
				// will need to re-pair, which is the only safe outcome.
			}
		}
		const pair = generateIdentityKeyPair();
		this.options.vault.put(ref(IDENTITY_CREDENTIAL), toBase64Url(pair.secretKey), {
			kind: "remote-identity",
			consumer: "desktop",
		});
		return pair;
	}

	relaySecret(id: string): string | undefined {
		return this.options.vault.get(ref(relaySecretName(id)));
	}

	putRelaySecret(id: string, secret: string): void {
		this.options.vault.put(ref(relaySecretName(id)), secret, { kind: "remote-relay", consumer: "desktop" });
	}

	/** Plaintext mobile secret, present only until the invite is claimed. */
	mobileSecret(id: string): string | undefined {
		return this.options.vault.get(ref(mobileSecretName(id)));
	}

	putMobileSecret(id: string, secret: string): void {
		this.options.vault.put(ref(mobileSecretName(id)), secret, { kind: "remote-invite", consumer: "desktop" });
	}

	clearMobileSecret(id: string): void {
		this.options.vault.remove(ref(mobileSecretName(id)));
	}
}

function ref(name: string): CredentialRef {
	return { namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name };
}

function relaySecretName(id: string): string {
	return `relay-secret-${id}`;
}

function mobileSecretName(id: string): string {
	return `mobile-secret-${id}`;
}
