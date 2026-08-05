import type { CardDescriptor } from "@vetta-org/plugin-sdk";

/** Card type this plugin renders; the tool's descriptor and the renderer agree on it. */
export const DESIGN_SYSTEM_CARD_TYPE = "vetta-ui-design:design-system-picker";

export interface DesignSystemCardPayload {
	/** 要展示的体系 id 列表（agent 通过 present 参数挑出来的候选）。 */
	systems: string[];
	/** 是否显示「不使用模板」出口（新建场景给用户留退路）。 */
	allowSkip: boolean;
}

/**
 * 每次 present 调用一张新卡（key 带调用时间戳）：候选集是那一次推荐的语境，
 * 不同轮次的推荐不该互相顶掉。
 */
export function designSystemCardDescriptor(systems: string[], allowSkip: boolean): CardDescriptor {
	return {
		type: DESIGN_SYSTEM_CARD_TYPE,
		key: `design-systems-${Date.now()}`,
		payload: { systems, allowSkip } satisfies DesignSystemCardPayload,
	};
}
