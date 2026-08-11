import { join } from "node:path";
import { createMcpToolResultPolicy, type McpToolResultPolicy } from "@vetta/runtime-mcp";
import { getAgentDir } from "../../config.js";
import { FileMcpToolResultArtifactStore } from "./file-result-artifact-store.js";

export function createCodingAgentMcpToolResultPolicy(agentDir = getAgentDir()): McpToolResultPolicy {
	return createMcpToolResultPolicy({
		artifactStore: new FileMcpToolResultArtifactStore(join(agentDir, "mcp-results")),
	});
}
