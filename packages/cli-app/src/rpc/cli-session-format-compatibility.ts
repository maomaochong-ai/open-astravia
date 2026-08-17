import { join } from "node:path";
import { createCodingAgentHistoricalSessionCatalog } from "@vetta/coding-agent/historical-sessions";
import { CompositeRuntimeSessionCatalog, type RuntimeSessionCatalog } from "@vetta/runtime-core";
import { FileConversationRuntimeSessionCatalog } from "@vetta/runtime-node/conversation";
import { createNodeResultArtifactStorage } from "@vetta/runtime-node/host";

export interface CliRuntimeSessionCatalogOptions {
	readonly cwd: string;
	readonly sessionDir: string;
	readonly agentDir: string;
}

/** CLI 会话选择使用的格式兼容组合；不创建或恢复活动 Session。 */
export function createCliRuntimeSessionCatalog(options: CliRuntimeSessionCatalogOptions): RuntimeSessionCatalog {
	const resultArtifacts = createNodeResultArtifactStorage({
		codingRoot: join(options.agentDir, "tool-results"),
		mcpRoot: join(options.agentDir, "mcp-results"),
	});
	return new CompositeRuntimeSessionCatalog([
		createCodingAgentHistoricalSessionCatalog(),
		new FileConversationRuntimeSessionCatalog({
			roots: [{ cwd: options.cwd, sessionDir: options.sessionDir }],
			artifactCleaner: resultArtifacts.cleaner,
		}),
	]);
}
