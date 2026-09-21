import {
	type BottomPanelSplitContent,
	type BottomPanelSplitDirection,
	bottomPanelStateAtom,
	collectBottomPanelLeaves,
	confirmDialogAtom,
	dispatchBottomPanelAtom,
} from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { bottomPanelCloseGuardsAtom } from "../registry/instance-atoms";
import { canOpenBottomPanelComponent } from "../registry/resolve-bottom-panel-tabs";
import { resolveCloseDecision } from "../registry/resolve-close-decision";
import type { BottomPanelCloseReason, BottomPanelComponentDefinition } from "../registry/types";

function newId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

export interface BottomPanelTabActions {
	openComponent(definition: BottomPanelComponentDefinition, leafId?: string): void;
	activateTab(tabId: string): void;
	focusLeaf(leafId: string): void;
	closeTab(tabId: string, reason?: BottomPanelCloseReason): void;
	splitLeaf(leafId: string, direction: BottomPanelSplitDirection): void;
	moveTab(tabId: string, targetLeafId: string, targetIndex: number): void;
}

/**
 * tab 的增删与分屏。
 *
 * 新 id 都在这里生成，reducer 只做状态转换——这样 reducer 保持纯函数、可精确断言，
 * 随机源只有这一个入口。
 */
export function useBottomPanelTabs(definitions: readonly BottomPanelComponentDefinition[]): BottomPanelTabActions {
	const { t } = useTranslation("chat");
	const state = useAtomValue(bottomPanelStateAtom);
	const guards = useAtomValue(bottomPanelCloseGuardsAtom);
	const dispatch = useSetAtom(dispatchBottomPanelAtom);
	const setConfirmDialog = useSetAtom(confirmDialogAtom);

	const openComponent = useCallback(
		(definition: BottomPanelComponentDefinition, leafId?: string) => {
			if (!canOpenBottomPanelComponent(state, definition)) return;
			dispatch({
				type: "open-tab",
				tabId: newId("tab"),
				componentId: definition.id,
				newLeafId: newId("leaf"),
				leafId,
			});
		},
		[state, dispatch],
	);

	const closeTab = useCallback(
		(tabId: string, reason: BottomPanelCloseReason = "user-close-tab") => {
			void (async () => {
				const outcome = await resolveCloseDecision({
					guard: guards.get(tabId),
					tabId,
					reason,
					fallbackConfirm: {
						title: t("bottomPanel.closeConfirm.title"),
						message: t("bottomPanel.closeConfirm.message"),
						confirmLabel: t("bottomPanel.closeConfirm.confirm"),
					},
				});
				if (outcome.kind === "cancel") return;
				if (outcome.kind === "close") {
					dispatch({ type: "close-tab", tabId });
					return;
				}
				setConfirmDialog({
					title: outcome.confirm.title,
					message: outcome.confirm.message,
					confirmLabel: outcome.confirm.confirmLabel,
					cancelLabel: outcome.confirm.cancelLabel,
					variant: outcome.confirm.destructive ? "danger" : "default",
					onConfirm: () => {
						setConfirmDialog(null);
						dispatch({ type: "close-tab", tabId });
					},
					onCancel: () => setConfirmDialog(null),
				});
			})();
		},
		[guards, dispatch, setConfirmDialog, t],
	);

	/**
	 * 分屏：格子里有多个 tab 就把当前那个搬过去（用户多半想并排看这两个）；
	 * 只有一个 tab 就在新格子里再开一个同类实例——搬走会把源格子搬空，等于没分。
	 */
	const splitLeaf = useCallback(
		(leafId: string, direction: BottomPanelSplitDirection) => {
			const leaf = collectBottomPanelLeaves(state.root).find((entry) => entry.id === leafId);
			if (!leaf) return;
			const activeTabId = leaf.activeTabId ?? leaf.tabs[0]?.tabId;
			if (!activeTabId) return;

			let content: BottomPanelSplitContent;
			if (leaf.tabs.length >= 2) {
				content = { kind: "move-tab", tabId: activeTabId };
			} else {
				const source = leaf.tabs[0];
				if (!source) return;
				const definition = definitions.find((entry) => entry.id === source.componentId);
				if (!definition || !canOpenBottomPanelComponent(state, definition)) return;
				content = { kind: "new-tab", tabId: newId("tab"), componentId: source.componentId };
			}

			dispatch({
				type: "split-leaf",
				leafId,
				direction,
				newLeafId: newId("leaf"),
				newGroupId: newId("group"),
				content,
			});
		},
		[state, definitions, dispatch],
	);

	return {
		openComponent,
		activateTab: useCallback((tabId: string) => dispatch({ type: "activate-tab", tabId }), [dispatch]),
		focusLeaf: useCallback((leafId: string) => dispatch({ type: "focus-leaf", leafId }), [dispatch]),
		closeTab,
		splitLeaf,
		moveTab: useCallback(
			(tabId: string, targetLeafId: string, targetIndex: number) =>
				dispatch({ type: "move-tab", tabId, targetLeafId, targetIndex }),
			[dispatch],
		),
	};
}
