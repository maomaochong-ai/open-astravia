import { resolve } from "node:path";
import {
	createFileConversationPersistence,
	createInMemoryConversationPersistence,
	resolveSessionIdFromPath,
} from "@vetta/runtime-node/conversation";
import type { CodingAgentSessionStorageTarget } from "../../public-api/sdk/sdk-create-contract.js";
import type { ResolvedCodingAgentSdkSessionStorage } from "./contracts/session-identity-runtime.js";

export const CODING_AGENT_SDK_STORAGE_ERROR_CODES = {
	INVALID_CONVERSATION_DIR: "coding_agent_sdk_invalid_conversation_dir",
	INVALID_SESSION_ID: "coding_agent_sdk_invalid_session_id",
	INVALID_SESSION_PATH: "coding_agent_sdk_invalid_session_path",
} as const;

export type CodingAgentSdkStorageErrorCode =
	(typeof CODING_AGENT_SDK_STORAGE_ERROR_CODES)[keyof typeof CODING_AGENT_SDK_STORAGE_ERROR_CODES];

export class CodingAgentSdkStorageError extends Error {
	constructor(
		readonly code: CodingAgentSdkStorageErrorCode,
		message: string,
		readonly target: CodingAgentSessionStorageTarget,
	) {
		super(message);
		this.name = "CodingAgentSdkStorageError";
	}
}

/** 在 Node Host 中把 SDK 存储意图解析为 Composition 可消费的持久化配置。 */
export function resolveCodingAgentSdkSessionStorage(
	target: CodingAgentSessionStorageTarget,
	createSessionId: () => string,
): ResolvedCodingAgentSdkSessionStorage {
	if (target.kind === "memory") {
		return {
			operation: "create",
			sessionId: normalizeSessionId(target.sessionId, target, createSessionId),
			createConversationPersistence: () => createInMemoryConversationPersistence(),
		};
	}

	const conversationDir = target.conversationDir.trim();
	if (!conversationDir) {
		throw new CodingAgentSdkStorageError(
			CODING_AGENT_SDK_STORAGE_ERROR_CODES.INVALID_CONVERSATION_DIR,
			"SDK file storage requires a conversation directory",
			target,
		);
	}
	const resolvedConversationDir = resolve(conversationDir);
	if (target.kind === "file-create") {
		return {
			operation: "create",
			sessionId: normalizeSessionId(target.sessionId, target, createSessionId),
			conversationDir: resolvedConversationDir,
			createConversationPersistence: () => createFileConversationPersistence(resolvedConversationDir),
		};
	}

	const sessionId = resolveSessionIdFromPath(resolvedConversationDir, target.sessionPath);
	if (!sessionId) {
		throw new CodingAgentSdkStorageError(
			CODING_AGENT_SDK_STORAGE_ERROR_CODES.INVALID_SESSION_PATH,
			`SDK cannot resume a session outside the native conversation directory: ${target.sessionPath}`,
			target,
		);
	}
	return {
		operation: "resume",
		sessionId,
		conversationDir: resolvedConversationDir,
		createConversationPersistence: () => createFileConversationPersistence(resolvedConversationDir),
	};
}

function normalizeSessionId(
	sessionId: string | undefined,
	target: CodingAgentSessionStorageTarget,
	createSessionId: () => string,
): string {
	if (sessionId === undefined) return createSessionId();
	const normalized = sessionId.trim();
	if (normalized) return normalized;
	throw new CodingAgentSdkStorageError(
		CODING_AGENT_SDK_STORAGE_ERROR_CODES.INVALID_SESSION_ID,
		"SDK session ID must not be empty",
		target,
	);
}
