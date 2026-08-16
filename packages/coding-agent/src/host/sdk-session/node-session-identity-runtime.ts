import { randomUUID } from "node:crypto";
import {
	FileConversationRuntimeSessionCatalog,
	resolveConversationFilePath,
	resolveSessionIdFromPath,
} from "@vetta/runtime-node/conversation";
import type {
	CodingAgentSdkSessionCatalogContext,
	CodingAgentSdkSessionIdentityRuntime,
} from "./contracts/session-identity-runtime.js";
import { resolveCodingAgentSdkSessionStorage } from "./node-session-storage.js";

/** 兼容公共 SDK 默认行为的 Node Session identity 实现。 */
export const nodeCodingAgentSdkSessionIdentityRuntime: CodingAgentSdkSessionIdentityRuntime = {
	resolveStorage: (target) => resolveCodingAgentSdkSessionStorage(target, randomUUID),
	resolveDefaultCwd: (cwd) => cwd ?? process.cwd(),
	createSessionCatalog: ({ storage, cwd, artifactCleaner }: CodingAgentSdkSessionCatalogContext) => {
		if (!storage.conversationDir) return EMPTY_SESSION_CATALOG;
		return new FileConversationRuntimeSessionCatalog({
			roots: [{ cwd: cwd ?? process.cwd(), sessionDir: storage.conversationDir }],
			artifactCleaner,
		});
	},
	createSessionId: randomUUID,
	resolveSessionId: resolveSessionIdFromPath,
	resolveSessionPath: resolveConversationFilePath,
};

const EMPTY_SESSION_CATALOG = {
	ownsSession: async () => false,
	listProjects: async () => [],
	listSessions: async () => [],
	renameSession: async () => {
		throw new Error("In-memory SDK sessions cannot be renamed through a file catalog");
	},
	deleteSessionArtifacts: async () => {},
} satisfies ReturnType<CodingAgentSdkSessionIdentityRuntime["createSessionCatalog"]>;
