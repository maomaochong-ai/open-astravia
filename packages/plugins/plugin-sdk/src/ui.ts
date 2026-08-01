import type { ComponentType, ReactNode } from "react";
import type { ConversationMessage } from "./conversation.js";
import type { Disposable } from "./disposable.js";
import type { PluginImageRef } from "./images.js";
import type { PluginPromptAttachment } from "./prompt-attachment.js";
import type { ConversationScenario } from "./scenario.js";

export interface PluginGlobalSlotContribution {
	id: string;
	component: ComponentType;
}

export interface PluginAudioMetadata {
	/** Embedded title; preview renderers should fall back to file.name. */
	title?: string;
	artist?: string;
	/** Embedded cover art as a Data URL when available. */
	coverDataUrl?: string;
}

export interface PluginPreviewUrlOptions {
	/** Optional media hint for ambiguous containers such as webm. */
	mediaKind?: "audio" | "video";
}

/**
 * The file handed to a file-preview plugin component. The host does NOT
 * pre-read or guess encoding — the plugin decides whether to read text or
 * bytes. `path` is also exposed for plugins that prefer native fetch.
 */
export interface PluginPreviewFile {
	path: string | null;
	name: string;
	extension: string;
	mime: string;
	size: number;
	/** Read the file as a UTF-8 string. */
	readText(): Promise<string>;
	/** Read the raw file bytes. */
	readBytes(): Promise<ArrayBuffer>;
	/** A fetchable streaming URL for the file (Range-capable). */
	getUrl(options?: PluginPreviewUrlOptions): string;
	/**
	 * Subscribe to on-disk changes of this file. The listener fires (debounced
	 * by the host) whenever the file's contents change, letting previews update
	 * live. Returns a Disposable; call dispose() to stop watching. A no-op for
	 * files without a real path (url-only sources).
	 */
	watch(listener: () => void): Disposable;
	/**
	 * Host-provided audio metadata for local media files. Returns null when the
	 * host cannot provide metadata, e.g. url-only sources or unsupported files.
	 */
	getAudioMetadata?(): Promise<PluginAudioMetadata | null>;
}

export interface PluginFilePreviewProps {
	file: PluginPreviewFile;
}

export interface PluginFilePreviewContribution {
	/** Lower-case extensions without the dot, e.g. ["svg"]. */
	extensions: string[];
	component: ComponentType<PluginFilePreviewProps>;
}

/**
 * An activity-panel tab contributed by a plugin. Registering only adds the
 * tab to the "addable pool" — it renders only after the user attaches it in
 * the activity panel (scoped by session cwd).
 */
export interface PluginActivityTabContribution {
	id: string;
	label: string;
	/** Tab icon as a React node (not an iconify class string). */
	icon?: ReactNode;
	component: ComponentType;
	/**
	 * 允许该标签卡出现的对话场景 slug 列表（镜像工具的 scope_use）。**fail-closed**：
	 * 未声明/空数组 = 任何会话都不显示；声明后仅在列出的场景里出现（如
	 * `["project", "conversation"]`）。会话页插槽据此随对话类型显隐。
	 */
	scope_use?: readonly ConversationScenario[];
	/**
	 * 注册后是否默认在标签栏里（缺省 `true`）。声明 `false` 表示「出现条件由我
	 * 自己决定」——注册只是入池，之后由 {@link PluginUiApi.setActivityTabVisible}
	 * 或 {@link PluginUiApi.openActivityTab} 决定何时上栏（如 git 只在仓库目录、
	 * 工作台跟随输入栏 toggle）。无论哪种，用户仍可用减号手动隐藏。
	 */
	initiallyVisible?: boolean;
}

/** Options for {@link PluginUiApi.openActivityTab}. */
export interface PluginOpenActivityTabOptions {
	/**
	 * Desired panel width as it opens: a pixel number, or `"max"` for the widest
	 * the current window allows. The host clamps to its min/max bounds. Omit to
	 * keep the user's current width.
	 */
	width?: number | "max";
}

export interface PluginCaptureRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Decoration a plugin contributes to the next outgoing prompt while its input
 * action is active. `metadata` is shallow-merged into the prompt request and
 * `instructions` are appended as hidden, model-visible guidance.
 */
export interface PluginPromptDecoration {
	metadata?: Record<string, unknown>;
	/** Hidden plugin-owned instructions appended to the next agent turn. */
	instructions?: string[];
}

