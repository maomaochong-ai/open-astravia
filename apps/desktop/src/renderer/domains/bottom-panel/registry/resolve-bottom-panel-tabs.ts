import {
	type BottomPanelSessionState,
	type BottomPanelTabState,
	collectBottomPanelLeaves,
} from "@shared/store/bottom-panel-layout";
import type { BottomPanelTabViewModel } from "@vetta-org/theme-ui/bottom-panel";
import type { BottomPanelComponentDefinition, BottomPanelTabMeta } from "./types";

export interface ResolvedBottomPanelTab {
	readonly tabId: string;
	readonly definition: BottomPanelComponentDefinition;
	readonly view: BottomPanelTabViewModel;
}

export interface ResolveBottomPanelTabsInput {
	readonly tabs: readonly BottomPanelTabState[];
	readonly definitions: readonly BottomPanelComponentDefinition[];
	readonly metaById: Readonly<Record<string, BottomPanelTabMeta>>;
}

function toViewModel(
	tab: BottomPanelTabState,
	definition: BottomPanelComponentDefinition,
	meta: BottomPanelTabMeta | undefined,
): BottomPanelTabViewModel {
	const resolved = meta ?? definition.defaultMeta;
	return {
		tabId: tab.tabId,
		label: resolved.label || definition.defaultMeta.label,
		icon: resolved.icon ?? definition.defaultMeta.icon,
		status: resolved.status ?? "idle",
	};
}

/**
 * 把布局树里的 tab 解析成可渲染条目。
 *
 * 实例上报的 meta 优先于定义的默认 meta——两者是同一个字段的两个阶段，不是两份事实源。
 * 组件已经不存在的 tab（插件被卸载 / 禁用）直接跳过：`prune` 会把它从持久化里摘掉，
 * 但在那之前 UI 不能因为找不到定义就整块崩掉。
 */
export function resolveBottomPanelTabs({
	tabs,
	definitions,
	metaById,
}: ResolveBottomPanelTabsInput): ResolvedBottomPanelTab[] {
	const byId = new Map(definitions.map((definition) => [definition.id, definition]));
	const resolved: ResolvedBottomPanelTab[] = [];
	for (const tab of tabs) {
		const definition = byId.get(tab.componentId);
		if (!definition) continue;
		resolved.push({ tabId: tab.tabId, definition, view: toViewModel(tab, definition, metaById[tab.tabId]) });
	}
	return resolved;
}

/** 折叠态 pill：按树序把所有格子的 tab 平铺，与展开时的 tab 同一份 meta。 */
export function resolveBottomPanelPills(
	state: BottomPanelSessionState,
	definitions: readonly BottomPanelComponentDefinition[],
	metaById: Readonly<Record<string, BottomPanelTabMeta>>,
): BottomPanelTabViewModel[] {
	const tabs = collectBottomPanelLeaves(state.root).flatMap((leaf) => leaf.tabs);
	return resolveBottomPanelTabs({ tabs, definitions, metaById }).map((entry) => entry.view);
}

/** 某个组件在当前会话已经开了几个实例，用于 `maxInstances` 限制。 */
export function countBottomPanelInstances(state: BottomPanelSessionState, componentId: string): number {
	return collectBottomPanelLeaves(state.root)
		.flatMap((leaf) => leaf.tabs)
		.filter((tab) => tab.componentId === componentId).length;
}

export function canOpenBottomPanelComponent(
	state: BottomPanelSessionState,
	definition: BottomPanelComponentDefinition,
): boolean {
	if (definition.maxInstances === undefined) return true;
	return countBottomPanelInstances(state, definition.id) < definition.maxInstances;
}
