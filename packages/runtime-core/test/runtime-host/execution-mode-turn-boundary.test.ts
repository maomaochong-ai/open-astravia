import { describe, expect, it, vi } from "vitest";
import {
	RuntimeHost,
	type RuntimeHostSessionAssembly,
	type RuntimeHostSessionBackend,
	type SessionExecutionMode,
} from "../../src/index.js";

describe("RuntimeHost execution mode Turn boundary", () => {
	it("keeps a running Turn on its admitted mode and applies the update before the next Turn", async () => {
		let busy = true;
		const order: string[] = [];
		const reconfigure = vi.fn(async ({ mode }: { mode: SessionExecutionMode }) => {
			order.push(`reconfigure:${mode}`);
		});
		const host = new RuntimeHost({
			getDefaultExecutionMode: () => "sandbox",
			sessionBackend: backend(() =>
				assembly("session", {
					isBusy: () => busy,
					reconfigure,
					continueTurn: async () => {
						order.push("continue");
					},
				}),
			),
		});
		await host.createSession({});

		await host.setExecutionMode("session", "full-access");

		expect(reconfigure).not.toHaveBeenCalled();
		expect(host.getState("session").executionMode).toBe("sandbox");

		busy = false;
		await host.continue("session");

		expect(order).toEqual(["reconfigure:full-access", "continue"]);
		expect(host.getState("session").executionMode).toBe("full-access");
	});

	it("accepts a global update while some sessions are running", async () => {
		const busyBySession = new Map([
			["session-1", true],
			["session-2", false],
		]);
		const applied = new Map<string, SessionExecutionMode>();
		let nextSession = 0;
		const host = new RuntimeHost({
			getDefaultExecutionMode: () => "sandbox",
			sessionBackend: backend(() => {
				nextSession += 1;
				const sessionId = `session-${nextSession}`;
				return assembly(sessionId, {
					isBusy: () => busyBySession.get(sessionId) ?? false,
					reconfigure: async ({ mode }) => {
						applied.set(sessionId, mode);
					},
				});
			}),
		});
		await host.createSession({});
		await host.createSession({});

		await expect(host.setGlobalExecutionMode("full-access")).resolves.toBeUndefined();

		expect(applied.get("session-1")).toBeUndefined();
		expect(applied.get("session-2")).toBe("full-access");
		expect(host.getState("session-1").executionMode).toBe("sandbox");
		expect(host.getState("session-2").executionMode).toBe("full-access");

		busyBySession.set("session-1", false);
		await host.continue("session-1");
		expect(applied.get("session-1")).toBe("full-access");
	});
});

function backend(create: () => RuntimeHostSessionAssembly): RuntimeHostSessionBackend {
	return { createAssembly: async () => create() };
}

function assembly(
	sessionId: string,
	options: {
		readonly isBusy: () => boolean;
		readonly reconfigure: (options: {
			readonly mode: SessionExecutionMode;
			readonly sessionId: string;
		}) => Promise<void>;
		readonly continueTurn?: () => Promise<void>;
	},
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
		executionController: {
			isBusy: options.isBusy,
			reconfigure: options.reconfigure,
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
			turnControl: {
				prompt: async () => undefined,
				continue: options.continueTurn ?? (async () => {}),
				abort: async () => {},
			},
			eventStream: { subscribe: () => () => {} },
			stateReader: {
				readState: () => ({
					thinkingLevel: "off",
					activeToolNames: [],
					isStreaming: options.isBusy(),
					messageCount: 0,
					contextPercent: 0,
					contextWindow: 0,
				}),
				readMessages: () => [],
			},
		},
	};
}
