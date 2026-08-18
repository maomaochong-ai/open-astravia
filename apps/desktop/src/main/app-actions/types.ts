import type { ActionRpcErrorBody, JsonValue } from "@vetta/action-rpc";

export type { JsonValue } from "@vetta/action-rpc";

export type ActionAvailability = "headless" | "gui-main" | "gui-renderer";

export interface ActionExample {
	description: string;
	input: JsonValue;
}

export interface ActionInputParameter {
	name: string;
	type: string;
	required: boolean;
	description: string;
}

export interface ActionInputOperation {
	name: string;
	description: string;
	parameters: ActionInputParameter[];
}

export interface ActionInputSchema {
	description: string;
	operations?: ActionInputOperation[];
	/** 插件 Action 可直接暴露完整 JSON Schema；内置 Action 继续使用现有摘要结构。 */
	jsonSchema?: JsonValue;
}

export interface ActionApprovalPresentation {
	id: string;
	title: string;
	description: string;
}

export interface ActionApprovalMetadata {
	defaultPresentation: string;
	presentations: ActionApprovalPresentation[];
}

export interface ActionMetadata {
	id: string;
	domain: string;
	title: string;
	summary: string;
	availability: ActionAvailability;
	permission: string;
	/**
	 * 可选检索同义词/别名（中英文均可）。
	 * 供 `actions.search` 相关性匹配使用，不改变 run 语义。
	 */
	keywords?: string[];
	approval?: ActionApprovalMetadata;
	inputSchema: ActionInputSchema;
	examples: ActionExample[];
}

export interface ActionSearchResult {
	id: string;
	domain: string;
	title: string;
	summary: string;
	availability: ActionAvailability;
}

export interface ActionContext {
	source: "internal" | "local-server";
	requestId?: string;
	signal?: AbortSignal;
}

export interface ActionApprovalRequest {
	actionId: string;
	approvalPresentation: string;
	input: JsonValue;
	title: string;
	summary: string;
	permission: string;
}

export interface ActionApprovalDecision {
	approved: boolean;
	input?: JsonValue;
}

export interface ActionApprovalRequester {
	request(request: ActionApprovalRequest, signal?: AbortSignal): Promise<ActionApprovalDecision>;
}

export interface ActionDefinition extends ActionMetadata {
	/** 结构校验（同步）：schema / 字段类型与必填。 */
	validateInput: (input: unknown) => JsonValue;
	/**
	 * 业务就绪校验（可异步）：在结构校验之后、审批弹窗之前执行。
	 * 用于「编辑 / 删除 / 改状态」所引用的实体是否存在等，避免对不存在的数据弹出授权框。
	 * 用户在审批中改写 input 后会再次调用。
	 */
	assertReady?: (input: JsonValue, context: ActionContext) => Promise<void> | void;
	requiresApproval?: (input: JsonValue, context: ActionContext) => boolean;
	run: (input: JsonValue, context: ActionContext) => Promise<JsonValue> | JsonValue;
}

export type ActionErrorBody = ActionRpcErrorBody;

export class ActionError extends Error {
	code: string;
	details?: JsonValue;

	constructor(code: string, message: string, details?: JsonValue) {
		super(message);
		this.name = "ActionError";
		this.code = code;
		this.details = details;
	}
}
