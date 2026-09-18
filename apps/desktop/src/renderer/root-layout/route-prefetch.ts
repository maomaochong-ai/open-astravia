import type { SidebarNavItem } from "@vetta-org/theme-sdk/sidebar";
import { prefetchSettingsTab } from "../domains/settings/components/settings-tab-loaders";
import {
	loadAbilitiesPage,
	loadAgentsPage,
	loadAutomationPage,
	loadBatchTasksPage,
	loadChatPage,
	loadKnowledgeListPage,
	loadKnowledgePage,
	loadNewSessionPage,
	loadScenesPage,
	loadSettingsPage,
	loadTeamChatPage,
	loadWorkspacePage,
} from "./persistent-page-loaders";

type PrefetchKey =
	| "/"
	| "/abilities"
	| "/agents"
	| "/automation"
	| "/batch-tasks"
	| "/knowledge"
	| "/knowledge/all"
	| "/scenes"
	| "new-session"
	| "settings"
	| "team-chat"
	| "workspace";

const LOADERS: Record<PrefetchKey, () => Promise<unknown>> = {
	"/": loadChatPage,
	"/abilities": loadAbilitiesPage,
	"/agents": loadAgentsPage,
	"/automation": loadAutomationPage,
	"/batch-tasks": loadBatchTasksPage,
	"/knowledge": loadKnowledgePage,
	"/knowledge/all": loadKnowledgeListPage,
	"/scenes": loadScenesPage,
	"new-session": loadNewSessionPage,
	settings: loadSettingsPage,
	"team-chat": loadTeamChatPage,
	workspace: loadWorkspacePage,
};

/** 侧栏默认置顶 + 高频入口：首屏 effect 里立刻拉 chunk，不等空闲队列。 */
export const PINNED_PREFETCH_KEYS: readonly PrefetchKey[] = [
	"workspace",
	"/abilities",
	"/agents",
	"new-session",
	"settings",
];

/** 其余页：置顶拉完后再按空闲切片铺开。 */
export const IDLE_PREFETCH_KEYS: readonly PrefetchKey[] = [
	"/knowledge",
	"/knowledge/all",
	"/scenes",
	"/automation",
	"/batch-tasks",
	"team-chat",
];

export const IDLE_PREFETCH_FIRST_MS = 0;
export const IDLE_PREFETCH_STEP_MS = 800;

export function navItemPrefetchKey(item: SidebarNavItem): PrefetchKey | null {
	if (item.type === "new-session") return "new-session";
	if (item.settingsTab) return "settings";
	if (item.workspaceView) return "workspace";
	if (item.path === "/abilities" || item.path === "/skills" || item.path === "/plugins") return "/abilities";
	if (item.path === "/agents") return "/agents";
	if (item.path === "/automation") return "/automation";
	if (item.path === "/batch-tasks") return "/batch-tasks";
	if (item.path === "/knowledge") return "/knowledge";
	if (item.path === "/scenes") return "/scenes";
	return null;
}

export function commandMenuActionPrefetchKey(kind: string): PrefetchKey | null {
	if (kind === "openSettingsSection") return "settings";
	if (kind === "openAbilities") return "/abilities";
	if (kind === "openWorkspaceView") return "workspace";
	return null;
}

function prefetchKey(key: PrefetchKey): void {
	void LOADERS[key]().catch(() => {
		// 预取失败无需上报：真正导航时 React.lazy 会重试并走正常错误路径。
	});
}

/**
 * Next.js / webpack 同款后台队列：每个 idle 切片只拉一个 chunk。
 * `timeout` 是最迟执行时限，保证忙时也会预取，而不是「空闲则立刻连打」。
 */
export function scheduleIdleCallback(callback: () => void, timeoutMs: number): () => void {
	if (typeof requestIdleCallback === "function") {
		const id = requestIdleCallback(callback, { timeout: timeoutMs });
		return () => cancelIdleCallback(id);
	}
	const id = globalThis.setTimeout(callback, timeoutMs);
	return () => globalThis.clearTimeout(id);
}

export function prefetchIdleRoutes(): () => void {
	for (const key of PINNED_PREFETCH_KEYS) prefetchKey(key);

	let cancelled = false;
	let index = 0;
	let cancelScheduled: (() => void) | null = null;

	const step = (): void => {
		if (cancelled || index >= IDLE_PREFETCH_KEYS.length) return;
		const key = IDLE_PREFETCH_KEYS[index];
		index += 1;
		if (key) prefetchKey(key);
		if (index < IDLE_PREFETCH_KEYS.length) {
			cancelScheduled = scheduleIdleCallback(step, IDLE_PREFETCH_STEP_MS);
		}
	};

	cancelScheduled = scheduleIdleCallback(step, IDLE_PREFETCH_FIRST_MS);
	return () => {
		cancelled = true;
		cancelScheduled?.();
	};
}

export function prefetchNavItem(item: SidebarNavItem): void {
	const key = navItemPrefetchKey(item);
	if (key) prefetchKey(key);
	if (item.settingsTab) prefetchSettingsTab(item.settingsTab);
}

export function prefetchCommandMenuAction(action: { readonly kind: string }): void {
	const key = commandMenuActionPrefetchKey(action.kind);
	if (key) prefetchKey(key);
}
