import type { DefaultConversationFilter, Project, SessionInfo } from "@shared/store/atoms";
import { cn } from "@shared/lib/utils";
import { DefaultConversationSectionView } from "@vetta/theme-ui/project";
import { useTranslation } from "react-i18next";
import { DefaultConversationFilterSelect } from "../../filters/SidebarFilterSelect";
import { useDefaultConversationSectionModel } from "../../../../hooks/useDefaultConversationSectionModel";
import { DefaultSessionList } from "./DefaultSessionList";

interface DefaultConversationSectionProps {
	activeSessionPath: string;
	className?: string;
	defaultConversationFilter: DefaultConversationFilter;
	listClassName?: string;
	onNewSession: (cwd: string) => void;
	onBeforeSelectSession: () => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
	onSelectSession: (cwd: string, sessionPath: string) => void;
	project: Project;
	sessions: SessionInfo[];
	sessionsLoading: boolean;
}

export function DefaultConversationSection(
	props: DefaultConversationSectionProps,
): JSX.Element {
	const { t } = useTranslation("project");
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
					cwd={props.project.cwd}
					filter={props.defaultConversationFilter}
					onBeforeSelect={props.onBeforeSelectSession}
					onNewSession={model.actions.newSession}
					scrollParent={model.listScrollEl}
					onRenameSession={props.onRenameSession}
					onSelectSession={props.onSelectSession}
					sessions={props.sessions}
					loading={props.sessionsLoading}
				/>
			}
			listScrollElement={model.listScrollEl}
			onListScrollRef={model.setListScrollEl}
			onMoreClick={model.actions.openMoreMenu}
			onNewSession={model.actions.newSession}
			onOpenContextMenu={model.actions.openContextMenu}
			quickScrollLabels={{
				bottom: t("sidebar.projects.scrollToBottom"),
				top: t("sidebar.projects.scrollToTop"),
			}}
			showNewSession={model.showNewSession}
		/>
	);
}
