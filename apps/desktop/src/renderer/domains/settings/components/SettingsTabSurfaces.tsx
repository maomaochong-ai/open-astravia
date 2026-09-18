import { DeferredSurface } from "@shared/components/DeferredSurface";
import { useEffect, useState, type ComponentType, type JSX } from "react";
import { SettingsTabShell } from "./SettingsTabShell";
import { SETTINGS_TAB_LOADERS, type SettingsContentTab } from "./settings-tab-loaders";

function rememberVisitedTab(
	visited: ReadonlySet<SettingsContentTab>,
	tab: SettingsContentTab,
): ReadonlySet<SettingsContentTab> {
	if (visited.has(tab)) return visited;
	const next = new Set(visited);
	next.add(tab);
	return next;
}

function useSettingsTabContent(tab: SettingsContentTab): ComponentType | null {
	const [Content, setContent] = useState<ComponentType | null>(null);

	// 设置页可能在 hidden Activity 里预挂，effects 会被拆掉。
	// 渲染期踢 memoized loader，后台仍能开始拉 chunk；不要用
	// useAllowLazyAfterFirstPaint，绘制屏障在隐藏树里不会放行。
	if (Content === null) {
		void SETTINGS_TAB_LOADERS[tab]().catch(() => undefined);
	}

	useEffect(() => {
		let cancelled = false;
		void SETTINGS_TAB_LOADERS[tab]().then(
			(module) => {
				if (!cancelled) setContent(() => module.default);
			},
			() => undefined,
		);
		return () => {
			cancelled = true;
		};
	}, [tab]);

	return Content;
}

function SettingsTabPanel({ active, tab }: { active: boolean; tab: SettingsContentTab }): JSX.Element {
	const Content = useSettingsTabContent(tab);
	return (
		<DeferredSurface active={active} name={`settings-tab:${tab}`}>
			{Content ? (
				<div className="h-full min-h-0 w-full">
					<Content />
				</div>
			) : (
				<SettingsTabShell tab={tab} />
			)}
		</DeferredSurface>
	);
}

export function SettingsTabSurfaces({ activeTab }: { activeTab: SettingsContentTab }): JSX.Element {
	const [visited, setVisited] = useState<ReadonlySet<SettingsContentTab>>(
		() => new Set<SettingsContentTab>([activeTab]),
	);
	const nextVisited = rememberVisitedTab(visited, activeTab);
	if (nextVisited !== visited) setVisited(nextVisited);

	return (
		<>
			{[...visited].map((tab) => (
				<SettingsTabPanel key={tab} active={tab === activeTab} tab={tab} />
			))}
		</>
	);
}
