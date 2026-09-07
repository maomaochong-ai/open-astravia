import type { CSSProperties } from "react";

/**
 * 头像底座预设：顶部高饱和 -> 底部白色。色值定义在宿主样式表的
 * `--agent-tint-*`（单一事实源），这里只负责按 Agent 身份稳定挑一档，
 * 让同一支编队里的成员在头像组中互相区分。
 */
export const AGENT_TINT_PRESETS = ["coral", "amber", "citrus", "mint", "teal", "sky", "violet", "magenta"] as const;

export type AgentTintPreset = (typeof AGENT_TINT_PRESETS)[number];

/** 按 Agent 身份稳定命中的底座预设。 */
export function agentTintPreset(seed: string): AgentTintPreset {
	return AGENT_TINT_PRESETS[stableIndex(seed, AGENT_TINT_PRESETS.length)] ?? "coral";
}

/** 预设 id 的持久化前缀；自定义纯色直接存 `#rrggbb`。 */
export const AGENT_TINT_PREFIX = "tint:";

export function agentTintValue(preset: AgentTintPreset): string {
	return `${AGENT_TINT_PREFIX}${preset}`;
}

/**
 * 解析 Agent 档案里存的底座：`tint:<preset>` 用预设渐变，`#rrggbb` 用自定义纯色，
 * 都没有就按身份稳定分配一档预设。
 */
export function agentAvatarBackgroundStyle(background: string | undefined, seed: string): CSSProperties {
	if (background?.startsWith(AGENT_TINT_PREFIX)) {
		const preset = background.slice(AGENT_TINT_PREFIX.length) as AgentTintPreset;
		if (AGENT_TINT_PRESETS.includes(preset)) return agentTintPresetStyle(preset);
	}
	if (background) return { backgroundColor: background };
	return agentTintStyle(seed);
}

/** 头像底座渐变，直接作为 `style` 挂到圆形容器上。 */
export function agentTintStyle(seed: string): CSSProperties {
	return agentTintPresetStyle(agentTintPreset(seed));
}

export function agentTintPresetStyle(preset: AgentTintPreset): CSSProperties {
	return {
		backgroundImage: `linear-gradient(to bottom, var(--agent-tint-${preset}), var(--agent-tint-base))`,
	};
}

function stableIndex(value: string, buckets: number): number {
	let hash = 0;
	for (const character of value) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
	return hash % buckets;
}
