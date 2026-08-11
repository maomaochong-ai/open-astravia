import type { InstalledPlugin } from "@preload/api";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import {
	activeInputActionIdsAtom,
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	attachedPluginTabsAtom,
	filePreviewAtom,
	persistCurrentInputActionState,
	pluginInputActionsAtom,
	promptAttachmentAtom,
	setActivityPanelWidthAtom,
} from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import type {
	Disposable,
	PluginActivityTabContribution,
	PluginCardRendererContribution,
	PluginContext,
	PluginFilePreviewContribution,
	PluginGlobalSlotContribution,
	PluginImageRef,
	PluginInputActionContribution,
	PluginNavBadge,
	PluginNotifyOptions,
	PluginOpenActivityTabOptions,
	PluginPromptAttachment,
	PluginShortcutScopeContribution,
	PluginToolCallSlotContribution,
	PluginTurnCardContribution,
	PluginWorkspaceViewContribution,
} from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import { type ComponentType, createElement, type ReactNode } from "react";
import { router } from "../../../router";
import { explicitTabVisibility, withPluginTabVisibility } from "./attached-tabs";
import type { PluginAgentApiRegistration } from "./plugin-agent-context";
import { copyTextToClipboard, formatPluginErrorDetail, resolvePluginDisplayText } from "./plugin-host-apis";
import { activateInputActionIds } from "./plugin-input-action-state";
import type { PluginLocalContributions } from "./plugin-local-contributions";
import {
	createPluginPermissionApi,
	hasPluginPermission,
	noopDisposable,
	warnSkippedPluginContribution,
} from "./plugin-permissions";
import {
	assertPluginShortcutScopeKind,
	normalizePluginShortcutBindings,
	registerPluginShortcutScopeOnHost,
} from "./plugin-shortcut-scope";
import {
	isValidWorkspaceViewId,
	normalizePluginNavBadge,
	WORKSPACE_VIEW_ID_PATTERN,
	WORKSPACE_VIEW_ROUTE_PATH,
} from "./workspace-view-registry";

export interface CreatePluginUiApiOptions {
	plugin: InstalledPlugin;
	contributions: PluginLocalContributions;
	onChanged: () => void;
	disposers: Array<() => void>;
	agentContributions: PluginAgentApiRegistration;
}

function setPluginActivityTabVisible(pluginId: string, tabId: string, visible: boolean): boolean {
	const store = getDefaultStore();
	const cwd = store.get(activeSessionAtom)?.cwd ?? null;
	if (!cwd) return false;
	const next = withPluginTabVisibility(store.get(attachedPluginTabsAtom), cwd, `${pluginId}:${tabId}`, visible);
	if (next) store.set(attachedPluginTabsAtom, next);
	return true;
}

/**
 * Attach + activate a plugin's own activity tab and open the panel, driven
 * directly off the jotai store so it works regardless of whether the activity
 * panel component is currently mounted/expanded. Keyed by the active
 * conversation's cwd (same key the attach records use, see ADR-0026).
 */
function openPluginActivityTab(pluginId: string, tabId: string, width?: number | "max"): void {
	const store = getDefaultStore();
	const cwd = store.get(activeSessionAtom)?.cwd ?? null;
	if (!cwd) {
		console.warn("[plugin] openActivityTab: no active conversation cwd");
		return;
	}
	const key = `${pluginId}:${tabId}`;
	const alreadyAttached = explicitTabVisibility(store.get(attachedPluginTabsAtom).get(cwd) ?? [], key) === true;
	setPluginActivityTabVisible(pluginId, tabId, true);
	const active = new Map(store.get(activityPanelTabByProjectAtom));
	active.set(cwd, `plugin:${key}` as ActivityTabKey);
	store.set(activityPanelTabByProjectAtom, active);
	store.set(activityPanelOpenAtom, true);
	// width 只在首次 attach 时生效：插件 activate 里的 openActivityTab 会随
	// reload/热更新重放，不能每次都把用户手动拖出的面板宽度覆盖回初始值。
	if (width != null && !alreadyAttached) store.set(setActivityPanelWidthAtom, width);
}

