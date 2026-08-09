import type { AuthStorage } from "@vetta/coding-agent/host-services";
import type { CredentialVault } from "../credentials/credential-vault.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";

const MODEL_CREDENTIAL_NAMESPACE = "models";
const MODEL_API_KEY_NAME = "api-key";
const modelCredentialLog = getAppLogger("model-credentials");

export interface ModelCredentialStore {
	isAvailable(): boolean;
	has(credentialRef: string): boolean;
	get(credentialRef: string): string | undefined;
	set(credentialRef: string, value: string): void;
	remove(credentialRef: string): void;
}

export class DesktopModelCredentialStore implements ModelCredentialStore {
	private syncedProviderIds = new Set<string>();

	constructor(private readonly vault: CredentialVault) {}

	isAvailable(): boolean {
		return this.vault.isAvailable();
	}

	has(credentialRef: string): boolean {
		return this.vault.has(modelApiKeyRef(credentialRef));
	}

	get(credentialRef: string): string | undefined {
		try {
			return this.vault.get(modelApiKeyRef(credentialRef));
		} catch (error) {
			modelCredentialLog.warn("模型凭据无法解密，将按未配置处理", {
				credentialRef,
				error: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
	}

	set(credentialRef: string, value: string): void {
		this.vault.put(modelApiKeyRef(credentialRef), value, {
			kind: "api-key",
			consumer: "model-provider",
		});
	}

	remove(credentialRef: string): void {
		this.vault.remove(modelApiKeyRef(credentialRef));
	}

	syncToAuthStorage(authStorage: AuthStorage, providers: Record<string, { credentialRef?: string }>): void {
		const nextProviderIds = new Set<string>();
		for (const [providerId, provider] of Object.entries(providers)) {
			if (!provider.credentialRef) continue;
			const apiKey = this.get(provider.credentialRef);
			if (!apiKey) continue;
			authStorage.setRuntimeApiKey(providerId, apiKey);
			nextProviderIds.add(providerId);
		}
		for (const providerId of this.syncedProviderIds) {
			if (!nextProviderIds.has(providerId)) authStorage.removeRuntimeApiKey(providerId);
		}
		this.syncedProviderIds = nextProviderIds;
	}
}

let desktopModelCredentialStore: DesktopModelCredentialStore | undefined;

export function getDesktopModelCredentialStore(): DesktopModelCredentialStore {
	desktopModelCredentialStore ??= new DesktopModelCredentialStore(getDesktopCredentialVault());
	return desktopModelCredentialStore;
}

function modelApiKeyRef(credentialRef: string) {
	return {
		namespace: MODEL_CREDENTIAL_NAMESPACE,
		ownerId: credentialRef,
		name: MODEL_API_KEY_NAME,
	};
}
