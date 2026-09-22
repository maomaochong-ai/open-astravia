import type { SessionContextMenuSession } from "@shared/store/atoms";
import {
	automationSessionLinksAtom,
	confirmDialogAtom,
	conversationFilterSource,
	projectContextMenuAtom,
	runningSessionPathsAtom,
	sessionContextMenuAtom,
	sessionDisplayLabel,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import type { ProjectsPanelModel } from "../components/sidebar/projects/panel/types";

export function useProjectsPanelMenusModel(model: ProjectsPanelModel) {
	const [contextMenu, setContextMenu] = useAtom(sessionContextMenuAtom);
	const [projectMenu, setProjectMenu] = useAtom(projectContextMenuAtom);
	const runningSessionPaths = useAtomValue(runningSessionPathsAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const automationLinks = useAtomValue(automationSessionLinksAtom);
	const { t } = useTranslation("project");

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
			deleteSession: (session: SessionContextMenuSession) => {
				setContextMenu(null);
				const name = isAgentTeamSession(session) ? session.sessionTitle : sessionDisplayLabel(session);
				// 删掉「同一个会话」自动化绑定的会话会让该自动化暂停，删之前说清楚。
				const boundAutomation = automationLinks.get(session.path);
				const message = t("sidebar.dialogs.deleteSessionMessage", { name });
				setConfirm({
					title: t("sidebar.dialogs.deleteSessionTitle"),
					message:
						boundAutomation?.mode === "same-session"
							? `${message}\n\n${t("sidebar.dialogs.deleteBoundSessionHint", { task: boundAutomation.taskName })}`
							: message,
					confirmLabel: t("sidebar.dialogs.deleteConfirm"),
					variant: "danger",
					onConfirm: () => {
						// 会话没了，它留下的标注就是孤儿；与置顶的清理时机保持一致。
						void window.vetta.conversationTags.forgetConversations([session.path]);
						model.actions.deleteSession(session);
					},
				});
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

function isAgentTeamSession(
	session: SessionContextMenuSession,
): session is Extract<SessionContextMenuSession, { readonly kind: "agent-team" }> {
	return "kind" in session && session.kind === "agent-team";
}