/**
 * Map host-resolved `InstalledPlugin.iconUrl` into an activity-tab icon.
 * - `icon-[…]` / legacy Iconify `set:name` → class string for TabBar
 * - package path already resolved to `vetta-plugin://…` (or http/data) → `<img>`
 * Protocol stays host-private; plugins only see the opaque `iconUrl` string.
 */
function resolvePluginBrandIcon(iconUrl: string): ReactNode {
	const trimmed = iconUrl.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("icon-[")) return trimmed;
	// Iconify passthrough from manifest: `solar:star-bold` → Tailwind Iconify class.
	if (/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(trimmed) && !trimmed.includes("://")) {
		const sep = trimmed.indexOf(":");
		return `icon-[${trimmed.slice(0, sep)}--${trimmed.slice(sep + 1)}]`;
	}
	return createElement("img", {
		src: trimmed,
		alt: "",
		className: "h-3.5 w-3.5 object-contain",
		draggable: false,
	});
}

export function createPluginUiApi({
	plugin,
	contributions,
	onChanged,
	disposers,
	agentContributions,
}: CreatePluginUiApiOptions): PluginContext["ui"] {
	const { slots, filePreviews, activityTabs, inputActions, cardRenderers, toolCallSlots, turnCards, workspaceViews } =
		contributions;
	const registerGlobalSlot = (contribution: PluginGlobalSlotContribution): Disposable => {
		if (!hasPluginPermission(plugin, "ui.slot.global")) {
			warnSkippedPluginContribution(plugin, "ui.slot.global", "global slot");
			return noopDisposable;
		}
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Global slot id is required");
		}
		const component = contribution.component as ComponentType;
		if (typeof component !== "function" && typeof component !== "object") {
			throw new Error("Global slot component is invalid");
		}
		const normalized = {
			id: `${plugin.id}:${contribution.id}`,
			component,
		};
		slots.push(normalized);
		onChanged();
		const disposable = {
			dispose: () => {
				const index = slots.findIndex((slot) => slot.id === normalized.id);
				if (index >= 0) slots.splice(index, 1);
				onChanged();
			},
		};
		return disposable;
	};
	const registerFilePreview = (contribution: PluginFilePreviewContribution): Disposable => {
		if (!hasPluginPermission(plugin, "ui.slot.file-preview")) {
			warnSkippedPluginContribution(plugin, "ui.slot.file-preview", "file preview");
			return noopDisposable;
		}
		const extensions = Array.isArray(contribution.extensions)
			? contribution.extensions.map((ext) => ext.trim().toLowerCase()).filter(Boolean)
			: [];
		if (extensions.length === 0) {
			throw new Error("File preview must declare at least one extension");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("File preview component is invalid");
		}
		const normalized: PluginFilePreviewContribution = { extensions, component: contribution.component };
		filePreviews.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = filePreviews.indexOf(normalized);
				if (index >= 0) filePreviews.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerActivityTab = (contribution: PluginActivityTabContribution): Disposable => {
		if (!hasPluginPermission(plugin, "ui.slot.activity-tab")) {
			warnSkippedPluginContribution(plugin, "ui.slot.activity-tab", "activity tab");
			return noopDisposable;
		}
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Activity tab id is required");
		}
		if (typeof contribution.label !== "string" || contribution.label.trim().length === 0) {
			throw new Error("Activity tab label is required");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("Activity tab component is invalid");
		}
		if (
			contribution.retention !== undefined &&
			!(["active-only", "warm", "pinned"] as const).includes(contribution.retention)
		) {
			throw new Error("Activity tab retention is invalid");
		}
		const brandIcon =
			contribution.icon === undefined && plugin.iconUrl ? resolvePluginBrandIcon(plugin.iconUrl) : undefined;
		const normalized: PluginActivityTabContribution = {
			id: contribution.id,
			label: contribution.label,
			icon: contribution.icon ?? brandIcon,
			component: contribution.component,
			scope_use: contribution.scope_use,
			initiallyVisible: contribution.initiallyVisible,
			retention: contribution.retention,
			keepAliveWhenAvailable: contribution.keepAliveWhenAvailable,
		};
		activityTabs.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = activityTabs.indexOf(normalized);
				if (index >= 0) activityTabs.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerInputAction = (contribution: PluginInputActionContribution): Disposable => {
		createPluginPermissionApi(plugin).require("ui.slot.input-action");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Input action id is required");
		}
		if (typeof contribution.label !== "string" || contribution.label.trim().length === 0) {
			throw new Error("Input action label is required");
		}
		const userOnToggle = contribution.onToggle;
		const hardIsolation = contribution.hardIsolation === true;
		const namespacedId = `${plugin.id}:${contribution.id}`;
		if (hardIsolation) {
			// Register mode gate immediately so agent contributions stay stripped until toggle on (ADR-0041).
			void window.vetta.plugins.registerModeGate(plugin.id);
			// 会话恢复可能早于插件加载：若工作集已含本 action，立刻放行 contribution。
			if (getDefaultStore().get(activeInputActionIdsAtom).has(namespacedId)) {
				void window.vetta.plugins.setContributionMode(plugin.id, true);
			}
		}
		const normalized: PluginInputActionContribution = {
			id: namespacedId,
			label: contribution.label,
			icon: contribution.icon,
			defaultActive: contribution.defaultActive,
			requiresActiveTool: contribution.requiresActiveTool,
			scope_use: contribution.scope_use,
			hardIsolation,
			onToggle: (active) => {
				const veto = userOnToggle?.(active);
				if (veto === false) return false;
				if (hardIsolation) {
					void window.vetta.plugins.setContributionMode(plugin.id, active);
				}
			},
			decoratePrompt: contribution.decoratePrompt,
		};
		inputActions.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = inputActions.findIndex((action) => action.id === normalized.id);
				if (index >= 0) inputActions.splice(index, 1);
				if (hardIsolation) {
					void window.vetta.plugins.setContributionMode(plugin.id, false);
				}
				onChanged();
			},
		};
	};
	const registerCardRenderer = (contribution: PluginCardRendererContribution): Disposable => {
		createPluginPermissionApi(plugin).require("ui.slot.message");
		if (typeof contribution.type !== "string" || contribution.type.trim().length === 0) {
			throw new Error("Card renderer type is required");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("Card renderer component is invalid");
		}
		// The `type` is the plugin-owned, globally-unique key both the renderer and
		// the descriptor (from a tool's details.cards) agree on — NOT namespaced by
		// the host, unlike slot ids. The plugin is responsible for uniqueness.
		const normalized: PluginCardRendererContribution = {
			type: contribution.type,
			component: contribution.component,
			title: contribution.title,
			icon: contribution.icon,
			pendingFor: contribution.pendingFor,
		};
		cardRenderers.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = cardRenderers.findIndex((renderer) => renderer.type === normalized.type);
				if (index >= 0) cardRenderers.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerToolCallSlot = (contribution: PluginToolCallSlotContribution): Disposable => {
		createPluginPermissionApi(plugin).require("ui.slot.tool-call");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Tool-call slot id is required");
		}
		if (typeof contribution.toolName !== "string" || contribution.toolName.trim().length === 0) {
			throw new Error("Tool-call slot toolName is required");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("Tool-call slot component is invalid");
		}
		const normalized: PluginToolCallSlotContribution = {
			id: `${plugin.id}:${contribution.id}`,
			toolName: contribution.toolName.trim(),
			component: contribution.component,
		};
		toolCallSlots.push(normalized);
		agentContributions.onToolCallSlotRegistered(normalized.toolName);
		onChanged();
		return {
			dispose: () => {
				const index = toolCallSlots.findIndex((slot) => slot.id === normalized.id);
				if (index >= 0) toolCallSlots.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerTurnCard = (contribution: PluginTurnCardContribution): Disposable => {
		createPluginPermissionApi(plugin).require("ui.slot.turn-card");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Turn card id is required");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("Turn card component is invalid");
		}
		const normalized: PluginTurnCardContribution = {
			id: `${plugin.id}:${contribution.id}`,
			component: contribution.component,
			scope_use: contribution.scope_use,
		};
		turnCards.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = turnCards.findIndex((card) => card.id === normalized.id);
				if (index >= 0) turnCards.splice(index, 1);
				onChanged();
			},
		};
	};
	/**
	 * 工作区视图与其它插槽不同：它是**整页 surface**，由 `/workspace/$pluginId/$viewId`
	 * 路由挂载，并在侧边栏占一个可 pin / 可排序的导航位。因此 id 必须能安全进 URL，
	 * label 必须存在（导航项没有 fallback 文案可用）。
	 */
	const registerWorkspaceView = (contribution: PluginWorkspaceViewContribution): Disposable => {
		if (!hasPluginPermission(plugin, "ui.slot.workspace-view")) {
			warnSkippedPluginContribution(plugin, "ui.slot.workspace-view", "workspace view");
			return noopDisposable;
		}
		const viewId = typeof contribution.id === "string" ? contribution.id.trim() : "";
		if (!isValidWorkspaceViewId(viewId)) {
			throw new Error(
				`Workspace view id must match ${WORKSPACE_VIEW_ID_PATTERN.source} (got ${JSON.stringify(contribution.id)})`,
			);
		}
		const label = typeof contribution.label === "string" ? contribution.label.trim() : "";
		if (label.length === 0) {
			throw new Error("Workspace view label is required");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("Workspace view component is invalid");
		}
		if (workspaceViews.some((view) => view.id === viewId)) {
			throw new Error(`Workspace view id already registered: ${viewId}`);
		}
		// 角标认不出就当没有：它是导航项上的装饰，不该让整个视图注册失败。
		const badge = normalizePluginNavBadge(contribution.badge);
		const normalized: PluginWorkspaceViewContribution = {
			id: viewId,
			label,
			component: contribution.component,
			...(typeof contribution.icon === "string" && contribution.icon.trim()
				? { icon: contribution.icon.trim() }
				: {}),
			...(typeof contribution.description === "string" && contribution.description.trim()
				? { description: contribution.description.trim() }
				: {}),
			...(badge ? { badge } : {}),
			navOrder: Number.isFinite(contribution.navOrder) ? Number(contribution.navOrder) : 0,
		};
		workspaceViews.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = workspaceViews.findIndex((view) => view.id === normalized.id);
				if (index >= 0) workspaceViews.splice(index, 1);
				onChanged();
			},
		};
	};
	const openWorkspaceView = (viewId: string): void => {
		createPluginPermissionApi(plugin).require("ui.slot.workspace-view");
		const id = typeof viewId === "string" ? viewId.trim() : "";
		if (!workspaceViews.some((view) => view.id === id)) {
			console.warn(`[plugin:${plugin.id}] openWorkspaceView: unknown view ${JSON.stringify(viewId)}`);
			return;
		}
		void router.navigate({
			to: WORKSPACE_VIEW_ROUTE_PATH,
			params: { pluginId: plugin.id, viewId: id },
		});
	};
	const setWorkspaceViewBadge = (viewId: string, badge: PluginNavBadge | null): void => {
		createPluginPermissionApi(plugin).require("ui.slot.workspace-view");
		const id = typeof viewId === "string" ? viewId.trim() : "";
		const view = workspaceViews.find((candidate) => candidate.id === id);
		if (!view) {
			console.warn(`[plugin:${plugin.id}] setWorkspaceViewBadge: unknown view ${JSON.stringify(viewId)}`);
			return;
		}
		const next = badge === null ? undefined : normalizePluginNavBadge(badge);
		// 原地改注册项：重新注册会让整个整页 surface 重挂载，未读数变一下就丢掉
		// 视图内部状态。onChanged 只重新发布注册表快照。
		if (next) view.badge = next;
		else delete view.badge;
		onChanged();
	};
	const registerShortcutScope = (contribution: PluginShortcutScopeContribution): Disposable => {
		createPluginPermissionApi(plugin).require("ui.shortcuts.register");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Shortcut scope id is required");
		}
		const kind = assertPluginShortcutScopeKind(contribution.kind);
		const bindingsSource = contribution.bindings;
		const resolveBindings = () => {
			const raw = typeof bindingsSource === "function" ? bindingsSource() : bindingsSource;
			return normalizePluginShortcutBindings(raw);
		};
		const dispose = registerPluginShortcutScopeOnHost({
			scopeId: `${plugin.id}:${contribution.id.trim()}`,
			kind,
			exclusive: contribution.exclusive === true,
			enabled: typeof contribution.enabled === "function" ? contribution.enabled : undefined,
			getBindings: resolveBindings,
		}).dispose;
		disposers.push(dispose);
		return { dispose };
	};
	const openActivityTab = (tabId: string, options?: PluginOpenActivityTabOptions): void => {
		createPluginPermissionApi(plugin).require("ui.slot.activity-tab");
		if (typeof tabId !== "string" || tabId.trim().length === 0) {
			throw new Error("Activity tab id is required");
		}
		openPluginActivityTab(plugin.id, tabId, options?.width);
	};
	const setActivityTabVisible = (tabId: string, visible: boolean): void => {
		createPluginPermissionApi(plugin).require("ui.slot.activity-tab");
		if (typeof tabId !== "string" || tabId.trim().length === 0) {
			throw new Error("Activity tab id is required");
		}
		setPluginActivityTabVisible(plugin.id, tabId, visible === true);
	};
	const setActivityPanelWidth = (width: number | "max"): void => {
		createPluginPermissionApi(plugin).require("ui.slot.activity-tab");
		if (width !== "max" && !Number.isFinite(width)) {
			throw new Error('Activity panel width must be a finite number or "max"');
		}
		getDefaultStore().set(setActivityPanelWidthAtom, width);
	};
	const setPromptAttachment = (attachment: PluginPromptAttachment | null): void => {
		createPluginPermissionApi(plugin).require("ui.slot.input-action");
		const store = getDefaultStore();
		if (attachment === null) {
			if (store.get(promptAttachmentAtom)?.ownerPluginId === plugin.id) {
				store.set(promptAttachmentAtom, null);
			}
			return;
		}
		if (!attachment.id.trim() || !attachment.label.trim()) {
			throw new Error("Prompt attachment id and label are required");
		}
		// 逐条 label 由输入框直接渲染，先在边界上清掉空串/非字符串；清空后当作没给，
		// 回落到单条 label，而不是让输入框上出现一处空白。
		const labels = (attachment.labels ?? [])
			.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
			.map((entry) => entry.trim());
		store.set(promptAttachmentAtom, {
			...attachment,
			...(labels.length > 0 ? { labels } : { labels: undefined }),
			ownerPluginId: plugin.id,
		});
		// An attachment activates this plugin's input action so its hidden prompt
		// instructions are contributed to the next turn.
		const myActionIds = store
			.get(pluginInputActionsAtom)
			.filter((action) => action.pluginId === plugin.id)
			.map((action) => action.actionId);
		if (myActionIds.length > 0) {
			store.set(activeInputActionIdsAtom, (prev) => activateInputActionIds(prev, myActionIds));
			persistCurrentInputActionState(store.get(activeSessionAtom)?.sessionPath);
		}
	};
	const previewImage = (ref: PluginImageRef, group?: PluginImageRef[]): void => {
		createPluginPermissionApi(plugin).require("ui.slot.message");
		const toItem = (r: PluginImageRef) => {
			const ext = (r.mimeType ?? "image/png").split("/")[1] ?? "png";
			return { name: `${r.id}.${ext}`, url: r.url, kind: "image" as const, mime: r.mimeType };
		};
		// 提供图片组（且多于一张）时以图片组形态打开，起始定位到 ref；否则单图
		const images = (group ?? []).filter((r) => r.url);
		if (images.length > 1) {
			const index = Math.max(
				0,
				images.findIndex((r) => r.id === ref.id),
			);
			getDefaultStore().set(filePreviewAtom, { items: images.map(toItem), index });
		} else {
			getDefaultStore().set(filePreviewAtom, toItem(ref));
		}
	};
	const openPluginSettings = (): void => {
		// Host owns navigation; jump to the settings tab + this plugin's section
		// (existing `?section=plugin-<id>` deep-link scrolls + highlights it).
		void router.navigate({
			to: "/settings/$tab",
			params: { tab: "plugins" },
			search: { section: `plugin-${plugin.id}` },
		});
	};
	const captureRegion: PluginContext["ui"]["captureRegion"] = (rect, defaultFileName) => {
		createPluginPermissionApi(plugin).require("ui.slot.activity-tab");
		if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
			throw new Error("captureRegion() requires a finite rectangle with positive dimensions");
		}
		if (defaultFileName.trim().length === 0) {
			throw new Error("captureRegion() default file name is required");
		}
		return window.vetta.window.captureRegion(rect, defaultFileName);
	};
	const copyImage: PluginContext["ui"]["copyImage"] = (dataUrl) => {
		if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
			throw new Error("copyImage() requires a data:image/... URL");
		}
		return window.vetta.clipboard.writeImage(dataUrl);
	};
	const openExternal: PluginContext["ui"]["openExternal"] = async (url) => {
		createPluginPermissionApi(plugin).require("shell.openExternal");
		// 主进程还会再挡一次协议，这里先挡是为了给插件一条能读懂的错误——而不是
		// 让它拿到一个来自 IPC 深处的 "Unsupported external URL protocol"。
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error(`openExternal() requires an absolute URL, got: ${String(url)}`);
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error(`openExternal() only accepts http/https URLs, got: ${parsed.protocol}`);
		}
		await window.vetta.shell.openExternal(parsed.toString());
	};
	const notify = (options: PluginNotifyOptions): void => {
		if (options == null || typeof options !== "object" || typeof options.message !== "string") {
			throw new Error("notify() requires { message: string }");
		}
		const message = options.message.trim();
		if (message.length === 0) {
			throw new Error("notify() message must be non-empty");
		}
		const hasError = options.error !== undefined;
		const variant = options.variant ?? (hasError ? "error" : "info");
		// 清单里的 name 通常是 `%plugin.name%` 这种 catalog 键，直接塞进 toast 会原样显示。
		const title = resolvePluginDisplayText(plugin, options.title?.trim() || plugin.name);
		const detail = hasError ? formatPluginErrorDetail(plugin, options.error) : null;
		const durationMs = options.durationMs ?? (hasError ? 0 : undefined);
		showToast({
			variant,
			title,
			message,
			durationMs,
			action: detail
				? {
						label: "复制堆栈",
						onClick: () => {
							void copyTextToClipboard(detail).then((ok) => {
								showToast({
									variant: ok ? "success" : "warning",
									message: ok ? "错误堆栈已复制到剪贴板" : "复制失败，请手动从控制台复制",
									durationMs: 2500,
								});
							});
						},
					}
				: undefined,
		});
		if (detail) {
			console.error(`[plugin:${plugin.id}] ${message}\n${detail}`);
		}
	};

	return {
		registerGlobalSlot,
		registerFilePreview,
		registerActivityTab,
		registerInputAction,
		registerCardRenderer,
		registerToolCallSlot,
		registerTurnCard,
		registerWorkspaceView,
		openWorkspaceView,
		setWorkspaceViewBadge,
		registerShortcutScope,
		openActivityTab,
		setActivityTabVisible,
		setActivityPanelWidth,
		setPromptAttachment,
		previewImage,
		openPluginSettings,
		captureRegion,
		copyImage,
		openExternal,
		notify,
	};
}
