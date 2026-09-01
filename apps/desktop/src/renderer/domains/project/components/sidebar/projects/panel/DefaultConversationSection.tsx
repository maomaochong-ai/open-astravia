import type { DefaultConversationFilter, Project, SessionInfo } from "@shared/store/atoms";
import { cn } from "@shared/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { DefaultConversationSectionView } from "@vetta/theme-ui/project";
import { useTranslation } from "react-i18next";
import { DefaultConversationFilterSelect } from "../../filters/SidebarFilterSelect";
import { useDefaultConversationSectionModel } from "../../../../hooks/useDefaultConversationSectionModel";
import { DefaultSessionList } from "./DefaultSessionList";
import { AgentTeamSidebarList } from "./AgentTeamSidebarList";

interface DefaultConversationSectionProps {
	activeSessionPath: string;
	className?: string;
	defaultConversationFilter: DefaultConversationFilter;
	listClassName?: string;
	onNewSession: (cwd: string) => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
	onSelectSession: (cwd: string, sessionPath: string) => void;
	project: Project;
	scrollParent: HTMLElement | null;
	sessions: SessionInfo[];
	/**
	 * `sessions` 真正所属的 cwd。claw 过滤下会话来自 im-gateway 的 cwd（ADR-0005），
	 * 与 `project.cwd` 是两个物理目录；选中 / 重命名必须用这个值，否则按 project.cwd
	 * 查不到会话，access 缺失后会错误地走交互式恢复而进不了只读视图。
	 */
	sessionsCwd: string;
	sessionsLoading: boolean;
}

export function DefaultConversationSection(
	props: DefaultConversationSectionProps,
): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const navigate = useNavigate();
	const model = useDefaultConversationSectionModel({
		project: props.project,
		defaultConversationFilter: props.defaultConversationFilter,
		onNewSession: props.onNewSession,
	});
	const showingTeams = props.defaultConversationFilter === "team";

	const isEmpty = !props.sessionsLoading && props.sessions.length === 0;

	return (
		<DefaultConversationSectionView
			actionsAlwaysVisible={showingTeams || (isEmpty && model.showNewSession)}
			className={props.className}
			filterSelect={<DefaultConversationFilterSelect />}
			labels={
				showingTeams
					? { more: t("sidebar.manage"), newSession: t("sidebar.newTeam") }
					: model.labels
			}
			list={
				showingTeams ? (
					<AgentTeamSidebarList />
				) : (
					<DefaultSessionList
					activeSessionPath={props.activeSessionPath}
					className={cn("project-list-containment -mx-1.5 px-1.5", props.listClassName)}
					cwd={props.sessionsCwd || props.project.cwd}
					filter={props.defaultConversationFilter}
					onNewSession={model.actions.newSession}
					scrollParent={props.scrollParent}
					onRenameSession={props.onRenameSession}
					onSelectSession={props.onSelectSession}
					sessions={props.sessions}
					loading={props.sessionsLoading}
					/>
				)
			}
			onMoreClick={
				showingTeams
					? () => void navigate({ to: "/agent-teams" })
					: model.actions.openMoreMenu
			}
			onNewSession={
				showingTeams
					? () => void navigate({ to: "/agent-teams" })
					: model.actions.newSession
			}
			onOpenContextMenu={
				showingTeams
					? (event) => event.preventDefault()
					: model.actions.openContextMenu
			}
			showNewSession={showingTeams || model.showNewSession}
		/>
	);
}
