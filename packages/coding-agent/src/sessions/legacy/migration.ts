import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
	CONVERSATION_STORAGE_ERROR_CODES,
	ConversationOwnershipConflictError,
	ConversationStorageError,
	LegacySessionImportError,
	type LegacySessionImportIssueCode,
	migrateLegacySessionToV2,
} from "@vetta/runtime-storage/conversation";
import { normalizeCodingAgentLegacySessionEntry } from "./entry-normalizer.js";
import { acquireLegacySessionFormatLease } from "./lease.js";

export type CodingAgentLegacySessionIncompatibilityCode =
	| "session_corrupt"
	| "session_incompatible"
	| "session_version_unsupported";

export interface CodingAgentLegacySessionMigrationSuccess {
	readonly kind: "session";
	readonly status: "migrated" | "reused";
	readonly sourcePath: string;
	readonly targetPath: string;
	readonly targetSessionId: string;
}

export interface CodingAgentLegacySessionMigrationIncompatible {
	readonly kind: "session-incompatible";
	readonly status: "not-representable";
	readonly sourcePath: string;
	readonly errorCode: CodingAgentLegacySessionIncompatibilityCode;
	readonly sourceVersion?: number;
	readonly issueCode?: LegacySessionImportIssueCode;
	readonly issueCount?: number;
}

export type CodingAgentLegacySessionMigration =
	| CodingAgentLegacySessionMigrationSuccess
	| CodingAgentLegacySessionMigrationIncompatible;

/** Non-destructively import one official Coding Agent JSONL v1-v3 session into a deterministic V2 target. */
export async function migrateCodingAgentLegacySession(
	sourcePath: string,
	targetRootDir: string,
): Promise<CodingAgentLegacySessionMigration> {
	const canonicalSourcePath = await realpath(resolve(sourcePath));
	const lease = acquireLegacySessionFormatLease(canonicalSourcePath);
	if (lease.kind === "locked") {
		throw new ConversationOwnershipConflictError(canonicalSourcePath, lease.lockPath, {
			token: "legacy-session-lock",
			pid: lease.holder.pid,
			hostname: lease.holder.hostname,
			acquiredAt: lease.holder.openedAt,
		});
	}

	try {
		const sourceContent = await readFile(canonicalSourcePath);
		const targetSessionId = deterministicTargetSessionId(canonicalSourcePath, sourceContent);
		try {
			const result = await migrateWithConflictRecovery(canonicalSourcePath, targetRootDir, targetSessionId);
			return {
				kind: "session",
				status: result.created ? "migrated" : "reused",
				sourcePath: canonicalSourcePath,
				targetPath: result.targetPath,
				targetSessionId: result.targetSessionId,
			};
		} catch (error) {
			if (!isNotRepresentable(error)) throw error;
			return toIncompatibleResult(canonicalSourcePath, error);
		}
	} finally {
		lease.lease.release();
	}
}

async function migrateWithConflictRecovery(sourcePath: string, targetRootDir: string, targetSessionId: string) {
	try {
		return await migrateToTarget(sourcePath, targetRootDir, targetSessionId);
	} catch (error) {
		if (!isTargetConflict(error)) throw error;
		return migrateToTarget(sourcePath, targetRootDir, `${targetSessionId}-recovery`);
	}
}

function migrateToTarget(sourcePath: string, targetRootDir: string, targetSessionId: string) {
	return migrateLegacySessionToV2({
		sourcePath,
		targetRootDir,
		targetSessionId,
		reuseIdenticalTarget: true,
		entryNormalizer: normalizeCodingAgentLegacySessionEntry,
	});
}

function toIncompatibleResult(
	sourcePath: string,
	error: ConversationStorageError,
): CodingAgentLegacySessionMigrationIncompatible {
	if (!(error instanceof LegacySessionImportError)) {
		return {
			kind: "session-incompatible",
			status: "not-representable",
			sourcePath,
			errorCode:
				error.code === CONVERSATION_STORAGE_ERROR_CODES.CORRUPT ? "session_corrupt" : "session_incompatible",
		};
	}

	const firstIssue = error.analysis.issues[0];
	return {
		kind: "session-incompatible",
		status: "not-representable",
		sourcePath,
		errorCode: classifyImportFailure(error),
		...(error.analysis.sourceVersion === undefined ? {} : { sourceVersion: error.analysis.sourceVersion }),
		...(firstIssue ? { issueCode: firstIssue.code, issueCount: error.analysis.issues.length } : {}),
	};
}

function classifyImportFailure(error: LegacySessionImportError): CodingAgentLegacySessionIncompatibilityCode {
	if (
		(error.analysis.sourceVersion !== undefined && error.analysis.sourceVersion > 3) ||
		error.analysis.issues.some((issue) => issue.code === "unsupported-record")
	) {
		return "session_version_unsupported";
	}
	if (error.analysis.issues.some((issue) => issue.code === "invalid-payload")) return "session_incompatible";
	return "session_corrupt";
}

function deterministicTargetSessionId(sourcePath: string, sourceContent: Uint8Array): string {
	const digest = createHash("sha256").update(sourcePath).update("\0").update(sourceContent).digest("base64url");
	return `legacy-import-${digest}`;
}

function isNotRepresentable(error: unknown): error is ConversationStorageError {
	return (
		error instanceof ConversationStorageError &&
		(error.code === CONVERSATION_STORAGE_ERROR_CODES.CORRUPT ||
			error.code === CONVERSATION_STORAGE_ERROR_CODES.INVALID_EVENT ||
			error.code === CONVERSATION_STORAGE_ERROR_CODES.INVALID_COMMAND)
	);
}

function isTargetConflict(error: unknown): boolean {
	return error instanceof ConversationStorageError && error.code === CONVERSATION_STORAGE_ERROR_CODES.ALREADY_EXISTS;
}
