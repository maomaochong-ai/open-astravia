import { Value } from "@sinclair/typebox/value";
import type { Message, ToolCall, ToolResultMessage } from "@vetta/ai";
import { AgentToolExecutionError } from "../tool-execution-error.js";
import type {
	AgentExecutionEvent,
	AgentInputCollector,
	AgentToolPhase,
	AgentToolPolicy,
	RuntimeToolDefinition,
	RuntimeToolResult,
} from "./types.js";

interface ExecuteToolCallsRequest {
	readonly calls: readonly ToolCall[];
	readonly tools: readonly RuntimeToolDefinition[];
	readonly messages: readonly Message[];
	readonly modelCallIndex: number;
	readonly signal: AbortSignal;
	readonly policy: AgentToolPolicy;
	readonly emit: (event: AgentExecutionEvent) => void;
	readonly takeSteeringMessages?: AgentInputCollector;
}

export interface ToolExecutionBatchResult {
	readonly results: readonly ToolResultMessage[];
	readonly steeringMessages?: readonly Message[];
}

export async function executeRuntimeToolCalls(request: ExecuteToolCallsRequest): Promise<ToolExecutionBatchResult> {
	const results: ToolResultMessage[] = [];
	for (let index = 0; index < request.calls.length; index += 1) {
		const call = request.calls[index];
		request.signal.throwIfAborted();
		const result = await executeOne(call, request);
		results.push(result);

		const steeringMessages = await request.takeSteeringMessages?.({
			modelCallIndex: request.modelCallIndex + 1,
			messages: [...request.messages, ...results],
			signal: request.signal,
		});
		if (steeringMessages && steeringMessages.length > 0) {
			for (const skippedCall of request.calls.slice(index + 1)) {
				results.push(skipToolCall(skippedCall, request.emit));
			}
			return { results, steeringMessages };
		}
	}
	return { results };
}

async function executeOne(call: ToolCall, request: ExecuteToolCallsRequest): Promise<ToolResultMessage> {
	const startedAt = Date.now();
	const phases: AgentToolPhase[] = [];
	const tool = request.tools.find((candidate) => candidate.name === call.name);
	let result: ToolResultMessage;

	if (!tool) {
		const message = `Tool ${call.name} not found`;
		request.emit({ type: "tool_validation", call, valid: false, error: message });
		request.emit({ type: "tool_execution_start", call, startedAt });
		result = toolError(call, message, "AGENT_TOOL_NOT_FOUND");
	} else {
		const validation = validateToolInput(tool, call);
		if (!validation.valid) {
			request.emit({ type: "tool_validation", call, valid: false, error: validation.error });
			request.emit({ type: "tool_execution_start", call, startedAt });
			result = toolError(call, validation.error, "AGENT_TOOL_INPUT_INVALID");
		} else {
			request.emit({ type: "tool_validation", call, valid: true });
			request.emit({ type: "tool_execution_start", call, startedAt });
			result = await executeValidatedTool(call, tool, validation.input, request, startedAt, phases);
		}
	}

	request.emit({
		type: "tool_execution_finish",
		call,
		result,
		startedAt,
		durationMs: Date.now() - startedAt,
		phases: [...phases],
	});
	return result;
}

async function executeValidatedTool(
	call: ToolCall,
	tool: RuntimeToolDefinition,
	input: unknown,
	request: ExecuteToolCallsRequest,
	startedAt: number,
	phases: AgentToolPhase[],
): Promise<ToolResultMessage> {
	try {
		await request.policy.authorize({
			call,
			tool,
			modelCallIndex: request.modelCallIndex,
			messages: request.messages,
			signal: request.signal,
		});
		const executed = await tool.execute(input, {
			toolCallId: call.id,
			messages: request.messages,
			signal: request.signal,
			onUpdate: (update: RuntimeToolResult) => request.emit({ type: "tool_execution_update", call, update }),
			reportPhase: (label) => {
				const phase = { label, atMs: Date.now() - startedAt };
				phases.push(phase);
				request.emit({ type: "tool_execution_phase", call, phase });
			},
		});
		return {
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [...executed.content],
			details: executed.details,
			isError: false,
			timestamp: Date.now(),
		};
	} catch (error) {
		request.signal.throwIfAborted();
		return toolError(
			call,
			error instanceof Error ? error.message : "Tool execution failed",
			"AGENT_TOOL_EXECUTION_FAILED",
			error instanceof AgentToolExecutionError ? error.details : undefined,
		);
	}
}

function validateToolInput(
	tool: RuntimeToolDefinition,
	call: ToolCall,
): { readonly valid: true; readonly input: unknown } | { readonly valid: false; readonly error: string } {
	try {
		if (tool.validateInput) return { valid: true, input: tool.validateInput(call.arguments) };
		const errors = [...Value.Errors(tool.inputSchema, call.arguments)];
		if (errors.length > 0) {
			return {
				valid: false,
				error: errors.map((error) => `${error.path || "/"}: ${error.message}`).join("; "),
			};
		}
		return { valid: true, input: Value.Decode(tool.inputSchema, call.arguments) };
	} catch (error) {
		return { valid: false, error: error instanceof Error ? error.message : "Tool input validation failed" };
	}
}

function skipToolCall(call: ToolCall, emit: (event: AgentExecutionEvent) => void): ToolResultMessage {
	const startedAt = Date.now();
	const result = toolError(call, "Skipped due to queued user message.", "AGENT_TOOL_SKIPPED", {});
	emit({ type: "tool_execution_start", call, startedAt });
	emit({ type: "tool_execution_finish", call, result, startedAt, durationMs: 0, phases: [] });
	return result;
}

function toolError(call: ToolCall, message: string, code: string, details?: unknown): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: call.id,
		toolName: call.name,
		content: [{ type: "text", text: message }],
		details: details ?? { code },
		isError: true,
		timestamp: Date.now(),
	};
}
