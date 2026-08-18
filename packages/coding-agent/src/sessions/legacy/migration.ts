import {
	CONVERSATION_STORAGE_ERROR_CODES,
	ConversationOwnershipConflictError,
	ConversationStorageError,
	LegacySessionImportError,
	type LegacySessionImportIssueCode,
} from "@vetta/runtime-storage/conversation";
import { normalizeCodingAgentLegacySessionEntry } from "./entry-normalizer.js";
import type { LegacySessionMigrationHost } from "./host-contracts.js";

export type CodingAgentLegacySessionIncompatibilityCode =
	| "session_corrupt"
	| "session_incompatible"
	| "session_version_unsupported";

export interface CodingAgentLegacySessionMigrationSuccess {
	/** Stable public migration-result discriminant; it is not a Runtime backend selector. */
	readonly kind: "greenfield";
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
	host: LegacySessionMigrationHost,
): Promise<CodingAgentLegacySessionMigration> {
	const canonicalSourcePath = await host.canonicalize(sourcePath);
	const lease = host.acquireLease(canonicalSourcePath);
	if (lease.kind === "locked") {
		throw new ConversationOwnershipConflictError(canonicalSourcePath, lease.lockPath, {
			token: "legacy-session-lock",
			pid: lease.holder.pid,
			hostname: lease.holder.hostname,
			acquiredAt: lease.holder.openedAt,
		});
	}

	try {
		const sourceContent = await host.readBytes(canonicalSourcePath);
		const targetSessionId = `legacy-import-${host.digest([canonicalSourcePath, sourceContent])}`;
		try {
			const result = await migrateWithConflictRecovery(host, canonicalSourcePath, targetRootDir, targetSessionId);
			return {
				kind: "greenfield",
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

async function migrateWithConflictRecovery(
	host: LegacySessionMigrationHost,
	sourcePath: string,
	targetRootDir: string,
	targetSessionId: string,
) {
	try {
		return await migrateToTarget(host, sourcePath, targetRootDir, targetSessionId);
	} catch (error) {
		if (!isTargetConflict(error)) throw error;
		return migrateToTarget(host, sourcePath, targetRootDir, `${targetSessionId}-recovery`);
	}
}

function migrateToTarget(
	host: LegacySessionMigrationHost,
	sourcePath: string,
	targetRootDir: string,
	targetSessionId: string,
) {
	return host.migrate({
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
