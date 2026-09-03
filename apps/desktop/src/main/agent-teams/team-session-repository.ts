import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { parseTeamSessionDocument, type TeamSessionDocument } from "@vetta/agent-team";
import { createVersionedJsonConfigStore } from "@vetta/toolkit/config-store";
import { getAppLogger } from "../logger.js";

// Compatibility input only. New Team sessions persist state in their ordinary
// coordination Conversation and never write this product-specific directory.
const LEGACY_SESSION_ROOT = join(getVettaHomePath(), "desktop-app", "agent-teams", "sessions");
const log = getAppLogger("agent-team-session-storage");

export interface LegacyTeamSessionRepository {
	read(id: string): Promise<TeamSessionDocument>;
}

export function createLegacyTeamSessionRepository(rootDirectory = LEGACY_SESSION_ROOT): LegacyTeamSessionRepository {
	function store(id: string) {
		return createVersionedJsonConfigStore<TeamSessionDocument>({
			path: join(rootDirectory, `${id}.json`),
			name: `agent-team-session-${id}`,
			readErrorPolicy: "throw",
			normalize: parseTeamSessionDocument,
			logger: log,
		});
	}

	return { read: (id) => store(id).read() };
}
