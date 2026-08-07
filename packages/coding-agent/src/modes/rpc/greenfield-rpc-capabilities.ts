import type { AgentMessage, ThinkingLevel } from "@vetta/agent-core";
import { type Api, type AssistantMessage, type Model, supportsXhigh } from "@vetta/ai";
import type { ConversationDocument, RuntimeSessionContextDeliveryController } from "@vetta/runtime-core";
import type { CodingAgentHtmlExportRuntime } from "../../export-html/index.js";
import type { HostBashExecutor } from "../../host/command-execution/index.js";
import { type BashExecutionMessage, bashExecutionToText } from "../../model-context/index.js";
import { CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE } from "../../sessions/index.js";
import { projectCodingAgentMessages } from "../../sessions/projection/conversation-context-projector.js";
import type { RpcBashCapability } from "./rpc-session-capabilities.js";
import type { RpcBashResult, SessionStats } from "./rpc-types.js";

export type {
	CodingAgentTurnRetryControllerOptions as GreenfieldRpcRetryControllerOptions,
	CodingAgentTurnRetryEvent as GreenfieldRpcRetryEvent,
	CodingAgentTurnRetrySettings as GreenfieldRpcRetrySettings,
} from "../../host/session-execution/contracts.js";
export { CodingAgentSessionTurnRetryController as GreenfieldRpcRetryController } from "../../host/session-execution/turn-retry-controller.js";

export interface GreenfieldRpcBashCapabilityOptions {
	readonly executor: HostBashExecutor;
	readonly readContextDeliveryController: () => RuntimeSessionContextDeliveryController;
	readonly readShellCommandPrefix: () => string | undefined;
}

/** Direct user Bash command execution with V2 context persistence and cancellation. */
export class GreenfieldRpcBashCapability implements RpcBashCapability {
	private activeController: AbortController | undefined;

	constructor(private readonly options: GreenfieldRpcBashCapabilityOptions) {}

	async execute(command: string, signal?: AbortSignal): Promise<RpcBashResult> {
		signal?.throwIfAborted();
		const controller = new AbortController();
		this.activeController = controller;
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		const prefix = this.options.readShellCommandPrefix();
		const resolvedCommand = prefix ? `${prefix}\n${command}` : command;
		try {
			const result = await this.options.executor.execute(resolvedCommand, { signal: controller.signal });
			const message: BashExecutionMessage = {
				role: "bashExecution",
				command,
				output: result.output,
				exitCode: result.exitCode,
				cancelled: result.cancelled,
				truncated: result.truncated,
				fullOutputPath: result.fullOutputPath,
				timestamp: Date.now(),
			};
			await this.options.readContextDeliveryController().deliver(
				[
					{
						type: CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE,
						content: [{ type: "text", text: bashExecutionToText(message) }],
						modelVisible: true,
						display: true,
						metadata: { agentMessage: message },
					},
				],
				"record",
			);
			return result;
		} finally {
			signal?.removeEventListener("abort", abort);
			if (this.activeController === controller) this.activeController = undefined;
		}
	}

	abort(): void {
		this.activeController?.abort();
	}
}

export function computeGreenfieldRpcSessionStats(
	messages: readonly AgentMessage[],
	sessionFile: string | undefined,
	sessionId: string,
): SessionStats {
	let toolCalls = 0;
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost = 0;
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		const assistant = message as AssistantMessage;
		toolCalls += assistant.content.filter((content) => content.type === "toolCall").length;
		input += assistant.usage.input;
		output += assistant.usage.output;
		cacheRead += assistant.usage.cacheRead;
		cacheWrite += assistant.usage.cacheWrite;
		cost += assistant.usage.cost.total;
	}
	return {
		sessionFile,
		sessionId,
		userMessages: messages.filter((message) => message.role === "user").length,
		assistantMessages: messages.filter((message) => message.role === "assistant").length,
		toolCalls,
		toolResults: messages.filter((message) => message.role === "toolResult").length,
		totalMessages: messages.length,
		tokens: { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite },
		cost,
	};
}

export function readGreenfieldRpcAgentMessages(document: ConversationDocument): readonly AgentMessage[] {
	return projectCodingAgentMessages(document);
}

export function resolveNextGreenfieldRpcThinkingLevel(
	model: Model<Api> | undefined,
	current: ThinkingLevel,
): ThinkingLevel | undefined {
	if (!model?.reasoning) return undefined;
	const levels: readonly ThinkingLevel[] = supportsXhigh(model)
		? ["off", "minimal", "low", "medium", "high", "xhigh"]
		: ["off", "minimal", "low", "medium", "high"];
	return levels[(levels.indexOf(current) + 1) % levels.length];
}

export function exportGreenfieldRpcConversation(
	htmlExporter: CodingAgentHtmlExportRuntime,
	document: ConversationDocument,
	sessionFile: string,
	outputPath?: string,
): Promise<string> {
	return htmlExporter.exportConversation(document, sessionFile, outputPath);
}
