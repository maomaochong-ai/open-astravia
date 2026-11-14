export interface AddProjectMenuProps {
	className?: string;
	variant?: "icon" | "navItem" | "primary" | "secondary";
}

export type AddProjectMenuAction =
	| "newProject"
	| "openProject"
	| "importProject"
	| "addFromRemoteHost"
	| "cloneFromGit";

export interface AddProjectMenuItemModel {
	action: AddProjectMenuAction;
	icon: string;
	labelKey:
		| "actions.newProject"
		| "actions.openProject"
		| "actions.importProject"
		| "actions.addFromRemoteHost"
		| "actions.cloneFromGit";
	descriptionKey:
		| "addProjectSplash.items.newProject"
		| "addProjectSplash.items.openProject"
		| "addProjectSplash.items.importProject"
		| "addProjectSplash.items.addFromRemoteHost"
		| "addProjectSplash.items.cloneFromGit";
	onSelect: () => void;
}

/** Splash 里的步骤：root 是入口列表，其余是各入口的二级步骤（打开项目、导入项目是原生对话框，没有步骤）。 */
export type AddProjectStep = "root" | "newProject" | "cloneFromGit" | "remoteHost";
