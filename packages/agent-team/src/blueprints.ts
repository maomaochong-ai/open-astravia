import type { AgentBlueprint } from "./contracts.js";

/** 插件 blueprint 的全局 id 前缀。 */
const PLUGIN_BLUEPRINT_PREFIX = "plugin:";

/** 把插件内的智能体 id 拼成全局唯一的 blueprint id。 */
export function pluginBlueprintId(pluginId: string, agentId: string): string {
	return `${PLUGIN_BLUEPRINT_PREFIX}${pluginId}:${agentId}`;
}

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

/**
 * 宿主不再自带任何人设。
 *
 * 所有预设智能体都由扩展提供、随扩展维护；这里只剩 id 的形状约定，解析交给宿主的注册表
 * （见 desktop 的 agent-blueprint-registry）。留下这个空数组是为了让「宿主内置人设」这件事
 * 有一处明确的否定，而不是散落在各调用点靠注释说明。
 */
export const BUILTIN_AGENT_BLUEPRINTS: readonly AgentBlueprint[] = Object.freeze([]);
