import { defineSessionExtensionEndpoint } from "@vetta/runtime-core/session-extensions";
import type { ConversationScenario } from "../../profiles/index.js";

export const CODING_AGENT_SESSION_PROFILE_STATE_EXTENSION_ID = "coding-agent.session-profile-state";

export interface CodingAgentSessionProfileState {
	readonly scenario: ConversationScenario;
	readonly agentMode: string | undefined;
}

/** 应用宿主读取 Coding Agent Session 展示状态；Runtime 只承载 typed endpoint。 */
export const CODING_AGENT_SESSION_PROFILE_STATE_READ = defineSessionExtensionEndpoint<
	undefined,
	CodingAgentSessionProfileState
>(CODING_AGENT_SESSION_PROFILE_STATE_EXTENSION_ID, "read");

/** Coding Agent SDK 更新工作模式；不进入 Runtime 配置控制面。 */
export const CODING_AGENT_SESSION_AGENT_MODE_SET = defineSessionExtensionEndpoint<
	{ readonly agentMode: string | undefined },
	void
>(CODING_AGENT_SESSION_PROFILE_STATE_EXTENSION_ID, "set-agent-mode");
