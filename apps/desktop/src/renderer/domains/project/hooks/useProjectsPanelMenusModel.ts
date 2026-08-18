import { projectContextMenuAtom, runningSessionPathsAtom, sessionContextMenuAtom } from "@shared/store/atoms";
import { useAtom, useAtomValue } from "jotai";
import type { ProjectsPanelModel } from "../components/sidebar/projects/panel/types";

export function useProjectsPanelMenusModel(model: ProjectsPanelModel) {
	const [contextMenu, setContextMenu] = useAtom(sessionContextMenuAtom);
	const [projectMenu, setProjectMenu] = useAtom(projectContextMenuAtom);
	const runningSessionPaths = useAtomValue(runningSessionPathsAtom);

	const clearConversationDisabled =
		projectMenu?.project.isDefault === true &&
		model.projectSessions(projectMenu.project.cwd).some((session) => runningSessionPaths.has(session.path));

	const clearClawDisabled =
		projectMenu?.project.isDefault === true &&
		model.projectSessions(model.imCwd).some((session) => runningSessionPaths.has(session.path));

	return {
		contextMenu,
		projectMenu,
		clearConversationDisabled,
		clearClawDisabled,
		defaultScope: projectMenu?.project.isDefault === true ? model.defaultConversationFilter : undefined,
		actions: {
			closeSessionMenu: () => setContextMenu(null),
			closeProjectMenu: () => setProjectMenu(null),
			deleteSession: (session: { cwd: string; path: string }) => {
				setContextMenu(null);
				model.actions.deleteSession(session);
			},
			archiveProject: (cwd: string) => {
				setProjectMenu(null);
				model.actions.archiveProject(cwd);
			},
			removeProject: (cwd: string) => {
				setProjectMenu(null);
				model.actions.removeProject(cwd);
			},
			deleteProject: (cwd: string) => {
				setProjectMenu(null);
				model.actions.deleteProject(cwd);
			},
			clearConversation: (cwd: string) => {
				setProjectMenu(null);
				model.actions.clearConversation(cwd);
			},
			clearClaw: (cwd: string) => {
				setProjectMenu(null);
				model.actions.clearClaw(cwd);
			},
			openClawSettings: () => {
				setProjectMenu(null);
				model.actions.openClawSettings();
			},
		},
	};
}
