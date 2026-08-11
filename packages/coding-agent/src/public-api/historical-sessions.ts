import type { RuntimeSessionCatalog, RuntimeSessionFileHistoryReader } from "@vetta/runtime-core";
import { LegacyRuntimeSessionCatalog } from "../sessions/legacy/catalog.js";
import { LegacyRuntimeSessionFileHistoryReader } from "../sessions/legacy/history-reader.js";
import {
	type CodingAgentLegacySessionIncompatibilityCode,
	type CodingAgentLegacySessionMigration,
	type CodingAgentLegacySessionMigrationIncompatible,
	type CodingAgentLegacySessionMigrationSuccess,
	migrateCodingAgentLegacySession,
} from "../sessions/legacy/migration.js";

export type CodingAgentHistoricalSessionIncompatibilityCode = CodingAgentLegacySessionIncompatibilityCode;
export type CodingAgentHistoricalSessionMigration = CodingAgentLegacySessionMigration;
export type CodingAgentHistoricalSessionMigrationIncompatible = CodingAgentLegacySessionMigrationIncompatible;
export type CodingAgentHistoricalSessionMigrationSuccess = CodingAgentLegacySessionMigrationSuccess;

export function createCodingAgentHistoricalSessionCatalog(): RuntimeSessionCatalog {
	return new LegacyRuntimeSessionCatalog();
}

export function createCodingAgentHistoricalSessionFileHistoryReader(): RuntimeSessionFileHistoryReader {
	return new LegacyRuntimeSessionFileHistoryReader();
}

export function migrateCodingAgentHistoricalSession(
	sourcePath: string,
	targetRootDir: string,
): Promise<CodingAgentHistoricalSessionMigration> {
	return migrateCodingAgentLegacySession(sourcePath, targetRootDir);
}
