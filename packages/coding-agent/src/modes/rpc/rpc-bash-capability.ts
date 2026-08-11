import type { RuntimeSessionContextDeliveryController } from "@vetta/runtime-core";
import type { HostBashExecutor } from "../../host/command-execution/index.js";
import { type BashExecutionMessage, bashExecutionToText } from "../../model-context/index.js";
import { CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE } from "../../sessions/index.js";
import type { RpcBashCapability } from "./rpc-session-capabilities.js";
import type { RpcBashResult } from "./rpc-types.js";

export interface CodingAgentRpcBashCapabilityOptions {
	readonly executor: HostBashExecutor;
	readonly readContextDeliveryController: () => RuntimeSessionContextDeliveryController;
	readonly readShellCommandPrefix: () => string | undefined;
}

/** Direct user Bash command execution with V2 context persistence and cancellation. */
export class CodingAgentRpcBashCapability implements RpcBashCapability {
	private activeController: AbortController | undefined;

	constructor(private readonly options: CodingAgentRpcBashCapabilityOptions) {}

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
