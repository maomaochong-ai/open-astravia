import { describe, expect, it, vi } from "vitest";
import {
	RuntimeHost,
	type RuntimeHostSessionAssembly,
	type RuntimeHostSessionBackend,
	type SessionConfig,
} from "../../src/index.js";

describe("RuntimeHost agent mode 会话级固化", () => {
	it("会话创建时固化模式，Turn 边界不再改写", async () => {
		const setAgentMode = vi.fn();
		const created: Array<string | undefined> = [];
		let nextSession = 0;
		const host = new RuntimeHost({
			getDefaultExecutionMode: () => "full-access",
			sessionBackend: backend((config) => {
				nextSession += 1;
				created.push(config.agentMode);
				return assembly(`session-${nextSession}`, setAgentMode);
			}),
		});

		await host.createSession({ agentMode: "work" } as SessionConfig);
		await host.createSession({ agentMode: "coding" } as SessionConfig);

		await host.prompt("session-1", { text: "hello" });
		await host.continue("session-1");
		await host.prompt("session-2", { text: "hello" });

		expect(created).toEqual(["work", "coding"]);
		// 宿主不再有任何把模式推给活跃会话的通道。
		expect(setAgentMode).not.toHaveBeenCalled();
		expect((host as unknown as Record<string, unknown>).setGlobalAgentMode).toBeUndefined();
	});

	it("getState 回传本会话固化的模式，供 renderer 按会话而非全局默认值渲染", async () => {
		let nextSession = 0;
		const host = new RuntimeHost({
			getDefaultExecutionMode: () => "full-access",
			sessionBackend: backend(() => {
				nextSession += 1;
				return assembly(`session-${nextSession}`, () => {});
			}),
		});

		await host.createSession({ agentMode: "work" } as SessionConfig);
		await host.createSession({ agentMode: "coding" } as SessionConfig);

		// 两个会话各自回传自己的模式，互不串扰。
		expect(host.getState("session-1").agentMode).toBe("work");
		expect(host.getState("session-2").agentMode).toBe("coding");
	});

	it("未指定模式的会话不带 agentMode（CLI/headless 缺省不做模式偏向）", async () => {
		const host = new RuntimeHost({
			getDefaultExecutionMode: () => "full-access",
			sessionBackend: backend(() => assembly("session-1", () => {})),
		});

		await host.createSession({} as SessionConfig);

		expect(host.getState("session-1").agentMode).toBeUndefined();
	});
});

function backend(create: (config: { agentMode?: string }) => RuntimeHostSessionAssembly): RuntimeHostSessionBackend {
	return { createAssembly: async (request) => create(request) };
}

function assembly(sessionId: string, setAgentMode: (mode: string | undefined) => void): RuntimeHostSessionAssembly {
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
		executionController: {
			isBusy: () => false,
			reconfigure: async () => {},
		},
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
			setAgentMode,
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
			turnControl: {
				prompt: async () => undefined,
				continue: async () => {},
				abort: async () => {},
			},
			eventStream: { subscribe: () => () => {} },
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
