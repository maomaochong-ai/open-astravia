import type {
	ModelCallFrameCompositionContext,
	RuntimeToolDefinition,
	RuntimeToolExecutionRequest,
	RuntimeToolResult,
} from "@vetta/runtime-core/kernel";

export const CODING_AGENT_TOOL_INTERCEPTION_ORDER = {
	ecosystem: 100,
	plugin: 200,
	extension: 300,
} as const;

export interface ToolInterceptionBlock {
	readonly reason: string;
}

export interface ToolInterceptionContext {
	readonly tool: RuntimeToolDefinition;
	readonly request: RuntimeToolExecutionRequest;
	readonly frameContext: ModelCallFrameCompositionContext | undefined;
	readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolInterceptionBeforeResult {
	readonly input?: Readonly<Record<string, unknown>>;
	readonly block?: ToolInterceptionBlock;
	readonly state?: unknown;
}

export interface ToolInterceptionAfterContext extends ToolInterceptionContext {
	readonly result: RuntimeToolResult;
	readonly state: unknown;
}

export interface ToolInterceptionAfterResult {
	readonly result?: RuntimeToolResult;
	readonly block?: ToolInterceptionBlock;
}

export interface ToolInterceptionErrorContext extends ToolInterceptionContext {
	readonly error: unknown;
	readonly state: unknown;
}

export interface ToolInterceptionErrorResult {
	readonly error?: unknown;
}

export interface CodingAgentToolInterceptor {
	before?(context: ToolInterceptionContext): Promise<ToolInterceptionBeforeResult | undefined>;
	after?(context: ToolInterceptionAfterContext): Promise<ToolInterceptionAfterResult | undefined>;
	onError?(context: ToolInterceptionErrorContext): Promise<ToolInterceptionErrorResult | undefined>;
}
