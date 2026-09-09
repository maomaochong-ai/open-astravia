import { createRootRoute, createRoute, createRouter, createHashHistory, redirect } from "@tanstack/react-router";
import { lazy } from "react";
import { RouteContentLoadingView } from "@vetta/theme-ui/app";
import { RootLayout } from "./App";
import { loadNewSessionPage } from "./domains/conversation/components/loadNewSessionPage";
import { RouteErrorPage } from "./shared/components/RouteErrorPage";
import {
	PLUGIN_HOSTED_ROUTE_PATH,
	THEME_HOSTED_ROUTE_PATH,
} from "./shared/hosted-routes/hosted-route-descriptors";

const ChatPage = lazy(async () => ({
	default: (await import("./domains/conversation/components/ChatPage")).ChatPage,
}));
const NewSessionPage = lazy(loadNewSessionPage);
const SessionViewerPage = lazy(async () => ({
	default: (await import("./domains/conversation/components/SessionViewerPage")).SessionViewerPage,
}));
const AutomationPage = lazy(async () => ({
	default: (await import("./domains/scheduler/components/AutomationPage")).AutomationPage,
}));
const BatchTasksPage = lazy(async () => ({
	default: (await import("./domains/batch-tasks/components/BatchTasksPage")).BatchTasksPage,
}));
const AbilitiesPage = lazy(async () => ({
	default: (await import("./domains/abilities/components/AbilitiesPage")).AbilitiesPage,
}));
const AgentCenterPage = lazy(async () => ({
	default: (await import("./domains/agent-teams/components/AgentCenterPage")).AgentCenterPage,
}));
const TeamChatPage = lazy(async () => ({
	default: (await import("./domains/conversation/connectors/team/TeamChatPage")).TeamChatPage,
}));
const ScenesPage = lazy(async () => ({
	default: (await import("./domains/skills/components/ScenesPage")).ScenesPage,
}));
const SettingsPage = lazy(async () => ({
	default: (await import("./domains/settings/components/SettingsPage")).SettingsPage,
}));
const ProjectDetailPage = lazy(async () => ({
	default: (await import("./domains/project/components/ProjectDetailPage")).ProjectDetailPage,
}));
const KnowledgeBasePage = lazy(async () => ({
	default: (await import("./domains/knowledge-base/components/KnowledgeBasePage")).KnowledgeBasePage,
}));
const KnowledgeBaseListPage = lazy(async () => ({
	default: (await import("./domains/knowledge-base/components/KnowledgeBaseListPage")).KnowledgeBaseListPage,
}));
const PluginWorkspaceViewRoute = lazy(async () => ({
	default: (await import("./domains/plugins/components/PluginWorkspaceViewRoute")).PluginWorkspaceViewRoute,
}));
const ThemePageRoute = lazy(async () => ({
	default: (await import("./shared/theme/pages/ThemePageRoute")).ThemePageRoute,
}));

const rootRoute = createRootRoute({
	component: RootLayout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: ChatPage,
});

/** 设置 / 自动化 / 批量任务不显示切页骨架：pending 期间留空白，内容就绪后直出。 */
const NoPendingComponent = (): null => null;

const automationRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/automation",
	component: AutomationPage,
	pendingComponent: NoPendingComponent,
});

const batchTasksRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/batch-tasks",
	component: BatchTasksPage,
	pendingComponent: NoPendingComponent,
});

/**
 * 能力详情是页内右侧抽屉，由来源感知的 `?detail=<catalog-id>` 驱动（返回键即关闭）。
 * `?q=` 是外部深链带进来的搜索词初值（Command Menu 的「在能力市场中搜索」用它）；
 * 只作为初值播种，之后由页面自身状态接管，不做双向同步。
 */
const abilitiesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/abilities",
	component: AbilitiesPage,
	validateSearch: (search: Record<string, unknown>) => ({
		...(typeof search.detail === "string" ? { detail: search.detail } : {}),
		...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
	}),
});

const agentCenterRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agents",
	component: AgentCenterPage,
	pendingComponent: NoPendingComponent,
	// 智能体档案与团队设置都是抽屉，用 search 驱动，Esc 与返回键即关闭。
	validateSearch: (search: Record<string, unknown>) => ({
		...(typeof search.agent === "string" ? { agent: search.agent } : {}),
		...(typeof search.team === "string" ? { team: search.team } : {}),
	}),
});

/** 旧的团队列表页已并入智能体中心，深链保持可用。 */
const teamListRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams",
	beforeLoad: () => {
		throw redirect({ to: "/agents", replace: true });
	},
});

const teamChatRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId",
	component: TeamChatPage,
	pendingComponent: NoPendingComponent,
});

const teamSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId/sessions/$sessionId",
	component: TeamChatPage,
	pendingComponent: NoPendingComponent,
});

const teamNewSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId/new",
	beforeLoad: ({ params }) => {
		throw redirect({ to: "/new-session", search: { target: `team:${params.teamId}` } });
	},
});

const teamMemberSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId/sessions/$sessionId/members/$memberId",
	component: TeamChatPage,
	pendingComponent: NoPendingComponent,
});

/** 团队设置已改为智能体中心的抽屉，深链保持可用。 */
const teamSettingsRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId/settings",
	beforeLoad: ({ params }) => {
		throw redirect({ to: "/agents", search: { team: params.teamId }, replace: true });
	},
});

/** 旧深链：曾经的独立详情页改为能力页抽屉。 */
const abilityDetailRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/abilities/$type/$slug",
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/abilities",
			search: { detail: `${params.type}:${params.slug}` },
			replace: true,
		});
	},
});

/** 旧深链：/skills?tab=scene 仍去场景页，其余一律并入能力页（ADR-0049）。 */
const skillsRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/skills",
	validateSearch: (search: Record<string, unknown>) => ({
		...(typeof search.tab === "string" ? { tab: search.tab } : {}),
	}),
	beforeLoad: ({ search }) => {
		throw redirect({ to: search.tab === "scene" ? "/scenes" : "/abilities", replace: true });
	},
});

const scenesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/scenes",
	component: ScenesPage,
});

const pluginsRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/plugins",
	beforeLoad: () => {
		throw redirect({ to: "/abilities", replace: true });
	},
});

const knowledgeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/knowledge",
	component: KnowledgeBasePage,
});

const knowledgeListRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/knowledge/all",
	component: KnowledgeBaseListPage,
});

const settingsTabRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/$tab",
	component: SettingsPage,
	pendingComponent: NoPendingComponent,
	validateSearch: (search: Record<string, unknown>) => {
		const section = typeof search.section === "string" ? search.section : undefined;
		const h2 = typeof search.h2 === "string" ? search.h2 : undefined;
		const nav = typeof search.nav === "string" ? search.nav : undefined;
		// `<pluginId>/<viewId>`：设置壳内嵌打开某个插件工作区视图（ADR-0105）。
		const view = typeof search.view === "string" ? search.view : undefined;
		return {
			...(section ? { section } : {}),
			...(h2 ? { h2 } : {}),
			...(nav ? { nav } : {}),
			...(view ? { view } : {}),
		};
	},
});

const projectDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/project/$cwd",
	component: ProjectDetailPage,
});

const newSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/new-session",
	validateSearch: (search: Record<string, unknown>) => ({
		...(typeof search.cwd === "string" ? { cwd: search.cwd } : {}),
		...(typeof search.target === "string" ? { target: search.target } : {}),
	}),
	component: NewSessionPage,
});

const legacyNewSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/new-session/$cwd",
	beforeLoad: ({ params }) => {
		throw redirect({ to: "/new-session", search: { cwd: params.cwd } });
	},
});

const sessionViewerRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/viewer/$path",
	component: SessionViewerPage,
});

const themePageRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: THEME_HOSTED_ROUTE_PATH,
	component: ThemePageRoute,
});

/** 插件工作区视图整页路由（`/workspace/$pluginId/$viewId`）。 */
const pluginWorkspaceViewRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: PLUGIN_HOSTED_ROUTE_PATH,
	component: PluginWorkspaceViewRoute,
	pendingComponent: NoPendingComponent,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	automationRoute,
	batchTasksRoute,
	agentCenterRoute,
	teamListRedirectRoute,
	teamChatRoute,
	teamNewSessionRoute,
	teamSessionRoute,
	teamMemberSessionRoute,
	teamSettingsRedirectRoute,
	knowledgeRoute,
	knowledgeListRoute,
	abilitiesRoute,
	abilityDetailRedirectRoute,
	skillsRedirectRoute,
	scenesRoute,
	pluginsRedirectRoute,
	settingsTabRoute,
	projectDetailRoute,
	newSessionRoute,
	legacyNewSessionRoute,
	sessionViewerRoute,
	pluginWorkspaceViewRoute,
	themePageRoute,
]);

export const router = createRouter({
	routeTree,
	history: createHashHistory(),
	defaultNotFoundComponent: ChatPage,
	defaultErrorComponent: RouteErrorPage,
	defaultPendingComponent: RouteContentLoadingView,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
