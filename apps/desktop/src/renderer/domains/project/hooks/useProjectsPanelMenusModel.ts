import {
	conversationFilterSource,
	projectContextMenuAtom,
	runningSessionPathsAtom,
	sessionContextMenuAtom,
} from "@shared/store/atoms";
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
	// 项目右键菜单只区分「清空会话 / 清空 Claw」，标签档按其所属来源（对话）处理。
	const defaultScope =
		projectMenu?.project.isDefault === true ? conversationFilterSource(model.defaultConversationFilter) : undefined;

	return {
		contextMenu,
		projectMenu,
		clearConversationDisabled,
		clearClawDisabled,
		defaultScope,
		actions: {
			closeSessionMenu: () => setContextMenu(null),
			closeProjectMenu: () => setProjectMenu(null),
			deleteSession: (session: { cwd: string; path: string }) => {
				setContextMenu(null);
				// 会话没了，它留下的标注就是孤儿；与置顶的清理时机保持一致。
				void window.vetta.conversationTags.forgetConversations([session.path]);
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
