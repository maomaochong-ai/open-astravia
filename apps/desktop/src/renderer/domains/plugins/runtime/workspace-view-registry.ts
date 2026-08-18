import { PLUGIN_HOSTED_ROUTE_PATH, pluginHostedRoutePath } from "@shared/hosted-routes/hosted-route-descriptors";
import type { RegisteredWorkspaceView } from "@shared/store/atoms";
import { HOSTED_ROUTE_SEGMENT_PATTERN, isValidHostedRouteSegment } from "@vetta/capability-sdk";
import type { PluginNavBadge, PluginNavBadgeTone } from "@vetta-org/plugin-sdk";
import { pluginWorkspaceRoute } from "./plugin-hosted-route-capability.js";

/**
 * 插件**工作区视图**（整页 surface）的路由。与主题页 `/theme/$themeId/$pageId`
 * 同构：宿主给出一条稳定深链，插件只负责渲染内容区。
 */
export const WORKSPACE_VIEW_ROUTE_PATH = PLUGIN_HOSTED_ROUTE_PATH;

/**
 * 视图 id 直接进 URL 段，且会作为侧边栏布局持久化的一部分，故只允许保守字符集：
 * 首字符字母数字，后续可含 `.`、`_`、`-`。
 */
export const WORKSPACE_VIEW_ID_PATTERN = new RegExp(HOSTED_ROUTE_SEGMENT_PATTERN);

export function isValidWorkspaceViewId(id: string): boolean {
	return isValidHostedRouteSegment(id);
}

/** 侧边栏导航项 key ⇄ 工作区视图的映射前缀。 */
const NAV_KEY_PREFIX = "workspace:";

/** 该视图在侧边栏导航中的稳定 key（也是布局持久化的键）。 */
export function workspaceViewNavKey(pluginId: string, viewId: string): string {
	return `${NAV_KEY_PREFIX}${pluginId}/${viewId}`;
}

/** 从导航 key 反解出 pluginId / viewId；不是工作区视图时返回 null。 */
export function parseWorkspaceViewNavKey(key: string): { pluginId: string; viewId: string } | null {
	if (!key.startsWith(NAV_KEY_PREFIX)) return null;
	const rest = key.slice(NAV_KEY_PREFIX.length);
	const separator = rest.indexOf("/");
	if (separator <= 0) return null;
	const pluginId = rest.slice(0, separator);
	const viewId = rest.slice(separator + 1);
	if (!pluginId || !isValidWorkspaceViewId(viewId)) return null;
	return { pluginId, viewId };
}

/** 该视图整页路由的 hash 路径（`openExternal` 之外的宿主内跳转都用它）。 */
export function workspaceViewPath(pluginId: string, viewId: string): string {
	return pluginHostedRoutePath(pluginWorkspaceRoute(pluginId, viewId));
}

/**
 * 在已发布的注册表里找一条视图。pluginId / viewId 任一不合法或未注册时返回
 * undefined —— 路由层据此把用户送回首页，而不是渲染空白页。
 */
export function findWorkspaceView(
	views: readonly RegisteredWorkspaceView[],
	pluginId: string | undefined,
	viewId: string | undefined,
): RegisteredWorkspaceView | undefined {
	if (!pluginId || !viewId || !isValidWorkspaceViewId(viewId)) return undefined;
	return views.find((view) => view.pluginId === pluginId && view.viewId === viewId);
}

const BADGE_TONES: readonly PluginNavBadgeTone[] = ["accent", "danger", "default", "warning"];

function normalizeTone(value: unknown): PluginNavBadgeTone | undefined {
	return typeof value === "string" && (BADGE_TONES as readonly string[]).includes(value)
		? (value as PluginNavBadgeTone)
		: undefined;
}

/**
 * 插件给的角标是不可信输入（跨 Module Federation 边界进来的普通对象），在这里
 * 一次性收窄：认不出的 kind、空文本、非有限数一律当「没有角标」，而不是让一个
 * 半成品对象流到渲染层去。
 *
 * 计数取整并夹到 0：负数没有意义，小数会渲染成 `3.5`。
 */
export function normalizePluginNavBadge(badge: unknown): PluginNavBadge | undefined {
	if (!badge || typeof badge !== "object") return undefined;
	const kind = (badge as { kind?: unknown }).kind;
	const tone = normalizeTone((badge as { tone?: unknown }).tone);
	if (kind === "beta") return { kind: "beta" };
	if (kind === "dot") return tone ? { kind: "dot", tone } : { kind: "dot" };
	if (kind === "count") {
		const raw = (badge as { count?: unknown }).count;
		if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
		const count = Math.max(0, Math.trunc(raw));
		return tone ? { kind: "count", count, tone } : { kind: "count", count };
	}
	if (kind === "text") {
		const raw = (badge as { text?: unknown }).text;
		const text = typeof raw === "string" ? raw.trim() : "";
		if (!text) return undefined;
		return tone ? { kind: "text", text, tone } : { kind: "text", text };
	}
	return undefined;
}

/** 注册表排序：先按插件内 navOrder，再按 viewId，最后按 pluginId，保证稳定。 */
export function sortWorkspaceViews(views: readonly RegisteredWorkspaceView[]): RegisteredWorkspaceView[] {
	return [...views].sort(
		(left, right) =>
			left.pluginId.localeCompare(right.pluginId) ||
			left.navOrder - right.navOrder ||
			left.viewId.localeCompare(right.viewId),
	);
}
