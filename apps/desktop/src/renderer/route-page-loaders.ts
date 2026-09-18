import { loadNewSessionPage } from "./domains/conversation/components/loadNewSessionPage";

/** Shared by React.lazy routes and navigation intent prefetch. No page mounts here. */
export { loadNewSessionPage };

export const loadAbilitiesPage = async () => ({
	default: (await import("./domains/abilities/components/AbilitiesPage")).AbilitiesPage,
});

export const loadAgentCenterPage = async () => ({
	default: (await import("./domains/agent-teams/components/AgentCenterPage")).AgentCenterPage,
});

export const loadAutomationPage = async () => ({
	default: (await import("./domains/scheduler/components/AutomationPage")).AutomationPage,
});

export const loadBatchTasksPage = async () => ({
	default: (await import("./domains/batch-tasks/components/BatchTasksPage")).BatchTasksPage,
});

export const loadKnowledgeBasePage = async () => ({
	default: (await import("./domains/knowledge-base/components/KnowledgeBasePage")).KnowledgeBasePage,
});

export const loadScenesPage = async () => ({
	default: (await import("./domains/skills/components/ScenesPage")).ScenesPage,
});

export const loadSettingsPage = async () => ({
	default: (await import("./domains/settings/components/SettingsPage")).SettingsPage,
});

export const loadPluginWorkspaceViewRoute = async () => ({
	default: (await import("./domains/plugins/components/PluginWorkspaceViewRoute")).PluginWorkspaceViewRoute,
});
