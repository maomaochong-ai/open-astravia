import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { resolveSessionIdFromPath } from "@vetta/runtime-storage/conversation";
import type { CodingAgentConversationPersistenceFactory } from "../../composition/conversation/persistence.js";
import { createInMemoryCodingAgentConversationPersistence } from "../../composition/conversation/persistence.js";

export type GreenfieldSdkSessionStorageTarget =
	| { readonly kind: "memory"; readonly sessionId?: string }
	| {
			readonly kind: "file-create";
			readonly conversationDir: string;
			readonly sessionId?: string;
	  }
	| {
			readonly kind: "file-resume";
			readonly conversationDir: string;
			readonly sessionPath: string;
	  };

export type GreenfieldSdkSessionStorageOperation = "create" | "resume";

export interface ResolvedGreenfieldSdkSessionStorage {
	readonly operation: GreenfieldSdkSessionStorageOperation;
	readonly sessionId: string;
	readonly conversationDir?: string;
	readonly createConversationPersistence?: CodingAgentConversationPersistenceFactory;
}

export const GREENFIELD_SDK_STORAGE_ERROR_CODES = {
	INVALID_CONVERSATION_DIR: "greenfield_sdk_invalid_conversation_dir",
	INVALID_SESSION_ID: "greenfield_sdk_invalid_session_id",
	INVALID_SESSION_PATH: "greenfield_sdk_invalid_session_path",
} as const;

export type GreenfieldSdkStorageErrorCode =
	(typeof GREENFIELD_SDK_STORAGE_ERROR_CODES)[keyof typeof GREENFIELD_SDK_STORAGE_ERROR_CODES];

export class GreenfieldSdkStorageError extends Error {
	constructor(
		readonly code: GreenfieldSdkStorageErrorCode,
		message: string,
		readonly target: GreenfieldSdkSessionStorageTarget,
	) {
		super(message);
		this.name = "GreenfieldSdkStorageError";
	}
}

/** 把 SDK 存储意图解析为 Composition 可消费的持久化配置。 */
export function resolveGreenfieldSdkSessionStorage(
	target: GreenfieldSdkSessionStorageTarget,
): ResolvedGreenfieldSdkSessionStorage {
	if (target.kind === "memory") {
		return {
			operation: "create",
			sessionId: normalizeSessionId(target.sessionId, target),
			createConversationPersistence: () => createInMemoryCodingAgentConversationPersistence(),
		};
	}

	const conversationDir = target.conversationDir.trim();
	if (!conversationDir) {
		throw new GreenfieldSdkStorageError(
			GREENFIELD_SDK_STORAGE_ERROR_CODES.INVALID_CONVERSATION_DIR,
			"Greenfield SDK file storage requires a conversation directory",
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
		throw new GreenfieldSdkStorageError(
			GREENFIELD_SDK_STORAGE_ERROR_CODES.INVALID_SESSION_PATH,
			`Greenfield SDK cannot resume a session outside the native conversation directory: ${target.sessionPath}`,
			target,
		);
	}
	return {
		operation: "resume",
		sessionId,
		conversationDir: resolvedConversationDir,
	};
}

function normalizeSessionId(sessionId: string | undefined, target: GreenfieldSdkSessionStorageTarget): string {
	if (sessionId === undefined) return randomUUID();
	const normalized = sessionId.trim();
	if (normalized) return normalized;
	throw new GreenfieldSdkStorageError(
		GREENFIELD_SDK_STORAGE_ERROR_CODES.INVALID_SESSION_ID,
		"Greenfield SDK session ID must not be empty",
		target,
	);
}
