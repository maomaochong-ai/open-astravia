import type { DefaultConversationFilter, Project, SessionInfo } from "@shared/store/atoms";
import { cn } from "@shared/lib/utils";
import { DefaultConversationSectionView } from "@vetta/theme-ui/project";
import { DefaultConversationFilterSelect } from "../../filters/SidebarFilterSelect";
import { useDefaultConversationSectionModel } from "../../../../hooks/useDefaultConversationSectionModel";
import { DefaultSessionList } from "./DefaultSessionList";

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
	const model = useDefaultConversationSectionModel({
		project: props.project,
		defaultConversationFilter: props.defaultConversationFilter,
		onNewSession: props.onNewSession,
	});

	const isEmpty = !props.sessionsLoading && props.sessions.length === 0;

	return (
		<DefaultConversationSectionView
			actionsAlwaysVisible={isEmpty && model.showNewSession}
			className={props.className}
			filterSelect={<DefaultConversationFilterSelect />}
			labels={model.labels}
			list={
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
			}
			onMoreClick={model.actions.openMoreMenu}
			onNewSession={model.actions.newSession}
			onOpenContextMenu={model.actions.openContextMenu}
			showNewSession={model.showNewSession}
		/>
	);
}
