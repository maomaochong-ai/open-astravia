import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { resolveSessionIdFromPath } from "@vetta/runtime-storage/conversation";
import type { CodingAgentConversationPersistenceFactory } from "../../composition/conversation/persistence.js";
import { createInMemoryCodingAgentConversationPersistence } from "../../composition/conversation/persistence.js";
import type { CodingAgentSessionStorageTarget } from "../../public-api/sdk/sdk-create-contract.js";

export type CodingAgentSdkSessionStorageOperation = "create" | "resume";

export interface ResolvedCodingAgentSdkSessionStorage {
	readonly operation: CodingAgentSdkSessionStorageOperation;
	readonly sessionId: string;
	readonly conversationDir?: string;
	readonly createConversationPersistence?: CodingAgentConversationPersistenceFactory;
}

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

/** 把 SDK 存储意图解析为 Composition 可消费的持久化配置。 */
export function resolveCodingAgentSdkSessionStorage(
	target: CodingAgentSessionStorageTarget,
): ResolvedCodingAgentSdkSessionStorage {
	if (target.kind === "memory") {
		return {
			operation: "create",
			sessionId: normalizeSessionId(target.sessionId, target),
			createConversationPersistence: () => createInMemoryCodingAgentConversationPersistence(),
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
	if (target.kind === "file-create") {
		return {
			operation: "create",
			sessionId: normalizeSessionId(target.sessionId, target),
			conversationDir: resolve(conversationDir),
		};
	}

	const resolvedConversationDir = resolve(conversationDir);
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
	};
}

function normalizeSessionId(sessionId: string | undefined, target: CodingAgentSessionStorageTarget): string {
	if (sessionId === undefined) return randomUUID();
	const normalized = sessionId.trim();
	if (normalized) return normalized;
	throw new CodingAgentSdkStorageError(
		CODING_AGENT_SDK_STORAGE_ERROR_CODES.INVALID_SESSION_ID,
		"SDK session ID must not be empty",
		target,
	);
}
