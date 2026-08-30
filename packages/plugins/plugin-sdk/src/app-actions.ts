import type { PluginJsonSchema } from "./agent.js";
import type { Disposable } from "./disposable.js";

export type PluginAppActionEffect = "read" | "write" | "execute";

/** Model-facing routing guidance, not authorization or an execution policy. */
export interface PluginAppActionUsage {
	target: string;
	useWhen: string;
	avoidWhen: string;
	alternatives: string;
}

export interface PluginAppActionExample<TInput = unknown> {
	description: string;
	input: TInput;
}

export interface PluginAppActionHandlerContext<TInput = unknown> {
	invocationId: string;
	plugin: {
		id: string;
		actionId: string;
		settings: Readonly<Record<string, unknown>>;
	};
	input: TInput;
	signal: AbortSignal;
}

export type PluginAppActionHandler<TInput = unknown> = (
	context: PluginAppActionHandlerContext<TInput>,
) => unknown | Promise<unknown>;

export type PluginAppActionReadyHandler<TInput = unknown> = (
	context: PluginAppActionHandlerContext<TInput>,
) => void | Promise<void>;

/** 插件 Action 向宿主返回稳定错误码与可序列化详情。 */
export class PluginAppActionError extends Error {
	readonly code: string;
	readonly details?: unknown;

	constructor(code: string, message: string, details?: unknown) {
		super(message);
		this.name = "PluginAppActionError";
		this.code = code;
		this.details = details;
	}
}

export interface PluginAppActionApprovalPresentation {
	id: string;
	title: string;
	description: string;
}

export interface PluginAppActionApproval {
	/** 默认使用的宿主审批界面。 */
	defaultPresentation: string;
	/** 可用的宿主审批界面；仅官方插件可以声明。 */
	presentations: PluginAppActionApprovalPresentation[];
	/** 根据 input.operation 自动选择审批界面，不要求 Agent 传 approvalUi。 */
	presentationByOperation?: Record<string, string>;
	/** 某 operation 明确允许的附加审批界面；宿主仍会拒绝未列出的调用方选择。 */
	alternativePresentationsByOperation?: Record<string, string[]>;
}

export interface PluginAppActionRegistration<TInput = unknown> {
	/** 插件内局部 id；宿主公开为 `plugin.<pluginId>.<id>`。 */
	id: string;
	/** 可信官方插件可指定稳定公共 id；若 id 已被占用则后到者忽略（先注册为准）。 */
	publicId?: string;
	title: string;
	summary: string;
	description?: string;
	/** Returned by search and describe; exclusions are never positive search terms. */
	usage?: PluginAppActionUsage;
	keywords?: string[];
	effect: PluginAppActionEffect;
	/** 官方插件可引用宿主已有审批界面；不能关闭 effect 对应的审批。 */
	approval?: PluginAppActionApproval;
	inputSchema: PluginJsonSchema;
	examples?: PluginAppActionExample<TInput>[];
	timeoutMs?: number;
	/** 审批前业务就绪校验；失败时不会向用户弹出审批。 */
	assertReady?: PluginAppActionReadyHandler<TInput>;
	handler: PluginAppActionHandler<TInput>;
}

export interface PluginAppActionsApi {
	register<TInput = unknown>(registration: PluginAppActionRegistration<TInput>): Disposable;
}
