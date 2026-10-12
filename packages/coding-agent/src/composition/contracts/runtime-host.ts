import type { Transport } from "@vetta/ai";
import type { CodingAgentTurnRetrySettings } from "../../execution/turn/contracts.js";

/** Coding Agent 产品重试策略的动态设置端口。 */
export interface CodingAgentRuntimeHostRetrySettings {
	getRetrySettings(): CodingAgentTurnRetrySettings;
	setRetryEnabled(enabled: boolean): void;
}

/** 每次模型请求动态读取 transport，设置修改后无需重建 Session。 */
export interface CodingAgentRuntimeHostModelSettings {
	getTransport(): Transport;
}
