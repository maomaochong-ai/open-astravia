export { LegacyRuntimeSessionCatalog } from "./catalog.js";
export {
	CODING_AGENT_LEGACY_AGENT_MESSAGE_CONTEXT_TYPE,
	normalizeCodingAgentLegacySessionEntry,
	restoreCodingAgentSessionAgentMessageEntry as restoreCodingAgentLegacyAgentMessageEntry,
} from "./entry-normalizer.js";
export { LegacyRuntimeSessionFileHistoryReader } from "./history-reader.js";
export type {
	LegacySessionFileHost,
	LegacySessionFormatLeaseResult,
	LegacySessionMigrationHost,
} from "./host-contracts.js";
export {
	type CodingAgentLegacySessionIncompatibilityCode,
	type CodingAgentLegacySessionMigration,
	type CodingAgentLegacySessionMigrationIncompatible,
	type CodingAgentLegacySessionMigrationSuccess,
	migrateCodingAgentLegacySession,
} from "./migration.js";
