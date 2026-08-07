import type { AgentPluginRuntimeConfig, RuntimeSessionConfigurationController } from "@vetta/runtime-core";
import type { AgentSession } from "@vetta/runtime-core/kernel";

export interface CodingAgentPluginReconfiguration {
	reconfigureAgentPlugins(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<void>;
}

/** Session-local 动态配置事实源；Prompt、Plugin 与宿主 Controller 共享同一实例。 */
export class CodingAgentSessionConfigurationState {
	private agentMode: string | undefined;
	private pluginOverride: AgentPluginRuntimeConfig | undefined;
	private hasPluginOverride = false;
	private activeToolNamesOverride: readonly string[] | undefined;

	constructor(
		initialAgentMode: string | undefined,
		private readonly readBaseAgentPlugins: () => AgentPluginRuntimeConfig | undefined,
	) {
		this.agentMode = initialAgentMode;
	}

	readAgentMode(): string | undefined {
		return this.agentMode;
	}

	readAgentPlugins(): AgentPluginRuntimeConfig | undefined {
		return this.hasPluginOverride ? this.pluginOverride : this.readBaseAgentPlugins();
	}

	readActiveToolNamesOverride(): readonly string[] | undefined {
		return this.activeToolNamesOverride ? [...this.activeToolNamesOverride] : undefined;
	}

	setActiveToolNamesOverride(toolNames: readonly string[]): void {
		this.activeToolNamesOverride = [...new Set(toolNames)];
	}

	createController(
		session: AgentSession,
		pluginReconfiguration?: CodingAgentPluginReconfiguration,
	): RuntimeSessionConfigurationController {
		return {
			setSteeringMode: (mode) => session.setSteeringMode(mode),
			setFollowUpMode: (mode) => session.setFollowUpMode(mode),
			reconfigureAgentPlugins: async (agentPlugins) => {
				await pluginReconfiguration?.reconfigureAgentPlugins(agentPlugins);
				this.pluginOverride = agentPlugins;
				this.hasPluginOverride = true;
			},
			setAgentMode: (mode) => {
				this.agentMode = mode;
			},
		};
	}
}
