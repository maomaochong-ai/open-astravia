import {
	getOAuthApiKey,
	getOAuthProvider,
	getOAuthProviders,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
	type OAuthProviderId,
	type OAuthProviderInterface,
} from "@vetta/ai";
import type { OAuthCredential } from "./contracts.js";

export interface OAuthCredentialRuntime {
	hasProvider(providerId: string): boolean;
	login(providerId: OAuthProviderId, callbacks: OAuthLoginCallbacks): Promise<OAuthCredential>;
	getApiKey(providerId: string, credentials: OAuthCredentials): string | undefined;
	refresh(
		providerId: OAuthProviderId,
		credentials: Record<string, OAuthCredentials>,
	): Promise<{ readonly apiKey: string; readonly newCredentials: OAuthCredentials } | null>;
	listProviders(): readonly OAuthProviderInterface[];
}

/** 每次调用都读取 @vetta/ai 的动态 Provider 目录，不冻结运行时注册结果。 */
export function createOAuthCredentialRuntime(): OAuthCredentialRuntime {
	return {
		hasProvider: (providerId) => getOAuthProvider(providerId) !== undefined,
		async login(providerId, callbacks) {
			const provider = getOAuthProvider(providerId);
			if (!provider) throw new Error(`Unknown OAuth provider: ${providerId}`);
			return { type: "oauth", ...(await provider.login(callbacks)) };
		},
		getApiKey(providerId, credentials) {
			return getOAuthProvider(providerId)?.getApiKey(credentials);
		},
		refresh: (providerId, credentials) => getOAuthApiKey(providerId, credentials),
		listProviders: () => getOAuthProviders(),
	};
}
