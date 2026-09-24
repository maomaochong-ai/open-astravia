import type { ProjectEntry } from "./shared.js";

export type DesktopProxyProtocol = "http" | "https";

/** 读取形态：不含口令，只说明「存过没有」。 */
export interface DesktopProxyConfigData {
	enabled: boolean;
	protocol: DesktopProxyProtocol;
	host: string;
	port: number;
	username: string;
	passwordConfigured: boolean;
}

/** 写入形态：省略 `password` 表示沿用已存口令，空串表示清除。 */
export interface DesktopProxyConfigPatchData {
	enabled?: boolean;
	protocol?: DesktopProxyProtocol;
	host?: string;
	port?: number;
	username?: string;
	password?: string;
}

export interface DesktopConfigData {
	projects: ProjectEntry[];
	archivedProjects: ProjectEntry[];
	workspacePath: string;
	vettaAppPath?: string;
	defaultExecutionMode?: "sandbox" | "full-access";
	/** 新会话的默认工作模式（agent_mode 轴）。缺省视为 "work"；已存在会话不受它影响。 */
	defaultAgentMode?: string;
	sandbox?: {
		status: "unknown" | "available" | "unavailable";
		backend: "bundled-bwrap" | "system-bwrap" | "macos-seatbelt" | "windows-host" | null;
		platform: NodeJS.Platform;
		binaryPath?: string;
		reason?: string;
		details?: string;
		checkedAt?: number;
		features?: {
			readRoots: boolean;
			writeRoots: boolean;
			denyRead: boolean;
			denyWrite: boolean;
			tempRootIsolation: boolean;
			networkIsolation: boolean;
			processTreeKill: boolean;
			passiveProbe: boolean;
			activeProbe: boolean;
		};
	};
	linuxSandbox?: {
		status: "unknown" | "available" | "unavailable";
		backend: "bundled-bwrap" | "system-bwrap" | null;
		reason?: string;
		details?: string;
		checkedAt?: number;
	};
	debugMode?: boolean;
	/** 系统通知总开关（「通用设置」）。缺省视为开启。 */
	notificationsEnabled?: boolean;
	/** 实验性功能开关分组（「Agent配置 → 扩展功能」）。缺省视为全部开启。 */
	experimental?: {
		/** Vetta CLI 提示词开关。仅对桌面端对话会话生效，缺省开。 */
		vettaCli?: boolean;
		/** 输入预测开关。缺省关；批量/流转会话不适用。 */
		promptPrediction?: boolean;
		/** 适配通用 Agent Skill 开关。发现 ~/.agents/skills 与 <cwd>/.agents/skills，缺省开。 */
		agentSkills?: boolean;
	};
	/** 图片生成 Provider 偏好；空值表示自动选择。 */
	imageGeneration?: {
		textToImageProviderId?: string | null;
		textToImageModelId?: string | null;
		imageToImageProviderId?: string | null;
		imageToImageModelId?: string | null;
	};
	/** 默认「对话」项目的绝对路径（~/.vetta/conversation），主进程已确保目录存在。 */
	defaultConversationCwd?: string;
	/** im-gateway 自己的 cwd（~/.vetta/im-gateway/conversation），与桌面「对话」物理分家（ADR-0005）。 */
	defaultImConversationCwd?: string;
	/** 知识库加工设置。 */
	knowledgeBase?: {
		/** 知识库总开关。缺省开。关闭后禁用知识库工具、隐藏「知识检索」、停后台加工。 */
		enabled?: boolean;
		/** 轮询间隔（分钟）：3 / 5 / 10 / 30。缺省 5。后台加工跟随总开关。 */
		pollIntervalMinutes?: number;
		/** 加工会话使用的模型 key（provider/modelId）。缺省跟随默认模型。 */
		processingModelKey?: string;
		/** 加工模型的推理档位；未设置时按模型自身默认档。"off" 关闭思考。 */
		processingModelReasoningLevel?: string;
		/** 并发加工会话数（网络/LLM 限流）。缺省 3。 */
		agentConcurrency?: number;
		/** 并发本地 OCR 子进程数（CPU 限流）。缺省 1。 */
		ocrConcurrency?: number;
	};
	/** 知识库加工特殊项目的绝对路径（~/.vetta/knowledges/processing_records）。 */
	knowledgeProcessingCwd?: string;
	/** Appshot（全局手势捕获前台应用窗口为附件）设置。缺省不启用。 */
	appshot?: {
		/** 功能总开关。缺省 false。 */
		enabled?: boolean;
		/** 触发手势：同时按住左右两侧功能键。缺省 "both-shift"。 */
		gesture?: "both-shift" | "both-mod" | "both-alt";
	};
	/**
	 * 全局应用快捷键自定义绑定（设置 → 快捷键 → 全局快捷键）。
	 * 与 quickPanel 无关。
	 */
	shortcuts?: {
		/** actionId → 序列化组合键；缺省 id 表示使用默认键。 */
		bindings?: Record<string, string>;
	};
	/** 快捷面板（双击功能键唤出 Spotlight 式面板）设置。缺省不启用。 */
	quickPanel?: {
		/** 呼出触发：none=不启用；mod=双击 ⌘/Ctrl；alt=双击 ⌥/Alt；shift=双击 ⇧。缺省 none。 */
		trigger?: "none" | "mod" | "alt" | "shift";
		/** 发送后行为：foreground=打开主窗定位新会话；background=后台运行仅关面板。缺省 foreground。 */
		postSendBehavior?: "foreground" | "background";
	};
	/** 手机遥控本机：设备列表、云端中继开关与局域网端口。渲染层只读，改动走 remotePairing API。 */
	remoteControl?: {
		relayBaseUrl?: string;
		cloudEnabled: boolean;
		lanPort?: number;
		devices: Array<{
			id: string;
			name: string;
			mobileSecretHash: string;
			mobileIdentityKey?: string;
			createdAt: number;
			lastSeenAt?: number;
		}>;
	};
	/** 应用代理（「通用设置 → 网络代理」）。缺省不启用。 */
	proxy?: DesktopProxyConfigData;
}

/** `config.set` 的补丁形态：proxy 走补丁语义，其余字段整体覆盖。 */
export type DesktopConfigPatchData = Partial<Omit<DesktopConfigData, "proxy">> & {
	proxy?: DesktopProxyConfigPatchData;
};

export interface ShortcutsBindingsChangedEvent {
	bindings: Record<string, string>;
}

export interface DesktopConfigApi {
	get(): Promise<DesktopConfigData>;
	set(config: DesktopConfigPatchData): Promise<void>;
	/** 全局快捷键绑定被 GUI 或 Action 更新后广播。 */
	onShortcutsChanged(handler: (event: ShortcutsBindingsChangedEvent) => void): () => void;
	/**
	 * 项目列表被主进程侧的写入者（插件的 `official.projects.*`、Action 等）改动后广播，
	 * 无载荷：收到后自行重读配置。渲染进程自己发起的增删不依赖它。
	 */
	onProjectsChanged(handler: () => void): () => void;
}
