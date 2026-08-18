import type { DefaultConversationFilter, Project, SessionInfo } from "@shared/store/atoms";
import { projectContextMenuAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface UseDefaultConversationSectionModelArgs {
	project: Project;
	defaultConversationFilter: DefaultConversationFilter;
	onNewSession: (cwd: string) => void;
}

export function useDefaultConversationSectionModel({
	project,
	defaultConversationFilter,
	onNewSession,
}: UseDefaultConversationSectionModelArgs) {
	const { t } = useTranslation("project");
	const [, setProjectMenu] = useAtom(projectContextMenuAtom);
	const [listScrollEl, setListScrollEl] = useState<HTMLDivElement | null>(null);

	return {
		labels: {
			more: t("actions.more"),
			newSession: t("sidebar.nav.newSession"),
		},
		listScrollEl,
		setListScrollEl,
		showNewSession: defaultConversationFilter !== "claw",
		actions: {
			newSession: () => onNewSession(project.cwd),
			openContextMenu: (event: React.MouseEvent) => {
				event.preventDefault();
				setProjectMenu({ x: event.clientX, y: event.clientY, project });
			},
			openMoreMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
				event.stopPropagation();
				const rect = event.currentTarget.getBoundingClientRect();
				setProjectMenu({ x: rect.left, y: rect.bottom + 4, project });
			},
		},
	};
}

export type { Project, SessionInfo, DefaultConversationFilter };
