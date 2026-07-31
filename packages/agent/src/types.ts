import type { Static, TSchema } from "@sinclair/typebox";
import type {
	AssistantMessageEvent,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	streamSimple,
	TextContent,
	Tool,
	ToolResultMessage,
} from "@vetta/ai";
import type { RuntimeTracer } from "@vetta/runtime-telemetry";

/** Stream function - can return sync or Promise for async config lookup */
export type StreamFn = (
	...args: Parameters<typeof streamSimple>
) => ReturnType<typeof streamSimple> | Promise<ReturnType<typeof streamSimple>>;

/**
 * Configuration for the agent loop.
 */
export interface AgentLoopConfig extends SimpleStreamOptions {
	model: Model<any>;
	tracer?: RuntimeTracer;
	tracing?: AgentTracingOptions;

	/**
	 * Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
	 *
	 * Each AgentMessage must be converted to a UserMessage, AssistantMessage, or ToolResultMessage
	 * that the LLM can understand. AgentMessages that cannot be converted (e.g., UI-only notifications,
	 * status messages) should be filtered out.
	 *
	 * @example
	 * ```typescript
	 * convertToLlm: (messages) => messages.flatMap(m => {
	 *   if (m.role === "custom") {
	 *     // Convert custom message to user message
	 *     return [{ role: "user", content: m.content, timestamp: m.timestamp }];
	 *   }
	 *   if (m.role === "notification") {
	 *     // Filter out UI-only messages
	 *     return [];
	 *   }
	 *   // Pass through standard LLM messages
	 *   return [m];
	 * })
	 * ```
	 */
	convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	/**
	 * Optional transform applied to the context before `convertToLlm`.
	 *
	 * Use this for operations that work at the AgentMessage level:
	 * - Context window management (pruning old messages)
	 * - Injecting context from external sources
	 *
	 * @example
	 * ```typescript
	 * transformContext: async (messages) => {
	 *   if (estimateTokens(messages) > MAX_TOKENS) {
	 *     return pruneOldMessages(messages);
	 *   }
	 *   return messages;
	 * }
	 * ```
	 */
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

	/**
	 * Resolves an API key dynamically for each LLM call.
	 *
	 * Useful for short-lived OAuth tokens (e.g., GitHub Copilot) that may expire
	 * during long-running tool execution phases.
	 */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

	/**
	 * Returns steering messages to inject into the conversation mid-run.
	 *
	 * Called after each tool execution to check for user interruptions.
	 * If messages are returned, remaining tool calls are skipped and
	 * these messages are added to the context before the next LLM call.
	 *
	 * Use this for "steering" the agent while it's working.
	 */
	getSteeringMessages?: () => Promise<AgentMessage[]>;

	/**
	 * Returns continuation messages when the agent reaches a natural stopping point.
	 *
	 * Called when the agent has no more tool calls and no steering messages.
	 * If messages are returned, they're added to the context and the agent
	 * continues with another turn.
	 *
	 * Use this for automatic continuation policies. User-queued follow-up messages
	 * are managed separately by Agent.followUp().
	 */
	getContinuationMessages?: () => Promise<AgentMessage[]>;

	/**
	 * Returns the tool set / system prompt to use for the next turn.
	 *
	 * The loop copies the context it is given, so a host that changes tools or the
	 * system prompt mid-run (e.g. a tool that activates more tools) must expose the
	 * change through these hooks — otherwise it only takes effect on the next run.
	 * Omitted → the context values captured at loop start are kept.
	 */
	getTools?: () => AgentTool<any>[] | undefined;
	getSystemPrompt?: () => string;
}

export interface AgentTracingOptions {
	captureContent?: boolean;
	detail?: AgentTracingDetail;
	metadata?: Record<string, unknown>;
	userId?: string;
	sessionId?: string;
	traceName?: string;
	tags?: string[];
	version?: string;
}

export type AgentTracingDetail = "standard" | "agent";

/**
 * Thinking/reasoning level for models that support it.
 * The canonical values are the common ones; the type also accepts any string so a
 * model can declare provider-specific levels (e.g. "none", "max"). "off" disables
 * reasoning. Custom values are passed through to the provider verbatim.
 * Note: "xhigh" is only supported by OpenAI gpt-5.1-codex-max, gpt-5.2, gpt-5.2-codex, gpt-5.3, and gpt-5.3-codex models.
 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | (string & {});

/**
 * Extensible interface for custom app messages.
 * Apps can extend via declaration merging:
 *
 * @example
 * ```typescript
 * declare module "@mariozechner/agent" {
 *   interface CustomAgentMessages {
 *     artifact: ArtifactMessage;
 *     notification: NotificationMessage;
 *   }
 * }
 * ```
 */