/**
 * An action button shown in a row beneath the AI input bar. Rendered as a
 * toggle: clicking activates, clicking again deactivates. While active, the
 * host calls `decoratePrompt()` before each send and merges the returned
 * metadata into the outgoing prompt request. The plugin owns any side state
 * (it is the same Module Federation instance as its other slots).
 */
export interface PluginInputActionContribution {
	id: string;
	label: string;
	/** Button icon as a React node (not an iconify class string). */
	icon?: ReactNode;
	/** Whether the action begins in the active state. Defaults to false. */
	defaultActive?: boolean;
	/**
	 * 该输入动作所依赖的 agent 工具名。设置后，仅当该工具在当前会话处于激活（按工具的
	 * scope_use 解析）时才显示这个 badge——避免在工具被场景屏蔽（如批量任务）时仍显示一个
	 * 点了也无效的开关。不设则始终显示。例如「图像生成」设为 "generate_image"。
	 */
	requiresActiveTool?: string;
	/**
	 * 允许该 toggle 出现的对话场景 slug 列表（镜像工具的 scope_use）。**fail-closed**：
	 * 未声明/空数组 = 任何会话都不显示；声明后仅在列出的场景里出现。与 `requiresActiveTool`
	 * 取「与」：两者都满足才显示。
	 */
	scope_use?: readonly ConversationScenario[];
	/**
	 * When true, this plugin's agent contributions (tools / skills / MCP /
	 * systemPrompt) and Activity Tabs are hard-isolated: inactive until this
	 * toggle is on (ADR-0041, knowledgeMode-style). Default false.
	 */
	hardIsolation?: boolean;
	/**
	 * Fired when the user toggles the action; `active` is the new state. Return
	 * `false` when `active` is true to VETO the activation (e.g. the plugin needs
	 * configuration first) — the toggle stays off. Deactivation can't be vetoed.
	 */
	onToggle?(active: boolean): boolean | void;
	/**
	 * Called by the host before sending while the action is active. The
	 * returned metadata is merged into the outgoing prompt request.
	 */
	decoratePrompt?(): PluginPromptDecoration | void;
}

/**
 * A declarative, serializable descriptor for one card rendered beneath a
 * message. `type` selects a registered card renderer; `key` drives cross-turn
 * dedup (same key across turns = one logical card, shown only under its latest
 * anchor); `payload` carries STABLE REFERENCES (e.g. image ids), not a content
 * snapshot — the renderer resolves live state from it. `title`/`icon` label the
 * card's tab (override the renderer's registration defaults). Rides a tool
 * result's out-of-band `details.cards`; crosses the agent→host boundary, so
 * `icon` is an icon-symbol string, not a node.
 */
export interface CardDescriptor {
	type: string;
	key?: string;
	payload?: unknown;
	title?: string;
	icon?: string;
}

/** A pending (in-flight) tool call handed to a renderer's `pendingFor`. */
export interface PluginPendingToolCall {
	toolName: string;
	args: Record<string, unknown>;
}

/**
 * Props for a card renderer. `descriptor` is the card's data; `pending` is true
 * while it was synthesized from an in-flight tool (render a skeleton); `message`
 * is the anchoring conversation message.
 */
export interface PluginCardProps {
	descriptor: CardDescriptor;
	pending: boolean;
	message: ConversationMessage;
}

/**
 * A card renderer registered by a plugin, keyed by `type`. A descriptor whose
 * `type` matches is rendered by `component`. `title`/`icon` are the default tab
 * label/icon (a descriptor may override `title`). `pendingFor`, given an
 * in-flight tool call, returns a provisional descriptor so a skeleton card
 * appears (and claims a tab) before the tool's result lands — or null when this
 * renderer doesn't handle that tool. The `type` must be globally unique across
 * plugins (convention: prefix with the plugin id, e.g. "image-gen:preview").
 */
export interface PluginCardRendererContribution {
	type: string;
	component: ComponentType<PluginCardProps>;
	title?: string;
	/** Default tab icon as a React node (not an iconify class string). */
	icon?: ReactNode;
	pendingFor?: (toolCall: PluginPendingToolCall) => CardDescriptor | null;
}

/** A tool call handed to a tool-call slot renderer. */
export interface PluginToolCallSlotToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	status: "pending" | "success" | "error";
	result?: string;
	isError?: boolean;
}

