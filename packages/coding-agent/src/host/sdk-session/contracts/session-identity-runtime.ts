import type { RuntimeSessionCatalog } from "@vetta/runtime-core";
import type { CodingAgentConversationPersistenceFactory } from "../../../composition/contracts/index.js";
import type { CodingAgentSessionStorageTarget } from "../../../public-api/sdk/sdk-create-contract.js";

export type CodingAgentSdkSessionStorageOperation = "create" | "resume";

export interface ResolvedCodingAgentSdkSessionStorage {
	readonly operation: CodingAgentSdkSessionStorageOperation;
	readonly sessionId: string;
	readonly conversationDir?: string;
	readonly createConversationPersistence: CodingAgentConversationPersistenceFactory;
}

export interface CodingAgentSdkSessionArtifactCleaner {
	deleteSessionArtifacts(sessionId: string): Promise<void>;
}

export interface CodingAgentSdkSessionCatalogContext {
	readonly storage: ResolvedCodingAgentSdkSessionStorage;
	readonly cwd?: string;
	readonly artifactCleaner?: CodingAgentSdkSessionArtifactCleaner;
}

/** SDK Session identity 与持久化所在宿主必须提供的平台能力。 */
export interface CodingAgentSdkSessionIdentityRuntime {
	resolveStorage(target: CodingAgentSessionStorageTarget): ResolvedCodingAgentSdkSessionStorage;
	resolveDefaultCwd(cwd: string | undefined): string;
	createSessionCatalog(context: CodingAgentSdkSessionCatalogContext): RuntimeSessionCatalog;
	createSessionId(): string;
	resolveSessionId(conversationDir: string, sessionPath: string): string | undefined;
	resolveSessionPath(conversationDir: string, sessionId: string): string;
}
