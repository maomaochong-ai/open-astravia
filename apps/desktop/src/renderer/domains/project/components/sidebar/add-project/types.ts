export interface AddProjectMenuProps {
	className?: string;
	variant?: "icon" | "navItem";
}

export type AddProjectMenuAction = "newProject" | "openProject" | "importProject";

export interface AddProjectMenuItemModel {
	action: AddProjectMenuAction;
	icon: string;
	labelKey: "actions.newProject" | "actions.openProject" | "actions.importProject";
	onSelect: () => void;
}
