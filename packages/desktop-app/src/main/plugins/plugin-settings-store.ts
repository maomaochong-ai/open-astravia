import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import type { PluginSettingSchema } from "../../preload/api-types/plugins.js";
import type { CredentialRef, CredentialVault } from "../credentials/credential-vault.js";

type PluginSettingsData = Record<string, Record<string, unknown>>;

const CREDENTIAL_NAMESPACE = "plugin-settings";

function credentialRef(pluginId: string, key: string): CredentialRef {
	return { namespace: CREDENTIAL_NAMESPACE, ownerId: pluginId, name: key };
}

function secretKeys(schema: readonly PluginSettingSchema[]): Set<string> {
	return new Set(schema.filter((setting) => setting.type === "secret").map((setting) => setting.key));
}

export class PluginSettingsStore {
	constructor(
		private readonly settingsPath: string,
		private readonly credentialVault: CredentialVault,
	) {}

	get(pluginId: string, schema: readonly PluginSettingSchema[]): Record<string, unknown> {
		const store = this.read();
		const stored = { ...(store[pluginId] ?? {}) };
		const secrets = secretKeys(schema);
		const effective: Record<string, unknown> = {};
		let migrated = false;

		for (const setting of schema) {
			if (setting.type !== "secret" && setting.default !== undefined) effective[setting.key] = setting.default;
		}
		for (const [key, value] of Object.entries(stored)) {
			if (!secrets.has(key)) effective[key] = value;
		}

		for (const key of secrets) {
			const legacyValue = stored[key];
			const ref = credentialRef(pluginId, key);
			if (this.credentialVault.isAvailable()) {
				let value = this.credentialVault.get(ref);
				if (value === undefined && typeof legacyValue === "string" && legacyValue.length > 0) {
					this.credentialVault.put(ref, legacyValue, { kind: "api-key", consumer: pluginId });
					value = legacyValue;
				}
				if (key in stored) {
					delete stored[key];
					migrated = true;
				}
				if (value !== undefined) effective[key] = value;
			} else if (typeof legacyValue === "string" && legacyValue.length > 0) {
				// Preserve access to legacy plaintext until secure storage becomes available.
				effective[key] = legacyValue;
			}
		}

		if (migrated) {
			store[pluginId] = stored;
			this.write(store);
		}
		return effective;
	}

	set(
		pluginId: string,
		values: Record<string, unknown>,
		schema: readonly PluginSettingSchema[],
	): Record<string, unknown> {
		const store = this.read();
		const stored = { ...(store[pluginId] ?? {}) };
		const secrets = secretKeys(schema);

		for (const [key, value] of Object.entries(values)) {
			if (!secrets.has(key)) {
				stored[key] = value;
				continue;
			}
			if (typeof value !== "string") throw new Error(`Plugin secret setting must be a string: ${key}`);
			const ref = credentialRef(pluginId, key);
			if (value.length > 0) {
				this.credentialVault.put(ref, value, { kind: "api-key", consumer: pluginId });
			} else {
				this.credentialVault.remove(ref);
			}
			delete stored[key];
		}

		store[pluginId] = stored;
		this.write(store);
		return this.get(pluginId, schema);
	}

	private read(): PluginSettingsData {
		if (!existsSync(this.settingsPath)) return {};
		try {
			const parsed = JSON.parse(readFileSync(this.settingsPath, "utf8")) as PluginSettingsData;
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
		} catch {
			return {};
		}
	}

	private write(store: PluginSettingsData): void {
		mkdirSync(dirname(this.settingsPath), { recursive: true, mode: 0o700 });
		atomicWriteJSON(this.settingsPath, store);
		try {
			chmodSync(dirname(this.settingsPath), 0o700);
			chmodSync(this.settingsPath, 0o600);
		} catch {
			// Best effort on Windows and non-POSIX filesystems.
		}
	}
}
