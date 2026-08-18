import { useThemeComponent } from "@vetta/theme-sdk";
import { TodoStatusBarView } from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";
import type { InputBarTodoModel } from "./types";

/** Desktop 适配层：给纯视图注入 i18n 文案。 */
export function InputBarTodoStatus({ todo }: { todo: InputBarTodoModel }): JSX.Element {
	const { t } = useTranslation("chat");
	const ThemedTodoStatusBar = useThemeComponent("chat.todoStatusBar", TodoStatusBarView);
	return (
		<ThemedTodoStatusBar
			items={todo.items}
			onOpenPanel={todo.onOpenPanel}
			labels={{
				trigger: t("inputBar.todo.trigger"),
				allDone: t("inputBar.todo.allDone"),
				panelTitle: t("inputBar.todo.panelTitle"),
				openPanel: t("inputBar.todo.openPanel"),
				statusDone: t("inputBar.todo.statusDone"),
				statusInProgress: t("inputBar.todo.statusInProgress"),
				statusPending: t("inputBar.todo.statusPending"),
			}}
		/>
	);
}
