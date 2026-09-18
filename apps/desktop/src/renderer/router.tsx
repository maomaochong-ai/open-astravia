import { createRootRoute, createRoute, createRouter, createHashHistory, redirect } from "@tanstack/react-router";
import { RootLayout } from "./App";
import { RouteErrorPage } from "./shared/components/RouteErrorPage";
import { RoutePendingShell } from "./shared/components/RoutePendingShell";
import {
	PLUGIN_HOSTED_ROUTE_PATH,
	THEME_HOSTED_ROUTE_PATH,
} from "./shared/hosted-routes/hosted-route-descriptors";

/** 保活页由 PersistentRouteStage 承载，路由只负责 URL，Outlet 不再挂这些页面。 */
function EmptyPersistentRoute(): null {
	return null;
}

const rootRoute = createRootRoute({
	component: RootLayout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: EmptyPersistentRoute,
});

const automationRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/automation",
	component: EmptyPersistentRoute,
});

const batchTasksRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/batch-tasks",
	component: EmptyPersistentRoute,
});

/**
 * 能力详情是页内右侧抽屉，由来源感知的 `?detail=<catalog-id>` 驱动（返回键即关闭）。
 * `?q=` 是外部深链带进来的搜索词初值，`?scope=` 是落地时选中的分区（Command Menu
 * 用它把「已装能力」送进「我的」而不是「发现」）。两者只作为初值播种，之后由页面
 * 自身状态接管，不做双向同步。
 */
const abilitiesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/abilities",
	component: EmptyPersistentRoute,
	validateSearch: (search: Record<string, unknown>) => ({
		...(typeof search.detail === "string" ? { detail: search.detail } : {}),
		...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
		...(search.scope === "mine" || search.scope === "discover" ? { scope: search.scope } : {}),
	}),
});

const agentCenterRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agents",
	component: EmptyPersistentRoute,
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
	component: EmptyPersistentRoute,
});

const teamSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId/sessions/$sessionId",
	component: EmptyPersistentRoute,
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
	component: EmptyPersistentRoute,
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
	component: EmptyPersistentRoute,
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
	component: EmptyPersistentRoute,
});

const knowledgeListRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/knowledge/all",
	component: EmptyPersistentRoute,
});

const settingsTabRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/$tab",
	component: EmptyPersistentRoute,
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
	component: EmptyPersistentRoute,
});

const newSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/new-session",
	validateSearch: (search: Record<string, unknown>) => ({
		...(typeof search.cwd === "string" ? { cwd: search.cwd } : {}),
		...(typeof search.target === "string" ? { target: search.target } : {}),
	}),
	component: EmptyPersistentRoute,
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
	component: EmptyPersistentRoute,
});

const themePageRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: THEME_HOSTED_ROUTE_PATH,
	component: EmptyPersistentRoute,
});

/** 插件工作区视图整页路由（`/workspace/$pluginId/$viewId`）。保活由 PersistentRouteStage 承载。 */
const pluginWorkspaceViewRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: PLUGIN_HOSTED_ROUTE_PATH,
	component: EmptyPersistentRoute,
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
	defaultNotFoundComponent: EmptyPersistentRoute,
	defaultErrorComponent: RouteErrorPage,
	defaultPendingComponent: RoutePendingShell,
	defaultPendingMs: 0,
	defaultPendingMinMs: 0,
	defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
