import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../../src/contracts.js";
import {
	ConfigurableRuntimeTurnRetryPolicy,
	type RunningChangedReason,
	RuntimeHost,
	type RuntimeHostSessionAssembly,
	withRuntimeHostSessionRetry,
} from "../../src/index.js";
import type { RuntimeSession } from "../../src/runtime-host/kernel-runtime-session-backend.js";

/**
 * 自动重试的某一次尝试在开出自己的 turn 之前就抛错（session.retry() 被
 * sessionBusy / turnPersistence 拒绝）时，这一回合仍然必须终结：宿主要收到
 * agent_end 并把 running 落回 false，否则渲染端永远停在「处理中」，而此时
 * kernel Session 已经 idle，停止按钮的 cancel() 直接早退，用户彻底卡死。
 */
describe("自动重试尝试抛错后的回合终结", () => {
	it("重试抛错也要把 running 落回 false", async () => {
		const emitted: Array<(event: SessionEvent) => void> = [];
		const reasons: Array<{ running: boolean; reason: RunningChangedReason | undefined }> = [];

		const session = {
			prompt: async () => {
				emit(emitted, lifecycle("agent_start"));
				emit(emitted, errorEvent());
				emit(emitted, lifecycle("agent_end"));
				return { status: "failed", sessionId: "session-1", turnId: "turn-1", error: failure(), messages: [] };
			},
			// 第二次尝试：还没开 turn 就被拒（真实现场是 sessionBusy / turnPersistence）
			retry: async () => {
				throw new Error("Session is busy");
			},
			continue: async () => undefined,
			abort: async () => undefined,
		} as unknown as RuntimeSession;

		const host = new RuntimeHost({
			sessionBackend: {
				createAssembly: async () =>
					withRuntimeHostSessionRetry(session, baseAssembly(emitted), {
						policy: new ConfigurableRuntimeTurnRetryPolicy({
							readSettings: () => ({ enabled: true, maxRetries: 3, baseDelayMs: 0 }),
						}),
						readFailure: (result) =>
							typeof result === "object" && result !== null && "error" in result ? failure() : undefined,
					}),
			},
		});
		host.onRunningChanged((_path, running, _sessionId, reason) => reasons.push({ running, reason }));
		await host.createSession({});

		await host.prompt("session-1", { text: "还有什么别的地块吗" });

		expect(reasons.at(-1)).toEqual({ running: false, reason: "error" });
		await host.close();
	});
});

function emit(listeners: Array<(event: SessionEvent) => void>, event: SessionEvent): void {
	for (const listener of listeners) listener(event);
}

function base(): { schemaVersion: 1; sessionId: string; eventId: string; timestamp: number; source: "runtime-core" } {
	return {
		schemaVersion: 1,
		sessionId: "session-1",
		eventId: `e-${Math.random()}`,
		timestamp: 1,
		source: "runtime-core",
	};
}

function failure() {
	return {
		code: "AI_TRANSPORT_FAILED",
		message: "503 auth_unavailable: no auth available",
		retryable: true,
		origin: "provider" as const,
	};
}

function errorEvent(): SessionEvent {
	return { ...base(), type: "error", error: failure() } as SessionEvent;
}

function lifecycle(phase: "agent_start" | "agent_end" | "aborted"): SessionEvent {
	return { ...base(), type: "session.lifecycle", phase } as SessionEvent;
}

function baseAssembly(emitted: Array<(event: SessionEvent) => void>): RuntimeHostSessionAssembly {
	return {
		lifecycle: { sessionId: "session-1", sessionPath: "/tmp/session-1.jsonl", dispose: async () => {} },
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
		executionController: { isBusy: () => false, reconfigure: async () => {} },
		workspaceView: { readWorkingDirectory: () => undefined },
		configurationController: { setSteeringMode: () => {}, setFollowUpMode: () => {} },
		modelController: { selectModel: async () => {}, setThinkingLevel: () => {}, refreshAuth: async () => {} },
		modelView: {
			readCurrentModel: () => undefined,
			refreshAvailableModels: () => {},
			readAvailableModels: () => [],
			resolveApiKey: async () => undefined,
		},
		corePorts: {
			turnControl: {
				prompt: async () => undefined,
				continue: async () => {},
				retry: async () => {},
				abort: async () => {},
			},
			eventStream: {
				subscribe: (handler: (event: SessionEvent) => void) => {
					emitted.push(handler);
					return () => {};
				},
			},
			stateReader: {
				readState: () => ({
					thinkingLevel: "off",
					activeToolNames: [],
					isStreaming: false,
					messageCount: 0,
				}),
				readMessages: () => [],
			},
		},
	} as unknown as RuntimeHostSessionAssembly;
}
