import { join } from "node:path";
import { getEnvApiKey, type OAuthCredentials, type OAuthLoginCallbacks, type OAuthProviderId } from "@vetta/ai";
import { getAgentDir } from "../config.js";
import { resolveConfigValue } from "../configuration/config-value-resolver.js";
import { parseAuthDocument, serializeAuthDocument } from "./auth-document.js";
import type { AuthCredential, AuthStorageBackend, AuthStorageData, CodingAgentAuthRuntime } from "./contracts.js";
import { createOAuthCredentialRuntime, type OAuthCredentialRuntime } from "./oauth-credential-runtime.js";
import { FileAuthStorageBackend } from "./storage/file-auth-storage-backend.js";
import { InMemoryAuthStorageBackend } from "./storage/in-memory-auth-storage-backend.js";

export interface AuthStorageDependencies {
	readonly oauth?: OAuthCredentialRuntime;
}

export class AuthStorage implements CodingAgentAuthRuntime {
	private data: AuthStorageData = {};
	private readonly runtimeOverrides = new Map<string, string>();
	private fallbackResolver: ((provider: string) => string | undefined) | undefined;
	private loadError: Error | undefined;
	private errors: Error[] = [];
	private readonly oauth: OAuthCredentialRuntime;

	private constructor(
		private readonly storage: AuthStorageBackend,
		dependencies: AuthStorageDependencies = {},
	) {
		this.oauth = dependencies.oauth ?? createOAuthCredentialRuntime();
		this.reload();
	}

	static create(authPath?: string, dependencies?: AuthStorageDependencies): AuthStorage {
		return new AuthStorage(new FileAuthStorageBackend(authPath ?? join(getAgentDir(), "auth.json")), dependencies);
	}

	static fromStorage(storage: AuthStorageBackend, dependencies?: AuthStorageDependencies): AuthStorage {
		return new AuthStorage(storage, dependencies);
	}

	static inMemory(data: AuthStorageData = {}, dependencies?: AuthStorageDependencies): AuthStorage {
		const storage = new InMemoryAuthStorageBackend();
		storage.withLock(() => ({ result: undefined, next: serializeAuthDocument(data) }));
		return AuthStorage.fromStorage(storage, dependencies);
	}

	setRuntimeApiKey(provider: string, apiKey: string): void {
		this.runtimeOverrides.set(provider, apiKey);
	}

	removeRuntimeApiKey(provider: string): void {
		this.runtimeOverrides.delete(provider);
	}

	setFallbackResolver(resolver: (provider: string) => string | undefined): void {
		this.fallbackResolver = resolver;
	}

	reload(): void {
		let content: string | undefined;
		try {
			this.storage.withLock((current) => {
				content = current;
				return { result: undefined };
			});
			this.data = parseAuthDocument(content);
			this.loadError = undefined;
		} catch (error) {
			this.loadError = normalizeError(error);
			this.recordError(error);
		}
	}

	get(provider: string): AuthCredential | undefined {
		return this.data[provider];
	}

	set(provider: string, credential: AuthCredential): void {
		this.data[provider] = credential;
		this.persistProviderChange(provider, credential);
	}

	remove(provider: string): void {
		delete this.data[provider];
		this.persistProviderChange(provider, undefined);
	}

	list(): string[] {
		return Object.keys(this.data);
	}

	has(provider: string): boolean {
		return provider in this.data;
	}

	hasAuth(provider: string): boolean {
		if (this.runtimeOverrides.has(provider) || this.data[provider] !== undefined) return true;
		if (getEnvApiKey(provider)) return true;
		return Boolean(this.fallbackResolver?.(provider));
	}

	getAll(): AuthStorageData {
		return { ...this.data };
	}

	drainErrors(): Error[] {
		const drained = [...this.errors];
		this.errors = [];
		return drained;
	}

	async login(providerId: OAuthProviderId, callbacks: OAuthLoginCallbacks): Promise<void> {
		this.set(providerId, await this.oauth.login(providerId, callbacks));
	}

	logout(provider: string): void {
		this.remove(provider);
	}

	async getApiKey(providerId: string): Promise<string | undefined> {
		const runtimeKey = this.runtimeOverrides.get(providerId);
		if (runtimeKey) return runtimeKey;

		const credential = this.data[providerId];
		if (credential?.type === "api_key") return resolveConfigValue(credential.key);
		if (credential?.type === "oauth") {
			if (!this.oauth.hasProvider(providerId)) return undefined;
			if (Date.now() < credential.expires) return this.oauth.getApiKey(providerId, credential);
			try {
				return (await this.refreshOAuthTokenWithLock(providerId))?.apiKey;
			} catch (error) {
				this.recordError(error);
				this.reload();
				const updated = this.data[providerId];
				if (updated?.type === "oauth" && Date.now() < updated.expires) {
					return this.oauth.getApiKey(providerId, updated);
				}
				return undefined;
			}
		}

		const envKey = getEnvApiKey(providerId);
		if (envKey) return envKey;
		return this.fallbackResolver?.(providerId) || undefined;
	}

	getOAuthProviders() {
		return this.oauth.listProviders();
	}

	private persistProviderChange(provider: string, credential: AuthCredential | undefined): void {
		if (this.loadError) return;
		try {
			this.storage.withLock((current) => {
				const merged = { ...parseAuthDocument(current) };
				if (credential) merged[provider] = credential;
				else delete merged[provider];
				return { result: undefined, next: serializeAuthDocument(merged) };
			});
		} catch (error) {
			this.recordError(error);
		}
	}

	private async refreshOAuthTokenWithLock(
		providerId: OAuthProviderId,
	): Promise<{ readonly apiKey: string; readonly newCredentials: OAuthCredentials } | null> {
		return this.storage.withLockAsync(async (current) => {
			const currentData = parseAuthDocument(current);
			this.data = currentData;
			this.loadError = undefined;
			const credential = currentData[providerId];
			if (credential?.type !== "oauth") return { result: null };
			if (Date.now() < credential.expires) {
				const apiKey = this.oauth.getApiKey(providerId, credential);
				return {
					result: apiKey === undefined ? null : { apiKey, newCredentials: credential },
				};
			}

			const oauthCredentials: Record<string, OAuthCredentials> = {};
			for (const [provider, value] of Object.entries(currentData)) {
				if (value.type === "oauth") oauthCredentials[provider] = value;
			}
			const refreshed = await this.oauth.refresh(providerId, oauthCredentials);
			if (!refreshed) return { result: null };
			const merged: AuthStorageData = {
				...currentData,
				[providerId]: { type: "oauth", ...refreshed.newCredentials },
			};
			this.data = merged;
			this.loadError = undefined;
			return { result: refreshed, next: serializeAuthDocument(merged) };
		});
	}

	private recordError(error: unknown): void {
		this.errors.push(normalizeError(error));
	}
}

export function createCodingAgentAuthRuntime(authPath?: string): CodingAgentAuthRuntime {
	return AuthStorage.create(authPath);
}

function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