export interface PluginToolCallSlotProps {
	toolCall: PluginToolCallSlotToolCall;
}

/**
 * A component that **replaces the host's default inline transcript rendering**
 * for a specific tool (matched by `toolName`; first registered renderer wins).
 * This is how a plugin renders rich UI for its OWN agent tool's output — plugin
 * tools cannot emit `details.cards`, so the message card system (registerCardRenderer)
 * does not serve them; the tool-call slot does.
 */
export interface PluginToolCallSlotContribution {
	id: string;
	toolName: string;
	component: ComponentType<PluginToolCallSlotProps>;
}

/**
 * A card rendered at the bottom of the message list for the LATEST turn — NOT
 * bound to a tool call. The host mounts `component` in the footer slot and
 * re-mounts it each session/turn; the plugin owns visibility entirely (it reads
 * live state via SDK hooks — `useActiveConversation`, `useConversationMessages`,
 * `ctx.conversation.on("turn-end")` — and returns `null` to render nothing,
 * e.g. git renders only inside a repo that has changes). `scope_use` gates which
 * conversation scenarios it may appear in (**fail-closed**, mirrors the other
 * slots). `id` must be unique within the plugin.
 */
export interface PluginTurnCardContribution {
	id: string;
	component: ComponentType;
	/**
	 * 允许该 turn 卡出现的对话场景 slug 列表（镜像其它插槽的 scope_use）。**fail-closed**：
	 * 未声明/空数组 = 任何会话都不显示；声明后仅在列出的场景里出现（如 `["project"]`）。
	 */
	scope_use?: readonly ConversationScenario[];
}

/**
 * Options for {@link PluginUiApi.notify}. Surfaces a host toast so users can
 * see plugin failures without opening DevTools.
 */
export interface PluginNotifyOptions {
	/** Toast body. Required even when `error` is set (user-facing summary). */
	message: string;
	/** Defaults to plugin display name when omitted. */
	title?: string;
	/** Defaults to `"info"`; when `error` is set and variant omitted, host uses `"error"`. */
	variant?: "info" | "success" | "warning" | "error";
	/**
	 * Optional failure cause. Host formats message + stack and adds a
	 * "复制堆栈" action so the user can paste it into bug reports / chat.
	 */
	error?: unknown;
	/**
	 * Auto-dismiss delay in ms. `0` keeps the toast until dismissed.
	 * Defaults: sticky (`0`) when `error` is present, otherwise host default (~4s).
	 */
	durationMs?: number;
}

