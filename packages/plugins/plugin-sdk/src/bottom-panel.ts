import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/** 空闲是静止灰点，活动是脉冲绿点；tab 与面板缩起后的 pill 用同一套状态。 */
export type PluginBottomPanelStatus = "idle" | "active";

export interface PluginBottomPanelMeta {
	/** Supports `%catalogKey%` i18n lookup, same as the contribution label. */
	label?: string;
	/** Tab icon as a React node or an iconify class string. */
	icon?: ReactNode;
	status?: PluginBottomPanelStatus;
}

/** 关闭前的确认文案。**宿主**用自己的对话框呈现——面板类 slot 不允许自己画浮层。 */
export interface PluginBottomPanelCloseConfirm {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** 展示为危险操作（会丢东西时用）。 */
	destructive?: boolean;
}

export type PluginBottomPanelCloseReason =
	| "user-close-tab"
	| "user-close-panel"
	| "session-switch"
	| "app-quit";

export interface PluginBottomPanelCloseRequest {
	instanceId: string;
	reason: PluginBottomPanelCloseReason;
}

/**
 * `true` 直接关，`false` 取消关闭，返回文案则请宿主先确认一次。
 *
 * 允许 async：真实判断往往要问后端（终端要问「还有活进程吗」）。宿主等不到决定时
 * **按需要确认处理**，不会静默关掉——丢东西的方向必须是保守的。
 */
export type PluginBottomPanelCloseDecision = boolean | PluginBottomPanelCloseConfirm;

/**
 * 请宿主开一个内置终端并替用户敲一条命令。
 *
 * 命令是**敲进交互式 shell** 的：跑完 shell 还在，用户能接着按上箭头重跑或自己继续敲；
 * 终端的交互、分屏、关闭前确认都由宿主负责，插件不用自己实现输出视图。
 */
export interface PluginBottomPanelTerminalRequest {
	/** 单行命令，原样敲进 shell 后回车。不能含换行或其他控制字符，最长 4096 字符。 */
	command: string;
	/**
	 * 在哪个目录里跑。必须是面板的 `cwd` 本身或它下面的目录（本地绝对路径或同一台主机的
	 * `ssh://` 路径）；省略即面板 `cwd`。
	 */
	cwd?: string;
	/** 终端 tab 的名字；省略则按目录名显示。 */
	label?: string;
}

export interface PluginBottomPanelContextValue {
	/** 这一个实例的 id。同一个面板可以开多份，靠它区分。 */
	instanceId: string;
	/**
	 * 面板所属会话的 cwd（本地绝对路径或 `ssh://<hostId>/<path>`）。
	 * 不要拿 useActiveConversation().cwd 代替：底部面板绑在自己的会话上。
	 */
	cwd: string | null;
	/** 是否是所在分格的活动 tab 且面板未折叠。false 时应暂停轮询与动画。 */
	active: boolean;
	/** 实时改名字、图标与状态点；传 null 回到注册时的默认 meta。 */
	setMeta(meta: PluginBottomPanelMeta | null): void;
	/** 装/撤关闭前裁决。传 null 表示「随便关」。 */
	setCloseGuard(
		guard:
			| ((request: PluginBottomPanelCloseRequest) =>
					| PluginBottomPanelCloseDecision
					| Promise<PluginBottomPanelCloseDecision>)
			| null,
	): void;
	/**
	 * 在本实例所在的格子里新开一个终端并替用户敲 `request.command`，返回新终端 tab 的
	 * instanceId（可交给 {@link revealInstance}）。需要 `terminal.run` 权限，缺权限、请求
	 * 不合规或当前会话开不了终端（本机缺终端支持）时**抛错**。
	 */
	openTerminal(request: PluginBottomPanelTerminalRequest): string;
	/**
	 * 把同一底部面板里的某个实例（如 {@link openTerminal} 开出的终端）切到前台并展开面板。
	 * 该实例已被关闭时返回 false。
	 */
	revealInstance(instanceId: string): boolean;
}

const NOOP_CONTEXT: PluginBottomPanelContextValue = {
	instanceId: "",
	cwd: null,
	active: false,
	setMeta: () => {},
	setCloseGuard: () => {},
	openTerminal: () => {
		throw new Error("useBottomPanel().openTerminal must be called inside a bottom panel");
	},
	revealInstance: () => false,
};

/**
 * Internal: the host wraps bottom-panel components in this context's Provider.
 * Module Federation shares this single SDK instance, so the value the host
 * provides is visible to plugin components.
 */
export const __BottomPanelContext = createContext<PluginBottomPanelContextValue>(NOOP_CONTEXT);

/** 当前底部面板实例的身份与控制面。 */
export function useBottomPanel(): PluginBottomPanelContextValue {
	return useContext(__BottomPanelContext);
}
