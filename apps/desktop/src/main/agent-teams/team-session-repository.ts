import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { parseTeamSessionDocument, type TeamSessionDocument } from "@vetta/agent-team";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import { createVersionedJsonConfigStore } from "@vetta/toolkit/config-store";
import { getAppLogger } from "../logger.js";

const DEFAULT_SESSION_ROOT = join(getVettaHomePath(), "desktop-app", "agent-teams", "sessions");
const log = getAppLogger("agent-team-session-storage");

export interface TeamSessionRepository {
	memberSessionDirectory(teamSessionId: string, memberId: string): string;
	read(id: string): Promise<TeamSessionDocument>;
	write(session: TeamSessionDocument): Promise<void>;
}

export function createTeamSessionRepository(rootDirectory = DEFAULT_SESSION_ROOT): TeamSessionRepository {
	function store(id: string) {
		return createVersionedJsonConfigStore<TeamSessionDocument>({
			path: join(rootDirectory, `${id}.json`),
			name: `agent-team-session-${id}`,
			readErrorPolicy: "throw",
			normalize: parseTeamSessionDocument,
			writeJson: atomicWriteJSONAsync,
			logger: log,
		});
	}

	return {
		memberSessionDirectory: (teamSessionId, memberId) => join(rootDirectory, teamSessionId, memberId),
		read: (id) => store(id).read(),
		write: (session) => store(session.id).write(session),
	};
}
