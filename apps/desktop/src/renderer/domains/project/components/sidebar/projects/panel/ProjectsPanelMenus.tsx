import { ProjectsPanelMenusView } from "@vetta/theme-ui/project";
import { useProjectsPanelMenusModel } from "../../../../hooks/useProjectsPanelMenusModel";
import { ProjectContextMenu } from "../../../ProjectContextMenu";
import { SessionContextMenu } from "../../../SessionContextMenu";
import type { ProjectsPanelModel } from "./types";

interface ProjectsPanelMenusProps {
	model: ProjectsPanelModel;
}

export function ProjectsPanelMenus({ model }: ProjectsPanelMenusProps): JSX.Element {
	const menus = useProjectsPanelMenusModel(model);

	return (
		<ProjectsPanelMenusView
			sessionMenu={
				menus.contextMenu ? (
					<SessionContextMenu
						x={menus.contextMenu.x}
						y={menus.contextMenu.y}
						session={menus.contextMenu.session}
						onClose={menus.actions.closeSessionMenu}
						onDelete={menus.actions.deleteSession}
					/>
				) : null
			}
			projectMenu={
				menus.projectMenu ? (
					<ProjectContextMenu
						x={menus.projectMenu.x}
						y={menus.projectMenu.y}
						project={menus.projectMenu.project}
						onClose={menus.actions.closeProjectMenu}
						onArchive={menus.actions.archiveProject}
						onRemove={menus.actions.removeProject}
						onDelete={menus.actions.deleteProject}
						defaultScope={menus.defaultScope}
						onClearConversation={menus.actions.clearConversation}
						onClearClaw={menus.actions.clearClaw}
						onOpenClawSettings={menus.actions.openClawSettings}
						clearConversationDisabled={menus.clearConversationDisabled}
						clearClawDisabled={menus.clearClawDisabled}
					/>
				) : null
			}
		/>
	);
}
