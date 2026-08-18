import type { RuntimeSessionCatalog, RuntimeSessionFileHistoryReader } from "@vetta/runtime-core";
import { LegacyRuntimeSessionCatalog } from "../sessions/legacy/catalog.js";
import { parseCodingAgentLegacySessionDocument } from "../sessions/legacy/document.js";
import { LegacyRuntimeSessionFileHistoryReader } from "../sessions/legacy/history-reader.js";
import type { LegacySessionFileHost, LegacySessionMigrationHost } from "../sessions/legacy/host-contracts.js";
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

export type CodingAgentHistoricalSessionFileHost = LegacySessionFileHost;
export type CodingAgentHistoricalSessionMigrationHost = LegacySessionMigrationHost;

export function createCodingAgentHistoricalSessionCatalog(host: LegacySessionFileHost): RuntimeSessionCatalog {
	return new LegacyRuntimeSessionCatalog(host);
}

export function createCodingAgentHistoricalSessionFileHistoryReader(
	host: LegacySessionFileHost,
): RuntimeSessionFileHistoryReader {
	return new LegacyRuntimeSessionFileHistoryReader(host);
}

/** Pure Coding Agent compatibility parser; platform hosts own reading the source file. */
export const parseCodingAgentHistoricalSessionDocument = parseCodingAgentLegacySessionDocument;

export function migrateCodingAgentHistoricalSession(
	sourcePath: string,
	targetRootDir: string,
	host: LegacySessionMigrationHost,
): Promise<CodingAgentHistoricalSessionMigration> {
	return migrateCodingAgentLegacySession(sourcePath, targetRootDir, host);
}
