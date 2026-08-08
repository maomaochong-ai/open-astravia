import type { TSchema } from "@sinclair/typebox";
import { type AssistantMessage, type EventStream, type ToolResultMessage, validateToolArguments } from "@vetta/ai";
import type { RuntimeObservation } from "@vetta/runtime-telemetry";
import { AgentToolExecutionError } from "../tool-execution-error.js";
import type { AgentEvent, AgentLoopConfig, AgentMessage, AgentTool, AgentToolResult, ToolPhase } from "../types.js";
import { objectKeys, textFromToolResult, toolCallInput, traceAttributes } from "./telemetry.js";

export async function executeToolCalls(
	tools: AgentTool<TSchema, unknown>[] | undefined,
	messages: readonly AgentMessage[],
	assistantMessage: AssistantMessage,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	getSteeringMessages?: AgentLoopConfig["getSteeringMessages"],
	traceParent?: RuntimeObservation,
	tracing?: AgentLoopConfig["tracing"],
): Promise<{ toolResults: ToolResultMessage[]; steeringMessages?: AgentMessage[] }> {
	const toolCalls = assistantMessage.content.filter((content) => content.type === "toolCall");
	const results: ToolResultMessage[] = [];
	let steeringMessages: AgentMessage[] | undefined;

	for (let index = 0; index < toolCalls.length; index++) {
		const toolCall = toolCalls[index];
		const tool = tools?.find((candidate) => candidate.name === toolCall.name);
		const startedAt = Date.now();
		const phases: ToolPhase[] = [];
		const toolObservation = traceParent?.startObservation(
			`tool.${toolCall.name}`,
			{
				...traceAttributes(tracing),
				input: toolCallInput(tool, toolCall, tracing?.captureContent === true),
				metadata: {
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					argumentKeys: objectKeys(toolCall.arguments),
					toolExists: tool !== undefined,
				},
			},
			{ type: "tool" },
		);

		stream.push({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
			startedAt,
		});

		let result: AgentToolResult<unknown>;
		let isError = false;
		try {
			if (!tool) throw new Error(`Tool ${toolCall.name} not found`);
			const validatedArgs = validateToolArguments(tool, toolCall);
			result = await tool.execute(
				toolCall.id,
				validatedArgs,
				signal,
				(partialResult) => {
					stream.push({
						type: "tool_execution_update",
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						args: toolCall.arguments,
						partialResult,
					});
				},
				{
					phase: (label) => {
						const atMs = Date.now() - startedAt;
						phases.push({ label, atMs });
						stream.push({
							type: "tool_execution_phase",
							toolCallId: toolCall.id,
							toolName: toolCall.name,
							label,
							atMs,
						});
					},
					messages: [...messages],
				},
			);
		} catch (error) {
			result = {
				content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
				details: error instanceof AgentToolExecutionError ? error.details : {},
			};
			isError = true;
		}

		const durationMs = Date.now() - startedAt;
		stream.push({
			type: "tool_execution_end",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			result,
			isError,
			startedAt,
			durationMs,
			phases,
		});
		toolObservation?.end({
			output: tracing?.captureContent ? result : undefined,
			level: isError ? "ERROR" : "DEFAULT",
			statusMessage: isError ? textFromToolResult(result) : undefined,
			metadata: { isError, durationMs, phaseCount: phases.length, phases },
		});

		const toolResultMessage: ToolResultMessage = {
			role: "toolResult",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			content: result.content,
			details: result.details,
			isError,
			timestamp: Date.now(),
		};
		results.push(toolResultMessage);
		stream.push({ type: "message_start", message: toolResultMessage });
		stream.push({ type: "message_end", message: toolResultMessage });

		if (getSteeringMessages) {
			const steering = await getSteeringMessages();
			if (steering.length > 0) {
				steeringMessages = steering;
				for (const skipped of toolCalls.slice(index + 1)) {
					results.push(skipToolCall(skipped, stream, traceParent, tracing));
				}
				break;
			}
		}
	}

	return { toolResults: results, steeringMessages };
}

function skipToolCall(
	toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }>,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	traceParent?: RuntimeObservation,
	tracing?: AgentLoopConfig["tracing"],
): ToolResultMessage {
	const result: AgentToolResult<unknown> = {
		content: [{ type: "text", text: "Skipped due to queued user message." }],
		details: {},
	};
	const startedAt = Date.now();
	const toolObservation = traceParent?.startObservation(
		`tool.${toolCall.name}`,
		{
			...traceAttributes(tracing),
			input: toolCallInput(undefined, toolCall, tracing?.captureContent === true),
			metadata: { toolCallId: toolCall.id, toolName: toolCall.name, skipped: true },
		},
		{ type: "tool" },
	);
	stream.push({
		type: "tool_execution_start",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		args: toolCall.arguments,
		startedAt,
	});
	stream.push({
		type: "tool_execution_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result,
		isError: true,
		startedAt,
		durationMs: 0,
		phases: [],
	});
	toolObservation?.end({
		output: tracing?.captureContent ? result : undefined,
		level: "WARNING",
		statusMessage: "Skipped due to queued user message.",
		metadata: { isError: true, durationMs: 0, skipped: true },
	});

	const toolResultMessage: ToolResultMessage = {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: result.content,
		details: {},
		isError: true,
		timestamp: Date.now(),
	};
	stream.push({ type: "message_start", message: toolResultMessage });
	stream.push({ type: "message_end", message: toolResultMessage });
	return toolResultMessage;
}
