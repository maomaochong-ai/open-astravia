import type {
	DefaultConversationFilter,
	Project,
	SessionExecutionMode,
	SessionInfo,
	SidebarFilter,
} from "@shared/store/atoms";

export interface ProjectsPanelProps {
	defaultSessionListClassName?: string;
	filter: SidebarFilter;
	onOpenSession: (cwd: string, sessionPath?: string, executionMode?: SessionExecutionMode) => Promise<void>;
}

export interface BatchProjectEntry {
	project: Project;
	sessions: SessionInfo[];
}

export interface ProjectsPanelModel {
	activeSessionPath: string;
	batchProjects: BatchProjectEntry[];
	defaultConversationFilter: DefaultConversationFilter;
	defaultProject: Project | undefined;
	defaultSessions: SessionInfo[];
	/** 默认区会话真正所属的 cwd：claw 过滤下是 im-gateway 的 cwd，而非 defaultProject.cwd。 */
	defaultSessionsCwd: string;
	expandedBatchProjects: Set<string>;
	expandedProjects: Set<string>;
	filteredProjects: Project[];
	imCwd: string;
	noOtherProjects: boolean;
	projectSessions: (cwd: string) => SessionInfo[];
	projectSessionsLoading: (cwd: string) => boolean;
	projectsLoading: boolean;
	defaultSessionsLoading: boolean;
	showBatchGroup: boolean;
	actions: {
		archiveProject(cwd: string): void;
		batchNewSession(cwd: string): void;
		clearClaw(cwd: string): void;
		clearConversation(cwd: string): void;
		collapseBatchProject(cwd: string): void;
		collapseProject(cwd: string): void;
		deleteProject(cwd: string): void;
		deleteSession(session: { cwd: string; path: string }): void;
		defaultNewSession(cwd: string): void;
		defaultSelectSession(cwd: string, path: string): void;
		expandBatchProject(cwd: string): void;
		expandProject(cwd: string): void;
		isProjectActive(cwd: string): boolean;
		navigateProject(cwd: string): void;
		openClawSettings(): void;
		removeProject(cwd: string): void;
		renameSession(cwd: string, sessionPath: string, name: string): void;
		selectBatchSession(cwd: string, path: string): void;
		selectSession(cwd: string, path: string): void;
	};
}
