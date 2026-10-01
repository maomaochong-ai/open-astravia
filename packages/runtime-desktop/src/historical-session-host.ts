import { join } from "node:path";
import { getAgentDir } from "@astravia/coding-agent/config";
import { createNodeLegacySessionHost } from "@astravia/runtime-node/host";

export function createDesktopHistoricalSessionHost(defaultCwd = process.cwd()) {
	return createNodeLegacySessionHost({
		defaultCwd,
		sessionsDirectory: join(getAgentDir(), "sessions"),
	});
}
