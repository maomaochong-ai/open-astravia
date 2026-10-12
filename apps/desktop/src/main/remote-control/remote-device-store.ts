import {
	fromBase64Url,
	generateIdentityKeyPair,
	identityKeyPairFromSecret,
	type RemoteIdentityKeyPair,
	toBase64Url,
} from "@vetta/remote-control";
import type {
	DesktopConfig,
	DesktopConfigUpdater,
	RemoteControlConfig,
	RemoteControlDeviceRecord,
} from "../config/desktop-config-store.js";
import type { CredentialRef } from "../credentials/credential-vault.js";
import { completeDevicePairing, pairingIdOf, restoreDevicePairings } from "./remote-device-pairings.js";

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
	readonly updateConfig: (update: DesktopConfigUpdater) => Promise<DesktopConfig>;
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
		const config = await this.options.updateConfig((current) => ({
			...current,
			remoteControl: mutate(current.remoteControl ?? EMPTY_REMOTE_CONTROL_CONFIG),
		}));
		return this.withDefaults(config.remoteControl ?? EMPTY_REMOTE_CONTROL_CONFIG);
	}

	/** The relay used when none is set; undefined when this build has none. */
	defaultRelayBaseUrl(): string | undefined {
		return this.options.defaultRelayBaseUrl;
	}

	/** The default relay is a runtime fallback, never persisted, so a later default change reaches old configs. */
	private withDefaults(remote: RemoteControlConfig): RemoteControlConfig {
		return {
			...remote,
			relayBaseUrl: remote.relayBaseUrl ?? this.options.defaultRelayBaseUrl,
			devices: [...remote.devices],
		};
	}

	async patchDevice(
		id: string,
		patch: Partial<RemoteControlDeviceRecord>,
		expectedPairingId?: string,
	): Promise<RemoteControlDeviceRecord | undefined> {
		let updated: RemoteControlDeviceRecord | undefined;
		await this.update((current) => ({
			...current,
			devices: current.devices.map((device) => {
				if (device.id !== id || (expectedPairingId !== undefined && pairingIdOf(device) !== expectedPairingId))
					return device;
				updated = { ...device, ...patch, id };
				return updated;
			}),
		}));
		return updated;
	}

	clearPairingSecrets(pairingId: string): void {
		this.options.vault.remove(ref(relaySecretName(pairingId)));
		this.options.vault.remove(ref(mobileSecretName(pairingId)));
	}

	async completePairing(pairingId: string, identityKey: string, name: string | undefined, now: number) {
		let completed: ReturnType<typeof completeDevicePairing> | undefined;
		const config = await this.update((current) => {
			completed = completeDevicePairing(current, pairingId, identityKey, name, now);
			return completed.config;
		});
		if (!completed) throw new Error("pairing was not saved");
		return { ...completed, config };
	}

	async restorePairings(): Promise<RemoteControlConfig> {
		const current = await this.read();
		const restored = restoreDevicePairings(current);
		const config =
			JSON.stringify(restored.config) === JSON.stringify(current)
				? current
				: await this.update((latest) => restoreDevicePairings(latest).config);
		return config;
	}

	async cleanupRetiredPairings(): Promise<RemoteControlConfig> {
		const current = await this.read();
		const retired = current.retiredPairingIds ?? [];
		for (const device of current.devices) {
			if (device.mobileIdentityKey) this.clearMobileSecret(pairingIdOf(device));
		}
		if (!retired.length) return current;
		const active = new Set([
			...current.devices.map(pairingIdOf),
			...(current.pendingPairings ?? []).map((pending) => pending.pairingId),
		]);
		for (const pairingId of retired) if (!active.has(pairingId)) this.clearPairingSecrets(pairingId);
		return this.update((latest) => ({
			...latest,
			retiredPairingIds: latest.retiredPairingIds?.filter((id) => !retired.includes(id)),
		}));
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
