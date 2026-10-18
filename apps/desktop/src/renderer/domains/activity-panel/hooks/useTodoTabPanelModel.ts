import type { TodoTabPanelViewLabels } from "@astravia-org/theme-ui/activity";
import { getTodoItemsForSession, todoItemsBySessionAtom } from "@shared/store/atoms";
import type { TodoItem } from "@shared/store/todo-atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useActivityRuntimeIds } from "../registry/context";
import { collectRuntimeItems } from "../services/runtime-scope";

export interface TodoTabPanelModel {
	items: TodoItem[];
	emptyLabel: string;
	labels: TodoTabPanelViewLabels;
	/** 清空当前工作区里持有清单的 Runtime；空清单时面板不展示入口。 */
	clearTodos: () => Promise<void>;
}

export function useTodoTabPanelModel(): TodoTabPanelModel {
	const { t } = useTranslation("chat");
	const todoMap = useAtomValue(todoItemsBySessionAtom);
	const runtimeIds = useActivityRuntimeIds();
	const items = useMemo(
		() => collectRuntimeItems(runtimeIds, (runtimeId) => getTodoItemsForSession(todoMap, runtimeId)),
		[todoMap, runtimeIds],
	);
	const owners = useMemo(
		() => runtimeIds.filter((runtimeId) => getTodoItemsForSession(todoMap, runtimeId).length > 0),
		[runtimeIds, todoMap],
	);

	const labels = useMemo(
		(): TodoTabPanelViewLabels => ({
			headline: t("activityPanel.todo.headline"),
			allDone: t("activityPanel.todo.allDone"),
			progress: (done, total) => t("activityPanel.todo.progress", { done, total }),
			statusDone: t("activityPanel.todo.statusDone"),
			statusInProgress: t("activityPanel.todo.statusInProgress"),
			statusPending: t("activityPanel.todo.statusPending"),
			clear: t("activityPanel.todo.clear"),
		}),
		[t],
	);

	// 面板状态由 session.extension 观察推回，不需要本地乐观更新。
	const clearTodos = async (): Promise<void> => {
		for (const runtimeId of owners) {
			try {
				await window.astravia.session.clearTodos(runtimeId);
			} catch (err) {
				console.error("[TodoTabPanel] clearTodos failed:", err);
			}
		}
	};

	return {
		items,
		emptyLabel: t("activityPanel.todo.empty"),
		labels,
		clearTodos,
	};
}
