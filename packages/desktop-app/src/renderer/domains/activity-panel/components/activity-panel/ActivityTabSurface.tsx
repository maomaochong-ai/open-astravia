import { TabBar } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import type { FloatingActivityTabPlacement } from "@shared/store/atoms";
import { FloatingActivityTabView } from "@vetta/theme-ui/activity";
import { type ComponentType, type JSX, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ResolvedActivityTab } from "../../registry/types";
import type { ActivityPanelFrameProps } from "./ActivityPanelFrame";
import type { ActivityPanelActions } from "./types";

export interface ActivityTabSurfaceProps {
	actions: ActivityPanelActions;
	dockedOutlet: HTMLDivElement | null;
	Frame: ComponentType<ActivityPanelFrameProps>;
	floating: FloatingActivityTabPlacement | null;
	isActiveDocked: boolean;
	removeLabel: string;
	tab: ResolvedActivityTab;
}

export function ActivityTabSurface({
	actions,
	dockedOutlet,
	Frame,
	floating,
	isActiveDocked,
	removeLabel,
	tab,
}: ActivityTabSurfaceProps): JSX.Element {
	const [contentHost] = useState(() => {
		const host = document.createElement("div");
		host.className = "flex min-h-0 flex-1 flex-col";
		host.dataset.activityTabContent = tab.id;
		return host;
	});
	const attachContentHost = useCallback(
		(node: HTMLDivElement | null): void => {
			if (node && contentHost.parentElement !== node) node.appendChild(contentHost);
		},
		[contentHost],
	);

	useLayoutEffect(() => () => contentHost.remove(), [contentHost]);
	const floatingKey = floating?.key;
	useEffect(() => {
		if (!floatingKey) return;
		const focus = (): void => actions.onFloatingTabFocus(floatingKey);
		contentHost.addEventListener("pointerdown", focus);
		return () => contentHost.removeEventListener("pointerdown", focus);
	}, [actions.onFloatingTabFocus, contentHost, floatingKey]);

	const Content = tab.definition.component;
	const contentPortal = createPortal(<Content />, contentHost, `activity-tab-content:${tab.id}`);
	if (floating) {
		const tabItem = {
			key: tab.id as ActivityTabKey,
			label: tab.label,
			icon: tab.icon,
			badge: tab.badge,
			removable: tab.removable,
		};
		const floatingTabBar = (
			<TabBar
				className="min-w-0 flex-1"
				items={[tabItem]}
				value={tabItem.key}
				onChange={() => actions.onFloatingTabFocus(tabItem.key)}
				onRemove={tab.removable ? actions.onRemoveTab : undefined}
				removeLabel={removeLabel}
				onTabDragStart={actions.onFloatingTabDragStart}
				onTabDragMove={actions.onFloatingTabDragMove}
				onTabDragEnd={actions.onFloatingTabDragEnd}
			/>
		);
		return (
			<>
				{contentPortal}
				<FloatingActivityTabView
					Frame={Frame}
					rect={floating}
					zIndex={40 + floating.zIndex}
					tabBar={floatingTabBar}
					onFocus={() => actions.onFloatingTabFocus(tabItem.key)}
					onResize={(delta) => actions.onFloatingResize(tabItem.key, delta)}
					onResizeEnd={() => actions.onFloatingResizeEnd(tabItem.key)}
				>
					<div ref={attachContentHost} className="flex min-h-0 flex-1 flex-col" />
				</FloatingActivityTabView>
			</>
		);
	}

	return (
		<>
			{contentPortal}
			{dockedOutlet
				? createPortal(
						<div
							ref={attachContentHost}
							className={isActiveDocked ? "flex min-h-0 flex-1 flex-col" : "hidden"}
						/>,
						dockedOutlet,
						`activity-tab-docked:${tab.id}`,
					)
				: null}
		</>
	);
}
