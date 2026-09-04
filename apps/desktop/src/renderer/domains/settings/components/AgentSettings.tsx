import { AgentSettingsView } from "./AgentSettingsView";
import { useAgentSettingsModel } from "./useAgentSettingsModel";
import { useRuntimeConfigurationModel } from "./useRuntimeConfigurationModel";

export function AgentSettings(): JSX.Element {
	return <AgentSettingsView model={useAgentSettingsModel()} runtimeConfiguration={useRuntimeConfigurationModel()} />;
}
