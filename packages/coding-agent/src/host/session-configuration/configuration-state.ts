import type { AgentPluginRuntimeConfig, RuntimeSessionConfigurationController } from "@vetta/runtime-core";
import type { AgentSession } from "@vetta/runtime-core/kernel";

export interface CodingAgentPluginReconfiguration {
	reconfigureAgentPlugins(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<void>;
}

export interface CodingAgentSessionConfigurationRevision {
	readonly revision: number;
	readonly agentMode: string | undefined;
	readonly agentPlugins: AgentPluginRuntimeConfig | undefined;
	readonly activeToolNamesOverride: readonly string[] | undefined;
}

/** Session-local 配置发布器；写入发布新版本，Turn admission 只消费不可变副本。 */
export class CodingAgentSessionConfigurationState {
	private revision = 0;
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

	captureRevision(): CodingAgentSessionConfigurationRevision {
		return Object.freeze({
			revision: this.revision,
			agentMode: this.agentMode,
			agentPlugins: cloneAndFreeze(this.readAgentPlugins()),
			activeToolNamesOverride: this.activeToolNamesOverride
				? Object.freeze([...this.activeToolNamesOverride])
				: undefined,
		});
	}

	setActiveToolNamesOverride(toolNames: readonly string[]): void {
		const next = [...new Set(toolNames)];
		if (sameStrings(this.activeToolNamesOverride, next)) return;
		this.activeToolNamesOverride = next;
		this.revision += 1;
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
				this.revision += 1;
			},
			// 只剩 SDK 宿主（sdk-session）这一条调用路径：Desktop 的工作模式在会话创建时
			// 固化、会话内不可变，Runtime Host 已不再向活跃会话推送模式。
			setAgentMode: (mode) => {
				if (this.agentMode === mode) return;
				this.agentMode = mode;
				this.revision += 1;
			},
		};
	}
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[]): boolean {
	return left?.length === right.length && left.every((value, index) => value === right[index]);
}

function cloneAndFreeze<T>(value: T): T {
	if (value === undefined) return value;
	return deepFreeze(structuredClone(value), new WeakSet<object>());
}

function deepFreeze<T>(value: T, seen: WeakSet<object>): T {
	if (typeof value !== "object" || value === null || seen.has(value)) return value;
	seen.add(value);
	for (const child of Object.values(value)) deepFreeze(child, seen);
	return Object.freeze(value);
}
