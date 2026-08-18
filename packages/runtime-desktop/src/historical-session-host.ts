import { join } from "node:path";
import { getAgentDir } from "@vetta/coding-agent/config";
import { createNodeLegacySessionHost } from "@vetta/runtime-node/host";

export function createDesktopHistoricalSessionHost(defaultCwd = process.cwd()) {
	return createNodeLegacySessionHost({
		defaultCwd,
		sessionsDirectory: join(getAgentDir(), "sessions"),
	});
}
