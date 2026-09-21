import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import type { BottomPanelTabStatus } from "@vetta-org/theme-ui/bottom-panel";
import type { ComponentType, ReactNode } from "react";

/**
 * 底部面板的组件贡献定义。内置与插件同构，宿主只收集定义与可见性策略。
 *
 * 与活动面板 tab 定义（`activity-panel/registry/types.ts`）刻意有一处不同：
 * 这里没有「每帧返回 meta 的 useMeta」。底部面板同一个组件可以开多个实例
 * （两个终端），每帧 hook 拿不到实例身份；改名、换图标、状态点都由实例自己经
 * {@link BottomPanelHandle} 命令式上报，宿主只存一份 instanceId → meta。
 */
export interface BottomPanelComponentDefinition {
	/** 内置为稳定字符串（`terminal`），插件为 `plugin:<pluginId>:<componentId>`。 */
	readonly id: string;
	/** 「+」菜单里的相对顺序，缺省 100。 */
	readonly order?: number;
	readonly source: "builtin" | "plugin";
	readonly pluginId?: string;
	/** 插件展示名，供「+」菜单副标题。 */
	readonly pluginName?: string;
	/** 插件：允许出现的对话场景（fail-closed）。内置省略 = 不按场景过滤。 */
	readonly scope_use?: readonly ConversationScenario[];
	/** 同一会话里最多能开几个实例；缺省不限。 */
	readonly maxInstances?: number;
	/**
	 * 「+」菜单与新实例的初始 meta，已解析成最终文案（内置在定义 hook 里过 i18n，
	 * 插件由 `usePluginTextResolver` 解析）。实例上报 meta 后以实例的为准。
	 */
	readonly defaultMeta: BottomPanelTabMeta;
	/** 内容组件：零 props，经 {@link useBottomPanelInstance} 取实例上下文。 */
	readonly component: ComponentType;
}

export interface BottomPanelTabMeta {
	readonly label: string;
	/** iconify 类名或 React 节点。 */
	readonly icon?: ReactNode;
	readonly status?: BottomPanelTabStatus;
}

/** 关闭前裁决：宿主用自己的确认对话框呈现，贡献方只给文案。 */
export interface BottomPanelCloseConfirm {
	readonly title: string;
	readonly message: string;
	readonly confirmLabel?: string;
	readonly cancelLabel?: string;
	readonly destructive?: boolean;
}

export type BottomPanelCloseReason = "user-close-tab" | "user-close-panel" | "session-switch" | "app-quit";

export interface BottomPanelCloseRequest {
	readonly tabId: string;
	readonly reason: BottomPanelCloseReason;
}

/**
 * `true` 直接关，`false` 取消，返回文案则请宿主先确认一次。
 * 允许 async：终端要问主进程「还有活进程吗」，同步 boolean 会逼所有实现把状态镜像到 renderer。
 */
export type BottomPanelCloseDecision = boolean | BottomPanelCloseConfirm;

export type BottomPanelWillClose = (
	request: BottomPanelCloseRequest,
) => BottomPanelCloseDecision | Promise<BottomPanelCloseDecision>;

/** 实例控制面：内置终端与插件面板拿到的是同一个形状。 */
export interface BottomPanelHandle {
	readonly tabId: string;
	/** 面板作用域 cwd：本地绝对路径或 `ssh://<hostId>/<path>`。 */
	readonly cwd: string | null;
	/** 是否是所在分格的活动 tab 且面板未折叠。false 时应暂停轮询与动画。 */
	readonly active: boolean;
	setMeta(meta: Partial<BottomPanelTabMeta> | null): void;
	setCloseGuard(guard: BottomPanelWillClose | null): void;
	/** 写进持久化载荷，重开会话时原样交回。 */
	setPayload(payload: unknown): void;
}
