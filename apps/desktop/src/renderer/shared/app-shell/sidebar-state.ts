import { SIDEBAR_NARROW_BREAKPOINT, useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { sidebarCollapsedAtom } from "@shared/store/atoms";
import type { PluginSidebarState } from "@vetta-org/plugin-sdk";
import { getDefaultStore, useAtomValue } from "jotai";
import { useMemo } from "react";

// 侧边栏可见性的单一读取口。它由两个互不相干的来源合成：用户手动收起（jotai atom）
// 与窗口窄到改走悬浮覆盖（窗口宽度）。宿主自己用 hook，插件契约走命令式订阅，
// 两条路必须读同一份定义，否则「插件看到的收起」和「实际布局」会悄悄分叉。

export type SidebarState = PluginSidebarState;

function compose(collapsed: boolean, narrow: boolean): SidebarState {
	// visible 与 RootLayoutView 里 `<SidebarDock visible={!narrow && !sidebarCollapsed}>`
	// 是同一个判断：窄屏下侧边栏不占左栏，此时 collapsed 只表示用户意愿。
	return { collapsed, narrow, visible: !collapsed && !narrow };
}

/** 读当前侧边栏状态（非 React 场景：activate()、工具处理器等）。 */
export function readSidebarState(): SidebarState {
	return compose(getDefaultStore().get(sidebarCollapsedAtom), window.innerWidth < SIDEBAR_NARROW_BREAKPOINT);
}

/**
 * 订阅侧边栏状态变化，返回取消订阅函数。
 *
 * resize 每帧都在响，所以这里按值去重——只有三元组真的变了才通知，
 * 拖窗口不会把插件的监听器打成每秒几十次的回调风暴。
 */
export function subscribeSidebarState(listener: (state: SidebarState) => void): () => void {
	let last = readSidebarState();
	const emit = (): void => {
		const next = readSidebarState();
		if (next.collapsed === last.collapsed && next.narrow === last.narrow && next.visible === last.visible) {
			return;
		}
		last = next;
		listener(next);
	};
	const unsubscribe = getDefaultStore().sub(sidebarCollapsedAtom, emit);
	window.addEventListener("resize", emit);
	return () => {
		unsubscribe();
		window.removeEventListener("resize", emit);
	};
}

/** 响应式读取侧边栏状态（宿主组件与插件 React hook 共用）。 */
export function useSidebarState(): SidebarState {
	const collapsed = useAtomValue(sidebarCollapsedAtom);
	const narrow = useNarrowScreen();
	// 引用稳定：插件常把它丢进 useEffect 依赖，每次渲染换对象会变成重复触发。
	return useMemo(() => compose(collapsed, narrow), [collapsed, narrow]);
}
