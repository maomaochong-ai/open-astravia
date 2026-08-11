import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderId, OAuthProviderInterface } from "@vetta/ai";

export type ApiKeyCredential = {
	readonly type: "api_key";
	readonly key: string;
};

export type OAuthCredential = {
	readonly type: "oauth";
} & OAuthCredentials;

export type AuthCredential = ApiKeyCredential | OAuthCredential;
export type AuthStorageData = Record<string, AuthCredential>;

export interface AuthStorageTransaction<T> {
	readonly result: T;
	readonly next?: string;
}

/** 凭据持久化事务 Port；文件锁和内存实现位于 storage 子目录。 */
export interface AuthStorageBackend {
	withLock<T>(operation: (current: string | undefined) => AuthStorageTransaction<T>): T;
	withLockAsync<T>(operation: (current: string | undefined) => Promise<AuthStorageTransaction<T>>): Promise<T>;
}

/** 宿主和模型运行时消费的稳定认证能力，不暴露具体文件实现。 */
export interface CodingAgentAuthRuntime {
	setRuntimeApiKey(provider: string, apiKey: string): void;
	removeRuntimeApiKey(provider: string): void;
	setFallbackResolver(resolver: (provider: string) => string | undefined): void;
	reload(): void;
	get(provider: string): AuthCredential | undefined;
	set(provider: string, credential: AuthCredential): void;
	remove(provider: string): void;
	list(): string[];
	has(provider: string): boolean;
	hasAuth(provider: string): boolean;
	getAll(): AuthStorageData;
	drainErrors(): Error[];
	login(providerId: OAuthProviderId, callbacks: OAuthLoginCallbacks): Promise<void>;
	logout(provider: string): void;
	getApiKey(providerId: string): Promise<string | undefined>;
	getOAuthProviders(): readonly OAuthProviderInterface[];
}
