import { defineSessionExtensionEndpoint } from "@vetta/runtime-core/session-extensions";
import type { AgentPluginRuntimeConfig } from "../../model-context/plugin-runtime.js";

export const CODING_AGENT_PLUGIN_CONFIGURATION_EXTENSION_ID = "coding-agent.plugin-configuration";

/** 重新读取宿主持有的 Plugin Runtime Source，并在安全的 Turn 边界应用。 */
export const CODING_AGENT_PLUGIN_CONFIGURATION_REFRESH = defineSessionExtensionEndpoint<undefined, void>(
	CODING_AGENT_PLUGIN_CONFIGURATION_EXTENSION_ID,
	"refresh",
);

/** 为单个 Session 发布 Plugin 配置覆盖；供 SDK 等产品宿主使用。 */
export const CODING_AGENT_PLUGIN_CONFIGURATION_APPLY = defineSessionExtensionEndpoint<
	{ readonly agentPlugins: AgentPluginRuntimeConfig | undefined },
	void
>(CODING_AGENT_PLUGIN_CONFIGURATION_EXTENSION_ID, "apply");
