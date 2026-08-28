import type { RuntimeSessionConfigurationController } from "@vetta/runtime-core";
import type { AgentSession } from "@vetta/runtime-core/kernel";
import type { AgentPluginRuntimeConfig } from "../../model-context/plugin-runtime.js";

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
		private readonly readBasePlugins: () => AgentPluginRuntimeConfig | undefined,
	) {
		this.agentMode = initialAgentMode;
	}

	readAgentMode(): string | undefined {
		return this.agentMode;
	}

	setAgentMode(mode: string | undefined): void {
		if (this.agentMode === mode) return;
		this.agentMode = mode;
		this.revision += 1;
	}

	readAgentPlugins(): AgentPluginRuntimeConfig | undefined {
		return this.hasPluginOverride ? this.pluginOverride : this.readBasePlugins();
	}

	readBaseAgentPlugins(): AgentPluginRuntimeConfig | undefined {
		return this.readBasePlugins();
	}

	hasAgentPluginOverride(): boolean {
		return this.hasPluginOverride;
	}

	setAgentPluginOverride(agentPlugins: AgentPluginRuntimeConfig | undefined): void {
		this.pluginOverride = agentPlugins;
		this.hasPluginOverride = true;
		this.revision += 1;
	}

	publishBaseAgentPluginRevision(): void {
		if (this.hasPluginOverride) return;
		this.revision += 1;
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

	createController(session: AgentSession): RuntimeSessionConfigurationController {
		return {
			setSteeringMode: (mode) => session.setSteeringMode(mode),
			setFollowUpMode: (mode) => session.setFollowUpMode(mode),
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
