import type { ConversationScenario, ToolActivationMetadata } from "./contracts.js";

/**
 * agent_mode 是否把该条目视为「本模式主推」。
 *
 * 注意语义：这里返回 false **不代表排除**。agent_mode 自 2026-08 起是纯软引导轴，
 * 只影响工具 / skill / MCP 在清单中的先后顺序与详略，不再作为 fail-closed 过滤条件。
 * 真正的硬闸只有 scope_use 与 requires 两轴。
 *
 * 未声明或声明为空数组 = 通用条目，视为主推（不降权）。
 */
export function matchesAgentMode(declared: readonly string[] | undefined, mode: string | undefined): boolean {
	if (mode === undefined || !declared || declared.length === 0) return true;
	return declared.includes(mode);
}

/** agent_mode 排序权重：0 = 本模式主推或通用；1 = 只为其他模式声明（降权排到末尾，但仍然可用）。 */
export function agentModePreferenceRank(declared: readonly string[] | undefined, mode: string | undefined): 0 | 1 {
	return matchesAgentMode(declared, mode) ? 0 : 1;
}

/**
 * 按 agent_mode 偏好稳定重排：主推条目在前、非主推条目在后，两个桶内部严格保持输入顺序。
 *
 * 稳定性是硬要求 —— 工具与 skill 清单直接进 system prompt 前缀，顺序抖动会击穿 prompt 缓存。
 */
export function sortByAgentModePreference<T>(
	items: readonly T[],
	mode: string | undefined,
	getDeclaredModes: (item: T) => readonly string[] | undefined,
): T[] {
	const preferred: T[] = [];
	const deprioritized: T[] = [];
	for (const item of items) {
		if (agentModePreferenceRank(getDeclaredModes(item), mode) === 0) preferred.push(item);
		else deprioritized.push(item);
	}
	return deprioritized.length === 0 ? [...items] : [...preferred, ...deprioritized];
}

export function resolveActiveToolNames(
	scenario: ConversationScenario,
	tools: readonly ToolActivationMetadata[],
	capabilities: ReadonlySet<string>,
	mode?: string,
): string[] {
	const active: ToolActivationMetadata[] = [];
	for (const tool of tools) {
		// scope_use 与 requires 是真正的 fail-closed 轴，保持不变。
		if (!tool.scope_use || !tool.scope_use.includes(scenario)) continue;
		if (tool.requires && !tool.requires.every((capability) => capabilities.has(capability))) continue;
		// agent_mode 不再参与过滤：非本模式主推的工具只被排到末尾。
		active.push(tool);
	}
	return sortByAgentModePreference(active, mode, (tool) => tool.agent_mode).map((tool) => tool.name);
}
