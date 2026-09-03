import { join } from "node:path";
import { parseTeamSessionDocument, type TeamSessionDocument } from "@vetta/agent-team";
import { createVersionedJsonConfigStore } from "@vetta/toolkit/config-store";
import { getAppLogger } from "../logger.js";
import { LEGACY_TEAM_SESSION_ROOT, listLegacyTeamSessionDocuments } from "./team-session-legacy-source.js";

// Compatibility input only. New Team sessions persist state in their ordinary
// coordination Conversation and never write this product-specific directory.
const log = getAppLogger("agent-team-session-storage");

export interface LegacyTeamSessionRepository {
	read(id: string): Promise<TeamSessionDocument>;
	/** Enumerates migration inputs so ownership can be backfilled before a legacy session is reopened. */
	list?(): Promise<readonly TeamSessionDocument[]>;
}

export function createLegacyTeamSessionRepository(
	rootDirectory = LEGACY_TEAM_SESSION_ROOT,
): LegacyTeamSessionRepository {
	function store(id: string) {
		return createVersionedJsonConfigStore<TeamSessionDocument>({
			path: join(rootDirectory, `${id}.json`),
			name: `agent-team-session-${id}`,
			readErrorPolicy: "throw",
			normalize: parseTeamSessionDocument,
			logger: log,
		});
	}

	async function list(): Promise<readonly TeamSessionDocument[]> {
		return listLegacyTeamSessionDocuments(rootDirectory, (teamSessionId, error) => {
			log.warn("ignored invalid legacy team session while enumerating", {
				teamSessionId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}

	return { read: (id) => store(id).read(), list };
}

export const legacyTeamSessionRepository = createLegacyTeamSessionRepository();
