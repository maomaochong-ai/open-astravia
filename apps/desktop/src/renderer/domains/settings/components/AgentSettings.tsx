import { AgentSettingsView } from "./AgentSettingsView";
import { useImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";
import { useAgentSettingsModel } from "./useAgentSettingsModel";
import { useRuntimeConfigurationModel } from "./useRuntimeConfigurationModel";

export function AgentSettings(): JSX.Element {
	return (
		<AgentSettingsView
			model={useAgentSettingsModel()}
			imageGeneration={useImageGenerationSettingsModel()}
			runtimeConfiguration={useRuntimeConfigurationModel()}
		/>
	);
}
