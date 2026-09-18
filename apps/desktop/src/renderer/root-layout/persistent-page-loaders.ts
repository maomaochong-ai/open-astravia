import { loadChatPage } from "../domains/conversation/components/loadChatPage";
import { loadNewSessionPage } from "../domains/conversation/components/loadNewSessionPage";

function memoizeLoader<T>(load: () => Promise<T>): () => Promise<T> {
	let promise: Promise<T> | null = null;
	return () => {
		promise ??= load();
		return promise;
	};
}

export const loadSettingsPage = memoizeLoader(() =>
	import("../domains/settings/components/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);

export const loadAbilitiesPage = memoizeLoader(() =>
	import("../domains/abilities/components/AbilitiesPage").then((module) => ({ default: module.AbilitiesPage })),
);

export const loadAgentsPage = memoizeLoader(() =>
	import("../domains/agent-teams/components/AgentCenterPage").then((module) => ({
		default: module.AgentCenterPage,
	})),
);

export const loadAutomationPage = memoizeLoader(() =>
	import("../domains/scheduler/components/AutomationPage").then((module) => ({
		default: module.AutomationPage,
	})),
);

export const loadBatchTasksPage = memoizeLoader(() =>
	import("../domains/batch-tasks/components/BatchTasksPage").then((module) => ({
		default: module.BatchTasksPage,
	})),
);

export const loadKnowledgePage = memoizeLoader(() =>
	import("../domains/knowledge-base/components/KnowledgeBasePage").then((module) => ({
		default: module.KnowledgeBasePage,
	})),
);

export const loadKnowledgeListPage = memoizeLoader(() =>
	import("../domains/knowledge-base/components/KnowledgeBaseListPage").then((module) => ({
		default: module.KnowledgeBaseListPage,
	})),
);

export const loadScenesPage = memoizeLoader(() =>
	import("../domains/skills/components/ScenesPage").then((module) => ({ default: module.ScenesPage })),
);

export const loadWorkspacePage = memoizeLoader(() =>
	import("../domains/plugins/components/PluginWorkspaceViewRoute").then((module) => ({
		default: module.PluginWorkspaceViewSurface,
	})),
);

export const loadTeamChatPage = memoizeLoader(() =>
	import("../domains/conversation/connectors/team/TeamChatPage").then((module) => ({
		default: module.TeamChatPage,
	})),
);

export { loadChatPage, loadNewSessionPage };
