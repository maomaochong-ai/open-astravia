import type { GreenfieldRuntimeSession, SessionEvent } from "@vetta/runtime-core";
import type { CodingAgentActiveSessionHost } from "../composition/session-host/active-session-transition-host.js";
import { type BashExecutionMessage, bashExecutionToText } from "../model-context/index.js";
import { CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE } from "../sessions/index.js";
import type { HostBashExecutor, HostBashResult } from "./command-execution/index.js";
import type { CodingAgentGreenfieldSdkBashPort } from "./sdk-session/active-session-capability-host.js";

export interface CodingAgentSdkBashAdapterOptions {
	readonly executor: HostBashExecutor;
	readonly readShellCommandPrefix: () => string | undefined;
}

/** 公开 SDK 的直接 Bash 执行兼容层；运行状态和待投递结果按 Session 身份隔离。 */
export class CodingAgentSdkBashAdapter implements CodingAgentGreenfieldSdkBashPort {
	private active:
		| {
				readonly sessionId: string;
				readonly controller: AbortController;
				readonly operation: Promise<HostBashResult>;
		  }
		| undefined;
	private readonly pending = new Map<string, BashExecutionMessage[]>();
	private unsubscribeEvents: (() => void) | undefined;

	constructor(private readonly options: CodingAgentSdkBashAdapterOptions) {}

	bindEvents(host: Pick<CodingAgentActiveSessionHost, "readSession" | "subscribe">): void {
		if (this.unsubscribeEvents) throw new Error("Greenfield SDK Bash events are already bound");
		this.unsubscribeEvents = host.subscribe((event) => {
			void this.observe(event, () => host.readSession()).catch((error: unknown) => {
				console.warn("[CodingAgentSdkBashAdapter] Failed to flush a completed Bash result", error);
			});
		});
	}

	async execute(
		session: GreenfieldRuntimeSession,
		command: string,
		onChunk?: (chunk: string) => void,
		options?: Parameters<CodingAgentGreenfieldSdkBashPort["execute"]>[3],
	): Promise<HostBashResult> {
		if (this.active) throw new Error("A Greenfield SDK Bash command is already running");
		const controller = new AbortController();
		const prefix = this.options.readShellCommandPrefix();
		const resolvedCommand = prefix ? `${prefix}\n${command}` : command;
		const cwd = session.createCoreAssembly().workspaceView.readWorkingDirectory() ?? process.cwd();
		const operation = options?.operations
			? this.options.executor.executeWithOperations(resolvedCommand, cwd, options.operations, {
					onChunk,
					signal: controller.signal,
				})
			: this.options.executor.execute(resolvedCommand, { onChunk, signal: controller.signal });
		this.active = { sessionId: session.sessionId, controller, operation };
		try {
			const result = await operation;
			const message = toBashMessage(command, result, options?.excludeFromContext);
			if (session.readState().isStreaming) {
				const pending = this.pending.get(session.sessionId) ?? [];
				pending.push(message);
				this.pending.set(session.sessionId, pending);
			} else {
				await deliverBashMessage(session, message);
			}
			return result;
		} finally {
			if (this.active?.operation === operation) this.active = undefined;
		}
	}

	record(
		session: GreenfieldRuntimeSession,
		command: string,
		result: HostBashResult,
		options?: { readonly excludeFromContext?: boolean },
	): Promise<void> {
		return deliverBashMessage(session, toBashMessage(command, result, options?.excludeFromContext));
	}

	abort(): void {
		this.active?.controller.abort();
	}

	get isRunning(): boolean {
		return this.active !== undefined;
	}

	hasPending(sessionId: string): boolean {
		return (this.pending.get(sessionId)?.length ?? 0) > 0;
	}

	async quiesce(session: GreenfieldRuntimeSession): Promise<void> {
		if (this.active?.sessionId === session.sessionId) {
			this.active.controller.abort();
			await Promise.allSettled([this.active.operation]);
		}
		await this.flush(session);
	}

	async observe(event: SessionEvent, readSession: () => GreenfieldRuntimeSession): Promise<void> {
		if (event.type !== "session.lifecycle" || event.phase !== "agent_end") return;
		const session = readSession();
		if (session.sessionId !== event.sessionId) return;
		await this.flush(session);
	}

	async dispose(): Promise<void> {
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = undefined;
		this.abort();
		const operation = this.active?.operation;
		if (operation) await Promise.allSettled([operation]);
		this.pending.clear();
	}

	private async flush(session: GreenfieldRuntimeSession): Promise<void> {
		const messages = this.pending.get(session.sessionId);
		if (!messages || messages.length === 0) return;
		for (const message of messages) await deliverBashMessage(session, message);
		this.pending.delete(session.sessionId);
	}
}

function toBashMessage(command: string, result: HostBashResult, excludeFromContext: boolean | undefined) {
	return {
		role: "bashExecution" as const,
		command,
		output: result.output,
		exitCode: result.exitCode,
		cancelled: result.cancelled,
		truncated: result.truncated,
		fullOutputPath: result.fullOutputPath,
		timestamp: Date.now(),
		excludeFromContext,
	};
}

async function deliverBashMessage(session: GreenfieldRuntimeSession, message: BashExecutionMessage): Promise<void> {
	await session.createCoreAssembly().contextDeliveryController.deliver(
		[
			{
				type: CODING_AGENT_EXTENDED_MESSAGE_CONTEXT_TYPE,
				content: [{ type: "text", text: bashExecutionToText(message) }],
				modelVisible: message.excludeFromContext !== true,
				display: true,
				metadata: { agentMessage: message },
			},
		],
		"record",
	);
}
