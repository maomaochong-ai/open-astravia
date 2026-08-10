import type { Message } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import {
	type RunningChangedReason,
	RuntimeHost,
	type RuntimeHostSessionAssembly,
	type RuntimeHostSessionBackend,
	type SessionEvent,
} from "../../src/index.js";

/**
 * running-changed 的 reason 是渲染端队列策略的唯一依据（ADR-0060）：
 * agent_end = 自然结束（允许继续消费队列），aborted / error = 终止（队列暂停）。
 * turn.failed 只产生 error observation + agent_end，这里锁住 error 不得伪装成
 * agent_end；同时锁住重试恢复成功的回合不得残留早前的 error 标记。
 */
describe("RuntimeHost running-changed reason", () => {
	async function setup(): Promise<{
		emit(event: SessionEvent): void;
		reasons: Array<{ running: boolean; reason: RunningChangedReason | undefined }>;
	}> {
		let handler: ((event: SessionEvent) => void) | undefined;
		const backend: RuntimeHostSessionBackend = {
			createAssembly: async () =>
				assembly("session-1", (h) => {
					handler = h;
				}),
		};
		const host = new RuntimeHost({ sessionBackend: backend });
		const reasons: Array<{ running: boolean; reason: RunningChangedReason | undefined }> = [];
		host.onRunningChanged((_path, running, _sessionId, reason) => {
			reasons.push({ running, reason });
		});
		await host.createSession({});
		if (!handler) throw new Error("event stream not subscribed");
		const emit = (event: SessionEvent): void => handler?.(event);
		return { emit, reasons };
	}

	function lifecycle(phase: "agent_start" | "agent_end" | "aborted"): SessionEvent {
		return { ...base(), type: "session.lifecycle", phase } as SessionEvent;
	}

	function errorEvent(): SessionEvent {
		return {
			...base(),
			type: "error",
			error: { code: "PROVIDER_ERROR", message: "boom", retryable: false, origin: "runtime" },
		} as SessionEvent;
	}

	function assistantFinal(stopReason: string): SessionEvent {
		return {
			...base(),
			type: "message.final",
			message: { role: "assistant", stopReason } as unknown as Message,
		} as SessionEvent;
	}

	function base(): { sessionId: string; source: "runtime-core"; timestamp: number } {
		return { sessionId: "session-1", source: "runtime-core", timestamp: 1 };
	}

	it("turn.failed 路径（error observation + agent_end）报告 reason=error", async () => {
		const { emit, reasons } = await setup();
		emit(lifecycle("agent_start"));
		emit(errorEvent());
		emit(lifecycle("agent_end"));
		expect(reasons).toEqual([
			{ running: true, reason: undefined },
			{ running: false, reason: "error" },
		]);
	});

	it("abort 路径（lifecycle aborted + agent_end）报告 reason=aborted", async () => {
		const { emit, reasons } = await setup();
		emit(lifecycle("agent_start"));
		emit(lifecycle("aborted"));
		emit(lifecycle("agent_end"));
		expect(reasons.at(-1)).toEqual({ running: false, reason: "aborted" });
	});

	it("重试后成功收尾的回合不残留 error 标记，reason=agent_end", async () => {
		const { emit, reasons } = await setup();
		emit(lifecycle("agent_start"));
		emit(errorEvent());
		emit(assistantFinal("end_turn"));
		emit(lifecycle("agent_end"));
		expect(reasons.at(-1)).toEqual({ running: false, reason: "agent_end" });
	});

	it("回合外的合成 error（pre-stream 校验失败）不影响下一回合的 reason", async () => {
		const { emit, reasons } = await setup();
		emit(errorEvent());
		emit(lifecycle("agent_start"));
		emit(lifecycle("agent_end"));
		expect(reasons.at(-1)).toEqual({ running: false, reason: "agent_end" });
	});
});

function assembly(
	sessionId: string,
	onSubscribe: (handler: (event: SessionEvent) => void) => void,
): RuntimeHostSessionAssembly {
	return {
		lifecycle: { sessionId, sessionPath: `/tmp/${sessionId}.jsonl`, dispose: async () => {} },
		historyReader: { readHistory: () => [] },
		historyController: {
			navigateForEdit: async () => ({ text: "", cancelled: false }),
			switchBranch: async () => ({ leafId: "" }),
			appendBranchSummary: async () => ({ entryId: "" }),
			deleteMessage: async () => ({ leafId: null }),
			replaceLastUserMessage: async () => ({ leafId: null }),
			forkSession: async () => ({ path: "", text: "" }),
			setName: async () => {},
		},
		hostInteraction: { bind: async () => {} },
		executionController: { isBusy: () => false, reconfigure: async () => {} },
		workspaceView: { readWorkingDirectory: () => undefined },
		backgroundWorkController: {
			clearFinished: () => 0,
			killTask: () => false,
			readTasks: () => [],
			readSubagents: () => [],
			interruptSubagent: () => undefined,
		},
		todoController: { readItems: () => [], clear: () => false },
		configurationController: {
			setSteeringMode: () => {},
			setFollowUpMode: () => {},
			setAgentMode: () => {},
			reconfigureAgentPlugins: async () => {},
		},
		modelController: {
			selectModel: async () => {},
			setThinkingLevel: () => {},
			refreshAuth: async () => {},
		},
		modelView: {
			readCurrentModel: () => undefined,
			refreshAvailableModels: () => {},
			readAvailableModels: () => [],
			resolveApiKey: async () => undefined,
		},
		corePorts: {
			turnControl: { prompt: async () => undefined, continue: async () => {}, abort: async () => {} },
			eventStream: {
				subscribe: (handler) => {
					onSubscribe(handler);
					return () => {};
				},
			},
			stateReader: {
				readState: () => ({
					thinkingLevel: "off",
					activeToolNames: [],
					isStreaming: false,
					messageCount: 0,
					contextPercent: 0,
					contextWindow: 0,
				}),
				readMessages: () => [],
			},
		},
	};
}
