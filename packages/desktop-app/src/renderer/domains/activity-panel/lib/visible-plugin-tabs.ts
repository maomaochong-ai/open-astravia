import type { RegisteredActivityTab, RegisteredInputAction } from "@shared/store/atoms";
import type { ConversationScenario } from "@vetta-org/plugin-sdk";

/**
 * 硬隔离（ADR-0041）当前处于「关」的插件 id：注册了 hardIsolation 的输入栏 toggle
 * 且该 toggle 未激活。这些插件的活动面板标签卡本轮不显示。
 */
export function hardIsolationOffPluginIds(
	inputActions: readonly RegisteredInputAction[],
	activeInputActionIds: ReadonlySet<string>,
): Set<string> {
	const off = new Set<string>();
	for (const action of inputActions) {
		if (action.hardIsolation && !activeInputActionIds.has(action.actionId)) {
			off.add(action.pluginId);
		}
	}
	return off;
}

/**
 * 当前会话下应渲染为活动面板标签卡的插件 contribution。
 *
 * 插件面板**全部常驻**：可见性只由 scope_use（fail-closed）与硬隔离开关决定，
 * 不需要的由用户用减号隐藏（走 hiddenActivityTabsAtom）。不要再引入 attach 记录
 * 过滤——"+"下拉里没有 attach 入口，一旦过滤，插件 tab 只能靠 openActivityTab
 * 出现，git 面板 / 插件工作台这类自注册标签卡会永久消失。
 */
export function selectVisiblePluginTabs(params: {
	enabled: boolean;
	tabs: readonly RegisteredActivityTab[];
	scenario: ConversationScenario | null;
	isolationOffPluginIds: ReadonlySet<string>;
}): RegisteredActivityTab[] {
	const { enabled, tabs, scenario, isolationOffPluginIds } = params;
	if (!enabled || scenario === null) return [];
	return tabs.filter((tab) => tab.scope_use?.includes(scenario) && !isolationOffPluginIds.has(tab.pluginId));
}
