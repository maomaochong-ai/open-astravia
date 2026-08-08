import { createCodingAgentHistoricalSessionCatalog } from "@vetta/coding-agent/historical-sessions";
import { createCodingAgentSessionArtifactCleaner } from "@vetta/coding-agent/host-services";
import { CompositeRuntimeSessionCatalog, type RuntimeSessionCatalog } from "@vetta/runtime-core";
import { FileConversationRuntimeSessionCatalog } from "@vetta/runtime-storage/conversation";

export interface CliRuntimeSessionCatalogOptions {
	readonly cwd: string;
	readonly sessionDir: string;
	readonly agentDir: string;
}

/** CLI 会话选择使用的格式兼容组合；不创建或恢复活动 Session。 */
export function createCliRuntimeSessionCatalog(options: CliRuntimeSessionCatalogOptions): RuntimeSessionCatalog {
	return new CompositeRuntimeSessionCatalog([
		createCodingAgentHistoricalSessionCatalog(),
		new FileConversationRuntimeSessionCatalog({
			roots: [{ cwd: options.cwd, sessionDir: options.sessionDir }],
			artifactCleaner: createCodingAgentSessionArtifactCleaner(options.agentDir),
		}),
	]);
}
