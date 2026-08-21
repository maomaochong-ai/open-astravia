import type { PluginContext, PluginDynamicSystemPromptOperation } from "@vetta-org/plugin-sdk";
import { getCanvasController } from "../canvas/design-runtime";
import { SCREENSHOT_TOOL_NAME } from "../cards/screenshot-card";
import { hasDesignInWorkspace } from "./design-presence";

/**
 * 只有在一份 `.vetd` 设计的语境里才成立的工具。
 *
 * `vetd_create` 不在其中：它是进入这个语境的入口，任何会话都得看得见。
 */
export const DESIGN_ONLY_TOOLS = [
	SCREENSHOT_TOOL_NAME,
	"vetd_status",
	"vetd_install",
	"vetd_notes",
	"vetd_history",
	"vetd_restore",
] as const;

/** 这一轮该不该开闸：画布开着，或者 cwd 里确实有设计稿。 */
export async function designToolsActive(ctx: Pick<PluginContext, "fs">, cwd: string): Promise<boolean> {
	if (getCanvasController()) return true;
	return await hasDesignInWorkspace(ctx.fs, cwd);
}

/**
 * 设计工具的可见性闸门。
 *
 * 这些工具的描述里都写了反向触发段，但描述只是软约束：`vetd_notes` 尤其容易被
 * skill 里「收尾再查一次备注」的收口规则带出来，于是用户在普通代码仓库里改前端页面，
 * 每一轮结尾都会多一次注定报错的调用。工具表本身才是硬边界——没有设计稿的会话里
 * 让它们根本不出现，比再写一遍「不要在这种情况下调用」有效。
 *
 * 每轮都显式给出两个方向的开关：效果在一个 turn 内是累积重放的，同一轮里
 * `vetd_create` 刚建完设计时，必须靠下一次 enable 把先前的 disable 顶掉。
 */
export function registerToolGate(ctx: PluginContext): void {
	ctx.agent.registerSystemPromptProvider({
		id: "vetd-tool-gate",
		handler: async ({ session }): Promise<PluginDynamicSystemPromptOperation[]> => {
			const enabled = await designToolsActive(ctx, session.cwd);
			return DESIGN_ONLY_TOOLS.map((toolName) => ({ type: "setToolEnabled", toolName, enabled }));
		},
	});
}
