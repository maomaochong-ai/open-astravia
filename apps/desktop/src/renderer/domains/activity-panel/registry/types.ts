import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import type { ComponentType, ReactNode } from "react";

/** 活动面板 tab id：内置为稳定字符串，插件为 `plugin:<pluginId>:<tabId>`。 */
export type ActivityTabId = string;

/** Inactive component residency. Warm tabs participate in the bounded LRU cache. */
export type ActivityTabRetention = "active-only" | "warm" | "pinned";

/** 单帧元数据：`useMeta` 返回 null 表示本帧不参与候选。 */
export interface ActivityTabMeta {
	label: string;
	icon?: string | ReactNode;
	badge?: number;
}

/**
 * 统一 tab 贡献定义（内置与插件同构）。
 * Host 只收集 definition + 可见性策略，不理解业务条件。
 */
export interface ActivityTabDefinition {
	id: ActivityTabId;
	/** 默认相对顺序（用户拖拽 order 优先；未出现在 order 中的按此值再按注册序）。 */
	order?: number;
	/** 是否可被用户减号隐藏 / detach，默认 true。 */
	removable?: boolean;
	/**
	 * 无显式可见性记录时是否上栏。
	 * 插件 attach 三态用；内置默认 true，隐藏走 hiddenKeys。
	 */
	initiallyVisible?: boolean;
	/** 插件：允许出现的对话场景（fail-closed）。内置省略 = 不按场景过滤。 */
	scope_use?: readonly ConversationScenario[];
	source: "builtin" | "plugin";
	pluginId?: string;
	/** 插件展示名，供「+」菜单副标题。 */
	pluginName?: string;
	/**
	 * 贡献方 hook：在 MetaBridge 内调用。
	 * 返回 null = 本帧不进入候选（如 todo 为空、非 batch 项目）。
	 */
	useMeta: () => ActivityTabMeta | null;
	/** 内容组件：零 props，经 ActivityPanelContext 取 cwd 等。 */
	component: ComponentType;
	/**
	 * 未激活时的驻留策略。缺省 warm：访问后进入有界 LRU；pinned 始终驻留。
	 * 内部贡献优先使用此字段，新策略可在驻留服务中集中扩展。
	 */
	retention?: ActivityTabRetention;
	/**
	 * 插件 SDK 的兼容字段。true 映射为 pinned，false 映射为 active-only，
	 * 缺省则使用默认 warm 策略。
	 */
	keepAliveWhenAvailable?: boolean;
}

/** 解析后的栏条目（含 definition 引用，供内容区渲染）。 */
export interface ResolvedActivityTab {
	id: ActivityTabId;
	label: string;
	icon?: string | ReactNode;
	badge?: number;
	removable: boolean;
	source: "builtin" | "plugin";
	pluginId?: string;
	pluginName?: string;
	definition: ActivityTabDefinition;
}
