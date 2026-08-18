import { AgentSettingsView } from "./AgentSettingsView";
import { useAgentSettingsModel } from "./useAgentSettingsModel";

export function AgentSettings(): JSX.Element {
	return <AgentSettingsView model={useAgentSettingsModel()} />;
}
