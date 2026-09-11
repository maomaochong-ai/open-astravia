import { getTodoItemsForSession, todoItemsBySessionAtom } from "@shared/store/atoms";
import type { TodoItem } from "@shared/store/todo-atoms";
import type { TodoTabPanelViewLabels } from "@vetta/theme-ui/activity";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useActivityRuntimeIds } from "../registry/context";
import { collectRuntimeItems } from "../services/runtime-scope";

export interface TodoTabPanelModel {
	items: TodoItem[];
	emptyLabel: string;
	labels: TodoTabPanelViewLabels;
}

export function useTodoTabPanelModel(): TodoTabPanelModel {
	const { t } = useTranslation("chat");
	const todoMap = useAtomValue(todoItemsBySessionAtom);
	const runtimeIds = useActivityRuntimeIds();
	const items = useMemo(
		() => collectRuntimeItems(runtimeIds, (runtimeId) => getTodoItemsForSession(todoMap, runtimeId)),
		[todoMap, runtimeIds],
	);

	const labels = useMemo(
		(): TodoTabPanelViewLabels => ({
			headline: t("activityPanel.todo.headline"),
			allDone: t("activityPanel.todo.allDone"),
			progress: (done, total) => t("activityPanel.todo.progress", { done, total }),
			statusDone: t("activityPanel.todo.statusDone"),
			statusInProgress: t("activityPanel.todo.statusInProgress"),
			statusPending: t("activityPanel.todo.statusPending"),
		}),
		[t],
	);

	return {
		items,
		emptyLabel: t("activityPanel.todo.empty"),
		labels,
	};
}
