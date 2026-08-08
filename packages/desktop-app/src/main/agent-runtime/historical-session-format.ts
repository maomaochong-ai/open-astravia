import {
	createCodingAgentHistoricalSessionCatalog,
	createCodingAgentHistoricalSessionFileHistoryReader,
} from "@vetta/coding-agent/historical-sessions";
import type { RuntimeSessionCatalog, RuntimeSessionFileHistoryReader } from "@vetta/runtime-core";

export interface DesktopHistoricalSessionFormat {
	readonly sessionCatalog: RuntimeSessionCatalog;
	readonly sessionFileHistoryReader: RuntimeSessionFileHistoryReader;
}

/** 旧 JSONL 的发现、读取和文件生命周期兼容；不创建或持有 AgentSession。 */
export function createDesktopHistoricalSessionFormat(): DesktopHistoricalSessionFormat {
	return {
		sessionCatalog: createCodingAgentHistoricalSessionCatalog(),
		sessionFileHistoryReader: createCodingAgentHistoricalSessionFileHistoryReader(),
	};
}