export interface CustomAgentMessages {
	// Empty by default - apps extend via declaration merging
}

/**
 * AgentMessage: Union of LLM messages + custom messages.
 * This abstraction allows apps to add custom message types while maintaining
 * type safety and compatibility with the base LLM messages.
 */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

/**
 * Agent state containing all configuration and conversation data.
 */
export interface AgentState {
	systemPrompt: string;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	tools: AgentTool<any>[];
	messages: AgentMessage[]; // Can include attachments + custom message types
	isStreaming: boolean;
	streamMessage: AgentMessage | null;
	pendingToolCalls: Set<string>;
	error?: string;
}

export interface AgentToolResult<T> {
	// Content blocks supporting text and images
	content: (TextContent | ImageContent)[];
	// Details to be displayed in a UI or logged
	details: T;
}

// Callback for streaming tool execution updates
export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

// A timing phase reported by a tool via ctx.phase(label) during execution.
// atMs is the offset (in milliseconds) from the tool's startedAt; each phase
// implicitly ends when the next phase starts (or when execution ends).
export interface ToolPhase {
	label: string;
	atMs: number;
}

// Out-of-band runtime hooks made available to a tool's execute() — purely
// metadata reporting, never affects tool result content. Optional fourth-style
// argument so existing tools that don't take ctx keep working.
export interface ToolExecutionContext {
	phase: (label: string) => void;
}

// AgentTool extends Tool but adds the execute function
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any, TScenario extends string = string>
	extends Tool<TParameters> {
	// A human-readable label for the tool to be displayed in UI
	label: string;
	/**
	 * 工具可用性元数据（由上层消费者解释，agent 库本身不解读）。
	 * - scope_use：允许出现的对话场景 slug 列表。**fail-closed**：缺省/空 = 所有场景都不可用
	 *   （注册但不自动激活，仍可被显式 toggle 开启）。每个工具须显式声明。
	 *   类型默认 `string`（agent-core 不绑定任何场景词汇）；上层消费者可通过 `TScenario`
	 *   传入具体的场景联合（如 coding-agent 的 `ConversationScenario`）拿到补全/防拼写。
	 * - requires：需要的会话能力 slug（如 "knowledge"/"bg-tasks"/"host:ask"）；全满足才激活。
	 * - agent_mode：允许出现的工作模式 slug（如 "work"/"coding"）。**与 scope_use/requires 正交**
	 *   的第三条过滤轴。缺省/空 = 通用（所有模式可用）。会话未指定模式时该轴不过滤。
	 *   agent-core 不绑定任何模式词汇；上层消费者（coding-agent）定义具体的 `AgentMode` 联合。
	 * - category：功能域分类，仅供分组/UI，不影响激活。
	 */
	scope_use?: readonly TScenario[];
	requires?: string[];
	agent_mode?: readonly string[];
	category?: string;
	execute: (
		toolCallId: string,
		params: Static<TParameters>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TDetails>,
		ctx?: ToolExecutionContext,
	) => Promise<AgentToolResult<TDetails>>;
}

// AgentContext is like Context but uses AgentTool
export interface AgentContext {
	systemPrompt: string;
	messages: AgentMessage[];
	tools?: AgentTool<any>[];
}

/**
 * Events emitted by the Agent for UI updates.
 * These events provide fine-grained lifecycle information for messages, turns, and tool executions.
 */
export type AgentEvent =
	// Agent lifecycle
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	// Turn lifecycle - a turn is one assistant response + any tool calls/results
	| { type: "turn_start" }
	| { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
	// Message lifecycle - emitted for user, assistant, and toolResult messages
	| { type: "message_start"; message: AgentMessage }
	// Only emitted for assistant messages during streaming
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	// Tool execution lifecycle
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any; startedAt: number }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
	| { type: "tool_execution_phase"; toolCallId: string; toolName: string; label: string; atMs: number }
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result: any;
			isError: boolean;
			startedAt: number;
			durationMs: number;
			phases: ToolPhase[];
	  };
