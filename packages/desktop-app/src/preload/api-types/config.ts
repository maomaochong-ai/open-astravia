import type { ProjectEntry } from "./shared.js";

export interface DesktopConfigData {
	projects: ProjectEntry[];
	archivedProjects: ProjectEntry[];
	workspacePath: string;
	astraviaAppPath?: string;
	defaultExecutionMode?: "sandbox" | "full-access";
	/** 工作模式（agent_mode 轴，见 ADR-0046）。缺省视为 "work"。 */
	agentMode?: "work" | "coding";
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
		/** Astravia CLI 提示词开关。仅对桌面端对话会话生效，缺省开。 */
		astraviaCli?: boolean;
		/** 输入预测开关。缺省关；批量/流转会话不适用。 */
		promptPrediction?: boolean;
		/** 适配通用 Agent Skill 开关。发现 ~/.agents/skills 与 <cwd>/.agents/skills，缺省开。 */
		agentSkills?: boolean;
	};
	/** 默认「对话」项目的绝对路径（~/.astravia/conversation），主进程已确保目录存在。 */
	defaultConversationCwd?: string;
	/** im-gateway 自己的 cwd（~/.astravia/im-gateway/conversation），与桌面「对话」物理分家（ADR-0005）。 */
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
	/** 知识库加工特殊项目的绝对路径（~/.astravia/knowledges/processing_records）。 */
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
	/** 数据库能力配置（B2.5/B2.10）。 */
	database?: {
		/** AI 对话会话创建时注入连接 schema 上下文（感知）。缺省关。 */
		schemaInjection?: boolean;
		/** 感知范围（B2.10-W4-①）：schemaInjection 开启时按此范围过滤注入；缺省 all（全部连接全表）。 */
		schemaInjectionScope?: SchemaInjectionScopeData;
		/** AI 访问开关（访问）：控制 dbx MCP 工具是否注册进对话工具集。缺省关。 */
		dbxToolEnabled?: boolean;
		/** 连接环境标记（W4-②）：连接名 → "prod" | "dev"，缺省 dev。 */
		connectionEnv?: Record<string, "prod" | "dev">;
		/** 生产写授权（W4-②）：连接名 → 已显式授权允许生产写操作。 */
		prodWriteApproved?: Record<string, boolean>;
		/** 安全执行模式（B3.1-①-B）：strict 所有连接写需授权（缺省）；relaxed 仅 prod 拦截。 */
		safetyMode?: "strict" | "relaxed";
		/** 查询结果行数上限（B3.1-②-A），缺省 100。 */
		rowLimit?: number;
		/** 查询执行超时毫秒（B3.1-②-B），缺省 30000。 */
		queryTimeoutMs?: number;
		/** 连接级「允许 AI 访问」白名单（B3.1-①-C）：连接名 → 允许（缺省按 connectionEnv：prod 关 / dev 开）。 */
		connectionAiAccess?: Record<string, boolean>;
	};
}

/**
 * 感知范围配置（B2.10-W4-①）：schemaInjection 开启时按此范围过滤注入；缺省 all（全部连接全表）。
 * scope=connections 时 connections 生效；scope=tables 时 tables 生效。
 */
export interface SchemaInjectionScopeData {
	scope: "all" | "connections" | "tables";
	/** scope=connections 时生效：连接名白名单。 */
	connections: string[];
	/** scope=tables 时生效：「连接.表」白名单。 */
	tables: Array<{ connection: string; table: string }>;
}

export interface ShortcutsBindingsChangedEvent {
	bindings: Record<string, string>;
}

export interface DesktopConfigApi {
	get(): Promise<DesktopConfigData>;
	set(config: Partial<DesktopConfigData>): Promise<void>;
	/** 全局快捷键绑定被 GUI 或 Action 更新后广播。 */
	onShortcutsChanged(handler: (event: ShortcutsBindingsChangedEvent) => void): () => void;
}
