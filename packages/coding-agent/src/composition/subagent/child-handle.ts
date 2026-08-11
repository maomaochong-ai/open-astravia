import type { AssistantMessage, Message } from "@vetta/ai";
import type { RuntimeSession } from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { SubagentChildHandle, SubagentTodoProgress, SubagentUsageSnapshot } from "@vetta/runtime-subagents";

export interface CodingAgentSubagentChildHandleOptions {
	readonly session: RuntimeSession;
	readonly sessionFile?: string;
	appendContext(records: readonly SessionContextRecord[]): void;
	deliverContext(records: readonly SessionContextRecord[]): Promise<void>;
	disposeComposition(): Promise<void>;
}

/** 将 Coding Agent Session 收窄为通用协调器所需的 Child Handle。 */
export function createCodingAgentSubagentChildHandle(
	options: CodingAgentSubagentChildHandleOptions,
): SubagentChildHandle {
	const todoController = options.session.createCoreAssembly().todoController;
	let disposed = false;
	return {
		sessionId: options.session.sessionId,
		sessionFile: options.sessionFile,
		prompt: async (text) => {
			await options.session.prompt({ text });
		},
		sendMessage: async (text) => {
			options.appendContext([contextRecord("subagent-message", text)]);
		},
		followUp: async (text) => {
			await options.deliverContext([contextRecord("subagent-followup", text)]);
		},
		abort: () => {
			void options.session.abort("Subagent interrupted").catch(() => undefined);
		},
		waitForIdle: () => waitForIdle(options.session),
		isStreaming: () => options.session.readState().isStreaming,
		getLastAssistantText: () => lastAssistantText(options.session.readMessages()),
		readUsage: () => aggregateUsage(options.session.readMessages()),
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			try {
				await options.session.dispose();
			} finally {
				await options.disposeComposition();
			}
		},
		subscribe: (listener) =>
			options.session.subscribe((event) => {
				if (event.type !== "session.lifecycle") return;
				if (event.phase === "agent_start") listener({ type: "agent_start" });
				if (event.phase === "agent_end" || event.phase === "aborted") {
					listener({ type: "agent_end" });
				}
			}),
		setTodos: () => {},
		getTodoProgress: todoController ? () => readTodoProgress(todoController.readItems()) : undefined,
	};
}

function contextRecord(type: string, text: string): SessionContextRecord {
	return {
		type,
		content: [{ type: "text", text }],
		modelVisible: true,
		display: false,
	};
}

async function waitForIdle(session: RuntimeSession): Promise<void> {
	if (!session.readState().isStreaming) return;
	await new Promise<void>((resolve) => {
		const unsubscribe = session.subscribe((event) => {
			if (event.type !== "session.lifecycle") return;
			if (event.phase !== "agent_end" && event.phase !== "aborted") return;
			unsubscribe();
			resolve();
		});
	});
}

function lastAssistantText(messages: readonly Message[]): string | undefined {
	const message = [...messages].reverse().find((candidate) => candidate.role === "assistant");
	if (!message || message.role !== "assistant") return undefined;
	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function aggregateUsage(messages: readonly Message[]): SubagentUsageSnapshot {
	const usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		costTotal: 0,
	};
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		const assistant = message as AssistantMessage;
		usage.input += assistant.usage.input;
		usage.output += assistant.usage.output;
		usage.cacheRead += assistant.usage.cacheRead;
		usage.cacheWrite += assistant.usage.cacheWrite;
		usage.costTotal += assistant.usage.cost.total;
	}
	return usage;
}

export function readTodoProgress(items: readonly { readonly status: string }[]): SubagentTodoProgress {
	return {
		done: items.filter(({ status }) => status === "done").length,
		total: items.length,
	};
}
