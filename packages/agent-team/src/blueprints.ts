import type { AgentBlueprint } from "./contracts.js";

/** 每个 Worker 蓝图都要复述的协作纪律，避免下属之间私下转交 Team 任务归属。 */
const WORKER_DISCIPLINE =
	" Do not transfer Team task ownership: report to the Master and use Team communication only when required information is missing.";

export const BUILTIN_AGENT_BLUEPRINTS: readonly AgentBlueprint[] = Object.freeze([
	{
		id: "architect",
		nameKey: "blueprints.architect.name",
		descriptionKey: "blueprints.architect.description",
		systemPrompt:
			"You are the design specialist in an agent team. Turn the goal into a concrete plan before anyone builds: technical architecture, interface and data contracts, or the outline of a document, PRD, or business model. State the trade-offs you weighed and the constraints the executor must respect, and keep the plan specific enough to act on without further guesswork." +
			WORKER_DISCIPLINE,
		defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	},
	{
		id: "auditor",
		nameKey: "blueprints.auditor.name",
		descriptionKey: "blueprints.auditor.description",
		systemPrompt:
			"You are the audit specialist in an agent team. Attack the work adversarially: check correctness, safety, edge cases, regressions, unsupported claims, and missing verification. Prefer concrete reproducible findings over general concerns, rank them by severity, and state plainly whether the work passes or must go back for rework." +
			WORKER_DISCIPLINE,
		defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	},
	{
		id: "optimizer",
		nameKey: "blueprints.optimizer.name",
		descriptionKey: "blueprints.optimizer.description",
		systemPrompt:
			"You are the refinement specialist in an agent team. Take work that already functions and make it better: refactor for performance and maintainability, or adapt a draft into the voice and format a specific channel or audience expects. Preserve the original meaning and behaviour, and report what you changed and why." +
			WORKER_DISCIPLINE,
		defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	},
	{
		id: "synthesizer",
		nameKey: "blueprints.synthesizer.name",
		descriptionKey: "blueprints.synthesizer.description",
		systemPrompt:
			"You are the packaging specialist in an agent team. Merge results from several members into one coherent deliverable: reconcile overlaps, resolve contradictions by flagging them rather than silently picking a side, apply a consistent structure and format, and hand back a report or bundle that is ready to ship." +
			WORKER_DISCIPLINE,
		defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	},
	{
		id: "translator",
		nameKey: "blueprints.translator.name",
		descriptionKey: "blueprints.translator.description",
		systemPrompt:
			"You are the conversion specialist in an agent team. Move content across languages and registers: localize while keeping tone and intent, turn code or technical detail into prose a reader can follow, and restate specialist terminology in business language. Keep terminology consistent and never invent facts that the source does not contain." +
			WORKER_DISCIPLINE,
		defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	},
]);

/**
 * 改版前的蓝图 id 仍写在用户已落盘的 Agent 档案里。
 * 解析时要认得它们，否则老配置会因为「Unknown agent blueprint」整份读不出来。
 */
const LEGACY_BLUEPRINT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
	reviewer: "auditor",
});

/** 插件 blueprint 的全局 id 前缀。宿主内置的 id 一律不带前缀，两者不会撞。 */
const PLUGIN_BLUEPRINT_PREFIX = "plugin:";

/** 把插件内的智能体 id 拼成全局唯一的 blueprint id。 */
export function pluginBlueprintId(pluginId: string, agentId: string): string {
	return `${PLUGIN_BLUEPRINT_PREFIX}${pluginId}:${agentId}`;
}

/** 「预设智能体」插件的 id：master / developer / researcher 三个通用人设由它提供。 */
export const PRESET_AGENT_PLUGIN_ID = "preset-agent";

/**
 * 已经从内置蓝图迁到「预设智能体」插件的角色，按存量 id 索引到插件蓝图 id。
 *
 * 迁移刻意不改用户档案：老档案里写的仍是 `master` / `executor`（以及更早的 `leader` /
 * `builder` 别名），解析时统一折算过去，插件在位就照常可用，插件禁用才降级。
 */
export const MIGRATED_PLUGIN_BLUEPRINT_IDS: Readonly<Record<string, string>> = Object.freeze({
	master: pluginBlueprintId(PRESET_AGENT_PLUGIN_ID, "master"),
	leader: pluginBlueprintId(PRESET_AGENT_PLUGIN_ID, "master"),
	executor: pluginBlueprintId(PRESET_AGENT_PLUGIN_ID, "developer"),
	builder: pluginBlueprintId(PRESET_AGENT_PLUGIN_ID, "developer"),
	researcher: pluginBlueprintId(PRESET_AGENT_PLUGIN_ID, "researcher"),
});

/** 解析插件 blueprint id；不是插件 id 时返回 undefined。 */
export function parsePluginBlueprintId(
	id: string,
): { readonly pluginId: string; readonly agentId: string } | undefined {
	if (!id.startsWith(PLUGIN_BLUEPRINT_PREFIX)) return undefined;
	const rest = id.slice(PLUGIN_BLUEPRINT_PREFIX.length);
	const separator = rest.lastIndexOf(":");
	if (separator <= 0 || separator === rest.length - 1) return undefined;
	return { pluginId: rest.slice(0, separator), agentId: rest.slice(separator + 1) };
}

/** 只查内置 blueprint。插件贡献的那些由宿主的注册表解析（见 desktop 的 agent-blueprint-registry）。 */
export function findAgentBlueprint(id: string): AgentBlueprint | undefined {
	const resolved = LEGACY_BLUEPRINT_ALIASES[id] ?? id;
	return BUILTIN_AGENT_BLUEPRINTS.find((blueprint) => blueprint.id === resolved);
}
