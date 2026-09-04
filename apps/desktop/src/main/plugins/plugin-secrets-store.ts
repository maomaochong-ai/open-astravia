import type { CredentialRef, CredentialVault } from "../credentials/credential-vault.js";

/**
 * 插件密钥（`ctx.secrets`）。值只存 CredentialVault，不落明文。
 *
 * 命名空间沿用历史的 `plugin-settings`：ADR-0105 之前 `contributes.settings` 的 `secret`
 * 字段就写在这里，改名会让用户已保存的 API Key 全部失联。
 */
const CREDENTIAL_NAMESPACE = "plugin-settings";

function credentialRef(pluginId: string, key: string): CredentialRef {
	return { namespace: CREDENTIAL_NAMESPACE, ownerId: pluginId, name: key };
}

function assertKey(key: string): string {
	const trimmed = key.trim();
	if (trimmed === "" || trimmed !== key) throw new Error("Invalid plugin secret key");
	return trimmed;
}

export class PluginSecretsStore {
	constructor(private readonly credentialVault: CredentialVault) {}

	get(pluginId: string, key: string): string | undefined {
		if (!this.credentialVault.isAvailable()) return undefined;
		return this.credentialVault.get(credentialRef(pluginId, assertKey(key)));
	}

	has(pluginId: string, key: string): boolean {
		return this.credentialVault.has(credentialRef(pluginId, assertKey(key)));
	}

	keys(pluginId: string): string[] {
		return this.credentialVault
			.listRefs(CREDENTIAL_NAMESPACE)
			.filter((ref) => ref.ownerId === pluginId)
			.map((ref) => ref.name)
			.sort();
	}

	/** 写入空串等价于删除，避免插件用空值表达「已清空」时留下一条不可读的记录。 */
	set(pluginId: string, key: string, value: string): void {
		const name = assertKey(key);
		if (typeof value !== "string") throw new Error("Plugin secret value must be a string");
		if (value.length === 0) {
			this.delete(pluginId, name);
			return;
		}
		this.credentialVault.put(credentialRef(pluginId, name), value, { kind: "api-key", consumer: pluginId });
	}

	delete(pluginId: string, key: string): void {
		this.credentialVault.remove(credentialRef(pluginId, assertKey(key)));
	}

	/** 插件卸载时清空其全部密钥。 */
	clear(pluginId: string): void {
		for (const key of this.keys(pluginId)) this.delete(pluginId, key);
	}
}