export interface PluginUiApi {
	registerGlobalSlot(contribution: PluginGlobalSlotContribution): Disposable;
	/**
	 * Register a preview component keyed by file extension. The host dispatches
	 * registered extensions before its built-in fallback renderers; first
	 * registrant wins on conflict.
	 */
	registerFilePreview(contribution: PluginFilePreviewContribution): Disposable;
	/**
	 * Register an activity-panel tab into the addable pool. The user attaches
	 * it manually via the panel's "+" picker; attach records are keyed by the
	 * session cwd.
	 */
	registerActivityTab(contribution: PluginActivityTabContribution): Disposable;
	/**
	 * Register a toggle action shown beneath the AI input bar. While active,
	 * its `decoratePrompt()` annotates the next outgoing prompt.
	 */
	registerInputAction(contribution: PluginInputActionContribution): Disposable;
	/**
	 * Register a card renderer keyed by `type`. Cards rendered beneath a message
	 * come from tool results' out-of-band `details.cards` (or `pendingFor` for
	 * in-flight tools); the host resolves each card's `type` to a registered
	 * renderer. Multiple cards under one message are shown as a tab-switcher
	 * ("收纳") or a flat list.
	 */
	registerCardRenderer(contribution: PluginCardRendererContribution): Disposable;
	/**
	 * Register a renderer that replaces the host's default inline transcript UI
	 * for a tool call (matched by `toolName`). The complement to card renderers:
	 * use it to render UI for a plugin's own agent tool output.
	 */
	registerToolCallSlot(contribution: PluginToolCallSlotContribution): Disposable;
	/**
	 * Register a card rendered at the bottom of the message list for the latest
	 * turn — NOT bound to a tool call. The host mounts the component in the
	 * footer slot; the plugin owns visibility (return `null` to render nothing,
	 * e.g. git renders only in a repo with changes). Gated by `scope_use`
	 * (fail-closed). Needs the `ui.slot.turn-card` permission.
	 */
	registerTurnCard(contribution: PluginTurnCardContribution): Disposable;
	/**
	 * Programmatically attach (if needed) and activate one of this plugin's
	 * own activity tabs in the current conversation's activity panel. `tabId`
	 * is the contribution id passed to registerActivityTab. Any payload (e.g.
	 * which image to edit) is passed via the plugin's own in-memory state.
	 *
	 * Pass `options.width` to size the panel as it opens — a pixel number, or
	 * `"max"` to expand it to the widest the current window allows (the host
	 * still clamps to its min/max and auto-hides the sidebar when needed). Omit
	 * to leave the user's current width untouched.
	 */
	openActivityTab(tabId: string, options?: PluginOpenActivityTabOptions): void;
	/**
	 * 把本插件的某个活动面板标签卡在当前会话里上栏 / 下栏，**不激活也不展开
	 * 面板**——`openActivityTab` 是「用户此刻要看它」，这个是「它现在该不该在
	 * 栏里」。配合 `initiallyVisible: false` 使用，插件即可完全掌握自己标签卡的
	 * 出现条件（如 git 只在仓库目录里上栏、工作台跟随输入栏 toggle）。
	 *
	 * 上栏记录按会话 cwd 持久化（ADR-0026），所以只需在条件变化时调用一次；
	 * 用户随后用减号手动隐藏的结果不会被重复调用覆盖。当前没有活动会话时为
	 * no-op（无处记录），插件应在会话就绪后重新判定。
	 */
	setActivityTabVisible(tabId: string, visible: boolean): void;
	/**
	 * 直接设置活动面板宽度：像素值，或 `"max"` 表示当前窗口下的最大宽度（宿主仍
	 * 会夹到自己的 min/max 内，必要时自动收起侧边栏）。
	 *
	 * 与 `openActivityTab(id, { width })` 的区别：那里的宽度只在标签卡首次 attach
	 * 时生效（避免 activate 重放覆盖用户手拖的宽度）；这个是命令式的，每次调用都
	 * 生效，供插件在自己的标签卡被激活、进入某种视图时按需调整。用户随后仍可拖动。
	 */
	setActivityPanelWidth(width: number | "max"): void;
	/**
	 * Bind or clear plugin-owned one-shot context for the next outgoing prompt.
	 * The host renders its label/icon, merges metadata and hidden instructions,
	 * then clears it after send or when the user closes the capsule.
	 */
	setPromptAttachment(attachment: PluginPromptAttachment | null): void;
	/**
	 * Open the host's global full-screen image previewer for the given image.
	 * Only the image reference (id/url) crosses over — bytes stay out-of-band.
	 *
	 * Pass `group` (e.g. all images of the message) to open as an image group:
	 * the previewer shows a thumbnail strip + arrows and starts at `ref`.
	 */
	previewImage(ref: PluginImageRef, group?: PluginImageRef[]): void;
	/**
	 * Open the app settings, scrolled to and highlighting THIS plugin's own
	 * settings section (e.g. so the user can fill in a required API key/model).
	 * The host owns the navigation; the plugin only asks to jump there.
	 */
	openPluginSettings(): void;
	/**
	 * Capture a rectangle in the current Vetta window and open the host save
	 * dialog. Coordinates use renderer DIP values such as getBoundingClientRect().
	 * Requires `ui.slot.activity-tab`.
	 */
	captureRegion(rect: PluginCaptureRegion, defaultFileName: string): Promise<string | null>;
	/**
	 * Copy an image to the system clipboard. Takes a `data:image/...;base64,`
	 * URL and goes through the native clipboard, so it does not depend on the
	 * renderer's `ClipboardItem` support. No permission required — the plugin
	 * can only write what it already rendered.
	 */
	copyImage(dataUrl: string): Promise<void>;
	/**
	 * Show a global toast in the host UI (bottom-right). No permission required.
	 * Prefer this over swallowing errors into opaque UI copy: pass `error` so
	 * the host attaches a one-click "copy stack" action for the user.
	 *
	 * Capture `ctx.ui.notify` in `activate` if React components need it
	 * (components do not receive `ctx`).
	 */
	notify(options: PluginNotifyOptions): void;
}
