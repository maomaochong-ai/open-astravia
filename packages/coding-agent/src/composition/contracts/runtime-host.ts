import type { CodingAgentTurnRetrySettings } from "../../execution/turn/contracts.js";

/** Coding Agent 产品重试策略的动态设置端口。 */
export interface CodingAgentRuntimeHostRetrySettings {
	getRetrySettings(): CodingAgentTurnRetrySettings;
	setRetryEnabled(enabled: boolean): void;
}
