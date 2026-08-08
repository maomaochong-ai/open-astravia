import { join } from "node:path";
import { getAgentDir } from "../config.js";
import { FileMcpToolResultArtifactStore } from "../mcp/runtime/file-result-artifact-store.js";
import { FileCodingToolResultArtifactStore } from "./file-result-artifact-store.js";

export interface CodingAgentSessionArtifactCleaner {
	deleteSessionArtifacts(sessionId: string): Promise<void>;
}

export function createCodingAgentSessionArtifactCleaner(agentDir = getAgentDir()): CodingAgentSessionArtifactCleaner {
	const codingResults = new FileCodingToolResultArtifactStore(join(agentDir, "tool-results"));
	const mcpResults = new FileMcpToolResultArtifactStore(join(agentDir, "mcp-results"));
	return {
		async deleteSessionArtifacts(sessionId) {
			await Promise.all([
				codingResults.deleteSessionArtifacts(sessionId),
				mcpResults.deleteSessionArtifacts(sessionId),
			]);
		},
	};
}
