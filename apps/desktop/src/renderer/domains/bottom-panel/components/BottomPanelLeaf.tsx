import { Button } from "@shared/components/ui/button";
import type { BottomPanelLeaf as BottomPanelLeafState, BottomPanelSessionState } from "@shared/store/atoms";
import { BottomPanelTabStripView } from "@vetta-org/theme-ui/bottom-panel";
import { useAtomValue } from "jotai";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { BottomPanelInstanceHost } from "../registry/BottomPanelInstanceHost";
import { bottomPanelMetaMapAtom } from "../registry/instance-atoms";
import { resolveBottomPanelTabs } from "../registry/resolve-bottom-panel-tabs";
import type { BottomPanelComponentDefinition } from "../registry/types";
import { BottomPanelAddMenu } from "./BottomPanelAddMenu";

export interface BottomPanelLeafProps {
	readonly leaf: BottomPanelLeafState;
	readonly state: BottomPanelSessionState;
	readonly definitions: readonly BottomPanelComponentDefinition[];
	readonly cwd: string | null;
	readonly focused: boolean;
	readonly panelCollapsed: boolean;
	readonly canSplit: boolean;
	readonly onSelectTab: (tabId: string) => void;
	readonly onCloseTab: (tabId: string) => void;
	readonly onOpenComponent: (definition: BottomPanelComponentDefinition, leafId: string) => void;
	readonly onSplit: (leafId: string, direction: "row" | "column") => void;
	readonly onCollapse: () => void;
	readonly onFocus: (leafId: string) => void;
}

/**
 * 一个分屏格子：自己的 tab 条 + 活动 tab 的内容。
 *
 * 非活动 tab 的内容**不卸载**（`hidden` 藏起来）：卸载等于杀掉里面的进程和滚动缓冲，
 * 而切 tab 是高频动作。只有整块被关掉或切换会话时才会真正卸载。
 */
export function BottomPanelLeaf({
	leaf,
	state,
	definitions,
	cwd,
	focused,
	panelCollapsed,
	canSplit,
	onSelectTab,
	onCloseTab,
	onOpenComponent,
	onSplit,
	onCollapse,
	onFocus,
}: BottomPanelLeafProps): JSX.Element {
	const { t } = useTranslation("chat");
	const metaById = useAtomValue(bottomPanelMetaMapAtom);
	const resolved = resolveBottomPanelTabs({ tabs: leaf.tabs, definitions, metaById });

	return (
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			data-bottom-panel-leaf={leaf.id}
			onFocusCapture={() => onFocus(leaf.id)}
		>
			<BottomPanelTabStripView
				tabs={resolved.map((entry) => entry.view)}
				activeTabId={leaf.activeTabId}
				onSelect={onSelectTab}
				onClose={onCloseTab}
				labels={{ tablist: t("bottomPanel.tablist"), close: t("bottomPanel.closeTab") }}
				actions={
					<>
						<BottomPanelAddMenu
							definitions={definitions}
							state={state}
							onPick={(definition) => onOpenComponent(definition, leaf.id)}
						/>
						<Button
							variant="ghost"
							size="icon-xs"
							disabled={!canSplit}
							aria-label={t("bottomPanel.actions.splitRight")}
							title={canSplit ? t("bottomPanel.actions.splitRight") : t("bottomPanel.actions.splitLimit")}
							onClick={() => onSplit(leaf.id, "row")}
						>
							<span aria-hidden className="icon-[solar--sidebar-minimalistic-linear] h-3.5 w-3.5" />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							disabled={!canSplit}
							aria-label={t("bottomPanel.actions.splitDown")}
							title={canSplit ? t("bottomPanel.actions.splitDown") : t("bottomPanel.actions.splitLimit")}
							onClick={() => onSplit(leaf.id, "column")}
						>
							<span aria-hidden className="icon-[solar--layers-minimalistic-linear] h-3.5 w-3.5" />
						</Button>
						{focused ? (
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={t("bottomPanel.actions.collapse")}
								title={t("bottomPanel.actions.collapse")}
								onClick={onCollapse}
							>
								<span aria-hidden className="icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5" />
							</Button>
						) : null}
					</>
				}
			/>
			<div className="relative flex min-h-0 flex-1 flex-col">
				{resolved.map((entry) => {
					const active = entry.tabId === leaf.activeTabId;
					return (
						<div
							key={entry.tabId}
							className={active ? "flex min-h-0 flex-1 flex-col" : "hidden"}
							aria-hidden={active ? undefined : true}
						>
							<BottomPanelInstanceHost
								definition={entry.definition}
								tabId={entry.tabId}
								cwd={cwd}
								active={active && !panelCollapsed}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}
