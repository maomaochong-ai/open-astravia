import type { Static, TSchema } from "@sinclair/typebox";
import type {
	AssistantMessage,
	ImageContent,
	LanguageModelStreamEvent,
	Message,
	ModelStreamResponse,
	TextContent,
	ToolCall,
	ToolResultMessage,
} from "@vetta/ai";

export interface AgentRunLimits {
	readonly maxModelCalls: number;
	readonly maxToolCalls: number;
	readonly maxRecoveryAttempts: number;
	readonly checkpointTimeoutMs: number;
	readonly deadlineMs?: number;
}

export type AgentRunStatus =
	| "completed"
	| "max_model_calls"
	| "max_tool_calls"
	| "recovery_exhausted"
	| "aborted"
	| "failed";

export interface AgentRunFailure {
	readonly code: string;
	readonly message: string;
}

export interface AgentRunResult {
	readonly status: AgentRunStatus;
	readonly messages: readonly Message[];
	readonly modelCalls: number;
	readonly toolCalls: number;
	readonly recoveryAttempts: number;
	readonly lastAssistantMessage?: AssistantMessage;
	readonly failure?: AgentRunFailure;
}

export interface AgentRun {
	readonly events: AsyncIterable<AgentExecutionEvent>;
	readonly result: Promise<AgentRunResult>;
}

export interface AgentModelCallContext {
	readonly modelCallIndex: number;
	readonly messages: readonly Message[];
	readonly tools: readonly RuntimeToolDefinition[];
	readonly signal: AbortSignal;
}

export interface ResolvedModelCall {
	readonly callId: string;
	readonly snapshotId: string;
	readonly response: ModelStreamResponse;
}

export interface ToolResolutionContext {
	readonly modelCallIndex: number;
	readonly messages: readonly Message[];
	readonly signal: AbortSignal;
}

export interface RuntimeToolExecutionContext<TDetails = unknown> {
	readonly toolCallId: string;
	readonly messages: readonly Message[];
	readonly signal: AbortSignal;
	readonly onUpdate: (update: RuntimeToolResult<TDetails>) => void;
	readonly reportPhase: (label: string) => void;
}

export interface RuntimeToolResult<TDetails = unknown> {
	readonly content: readonly (TextContent | ImageContent)[];
	readonly details: TDetails;
}

export interface RuntimeToolDefinition<TSchemaDef extends TSchema = TSchema, TDetails = unknown> {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: TSchemaDef;
	/** Optional host validator for standard JSON Schema or other schema dialects. */
	readonly validateInput?: (input: ToolCall["arguments"]) => Static<TSchemaDef>;
	execute(
		input: Static<TSchemaDef>,
		context: RuntimeToolExecutionContext<TDetails>,
	): Promise<RuntimeToolResult<TDetails>>;
}

export interface AgentToolPhase {
	readonly label: string;
	readonly atMs: number;
}

export type AgentPendingInputKind = "steering" | "continuation";

export interface AgentInputCollectionContext {
	readonly modelCallIndex: number;
	readonly messages: readonly Message[];
	readonly signal: AbortSignal;
}

export type AgentInputCollector = (context: AgentInputCollectionContext) => Promise<readonly Message[]>;

export interface ToolAuthorizationRequest {
	readonly call: ToolCall;
	readonly tool: RuntimeToolDefinition;
	readonly modelCallIndex: number;
	readonly messages: readonly Message[];
	readonly signal: AbortSignal;
}

export interface AgentToolPolicy {
	authorize(request: ToolAuthorizationRequest): Promise<void>;
}

export type AgentCheckpointReason = "model_call" | "assistant_result" | "assistant_error";

export interface AgentCheckpointRequest {
	readonly reason: AgentCheckpointReason;
	readonly messages: readonly Message[];
	readonly modelCallIndex: number;
	readonly recoveryAttempt: number;
	readonly assistantMessage?: AssistantMessage;
}

export interface AgentCheckpointResult {
	/** Message view used for the current model call or retry decision. */
	readonly messages?: readonly Message[];
	/** Durable in-run context used by subsequent model calls. */
	readonly contextMessages?: readonly Message[];
	readonly retry?: boolean;
}

export type AgentCheckpointHandler = (
	request: AgentCheckpointRequest,
	signal: AbortSignal,
) => Promise<AgentCheckpointResult | undefined>;

export interface AgentTurnRequest {
	readonly messages: readonly Message[];
	readonly resolveModelCall: (context: AgentModelCallContext) => Promise<ResolvedModelCall>;
	readonly resolveTools: (context: ToolResolutionContext) => Promise<readonly RuntimeToolDefinition[]>;
	readonly toolPolicy: AgentToolPolicy;
	readonly checkpoint?: AgentCheckpointHandler;
	readonly takeSteeringMessages?: AgentInputCollector;
	readonly takeContinuationMessages?: AgentInputCollector;
	readonly limits: AgentRunLimits;
	readonly signal: AbortSignal;
	readonly observer?: (event: AgentExecutionEvent) => void;
}

export type AgentExecutionEvent =
	| { readonly type: "run_start" }
	| {
			readonly type: "model_call_start";
			readonly modelCallIndex: number;
			readonly callId: string;
			readonly snapshotId: string;
	  }
	| {
			readonly type: "model_event";
			readonly modelCallIndex: number;
			readonly event: LanguageModelStreamEvent;
	  }
	| {
			readonly type: "model_call_finish";
			readonly modelCallIndex: number;
			readonly callId?: string;
			readonly status: "completed" | "failed";
	  }
	| { readonly type: "assistant_message"; readonly message: AssistantMessage }
	| { readonly type: "input_message"; readonly kind: AgentPendingInputKind; readonly message: Message }
	| { readonly type: "tool_validation"; readonly call: ToolCall; readonly valid: boolean; readonly error?: string }
	| { readonly type: "tool_execution_start"; readonly call: ToolCall; readonly startedAt: number }
	| {
			readonly type: "tool_execution_update";
			readonly call: ToolCall;
			readonly update: RuntimeToolResult;
	  }
	| { readonly type: "tool_execution_phase"; readonly call: ToolCall; readonly phase: AgentToolPhase }
	| {
			readonly type: "tool_execution_finish";
			readonly call: ToolCall;
			readonly result: ToolResultMessage;
			readonly startedAt: number;
			readonly durationMs: number;
			readonly phases: readonly AgentToolPhase[];
	  }
	| { readonly type: "diagnostic"; readonly source: "observer"; readonly message: string }
	| { readonly type: "run_finish"; readonly result: AgentRunResult };
