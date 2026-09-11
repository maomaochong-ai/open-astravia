import type { JSX, ReactNode } from "react";

export interface ProjectsPanelMenusViewProps {
	projectMenu: ReactNode;
	sessionMenu: ReactNode;
	/** 由会话菜单拉起的弹窗（如标签编辑），与菜单同层挂载。 */
	dialogs?: ReactNode;
}

/** Host menus shell — session/project context menus injected as nodes. */
export function ProjectsPanelMenusView({
	projectMenu,
	sessionMenu,
	dialogs,
}: ProjectsPanelMenusViewProps): JSX.Element {
	return (
		<>
			{sessionMenu}
			{projectMenu}
			{dialogs}
		</>
	);
}
