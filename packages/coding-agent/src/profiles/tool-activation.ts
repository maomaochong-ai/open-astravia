import type { ConversationScenario, ToolActivationMetadata } from "./contracts.js";

/**
 * 工具激活只看 scope_use（会话场景）∩ requires（能力槽）两条 fail-closed 轴。
 *
 * 工作模式（agent_mode）不参与激活也不参与排序（ADR-0071）：模式是任务解释的先验，
 * 由 mode 系统提示词、工作区事实与工具自描述在提示词层承担，能力清单在任何模式下
 * 完全一致，顺序即注册序，天然稳定、不抖动 system prompt 前缀缓存。
 */
export function resolveActiveToolNames(
	scenario: ConversationScenario,
	tools: readonly ToolActivationMetadata[],
	capabilities: ReadonlySet<string>,
): string[] {
	const active: string[] = [];
	for (const tool of tools) {
		if (!tool.scope_use || !tool.scope_use.includes(scenario)) continue;
		if (tool.requires && !tool.requires.every((capability) => capabilities.has(capability))) continue;
		active.push(tool.name);
	}
	return active;
}
