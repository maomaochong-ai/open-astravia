import { getTodoItemsForSession, todoItemsBySessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TodoTabPanel } from "../components/TodoTabPanel";
import { useActivityRuntimeIds } from "../registry/context";
import type { ActivityTabDefinition } from "../registry/types";
import { collectRuntimeItems } from "../services/runtime-scope";

function TodoActivityTab(): JSX.Element {
	return <TodoTabPanel />;
}

export const todoTabDefinition: ActivityTabDefinition = {
	id: "todo",
	order: 20,
	removable: true,
	source: "builtin",
	useMeta: () => {
		const { t } = useTranslation("chat");
		const runtimeIds = useActivityRuntimeIds();
		const todoMap = useAtomValue(todoItemsBySessionAtom);
		const todoItems = useMemo(
			() => collectRuntimeItems(runtimeIds, (runtimeId) => getTodoItemsForSession(todoMap, runtimeId)),
			[todoMap, runtimeIds],
		);
		if (todoItems.length === 0) return null;
		const done = todoItems.filter((item) => item.status === "done").length;
		return {
			label: t("activityPanel.tabs.todo"),
			icon: "icon-[mdi--checkbox-marked-circle-outline]",
			badge: todoItems.length - done || undefined,
		};
	},
	component: TodoActivityTab,
};
