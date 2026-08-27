import { describe, expect, it, vi } from "vitest";
import {
	RuntimeHost,
	type RuntimeHostSessionAssembly,
	type RuntimeHostSessionBackend,
	type RuntimeSessionQueueController,
	type SessionEvent,
	type SessionExecutionMode,
} from "../../src/index.js";

describe("RuntimeHost execution mode Turn boundary", () => {
	it("uses injected path services for session dedupe and working-directory preparation", async () => {
		const ensureDirectory = vi.fn(async () => {});
		let assemblyCount = 0;
		const host = new RuntimeHost({
			pathServices: {
				normalize: (path) => path.toLowerCase(),
				ensureDirectory,
			},
			sessionBackend: backend(() => {
				assemblyCount += 1;
				return assembly("session", {
					isBusy: () => false,
					reconfigure: async () => {},
					cwd: "/workspace",
					sessionPath: "/workspace/session.jsonl",
				});
			}),
		});

		await host.createSession({ sessionPath: "/WORKSPACE/SESSION.JSONL" });
		await host.createSession({ sessionPath: "/workspace/session.jsonl" });
		await host.prompt("session", { text: "hello" });

		expect(assemblyCount).toBe(1);
		expect(ensureDirectory).toHaveBeenCalledOnce();
		expect(ensureDirectory).toHaveBeenCalledWith("/workspace");
	});

	it("delegates sandbox grant state to the injected platform store", () => {
		const revoke = vi.fn(() => true);
		const revokeAll = vi.fn(() => 1);
		const clear = vi.fn();
		const host = new RuntimeHost({
			sandboxGrantStore: {
				list: (sessionId) => [
					{
						id: "grant-1",
						sessionId,
						toolName: "read",
						capability: "file.read",
						grantRoot: "/workspace",
						firstTarget: "/workspace/file.txt",
						createdAt: 1,
					},
				],
				revoke,
				revokeAll,
				clear,
			},
		});

		expect(host.listSandboxGrants("session")).toEqual([
			expect.objectContaining({ id: "grant-1", sessionId: "session" }),
		]);
		expect(host.revokeSandboxGrant("session", "grant-1")).toBe(true);
		expect(host.revokeAllSandboxGrants("session")).toBe(1);
		expect(revoke).toHaveBeenCalledWith("session", "grant-1");
		expect(revokeAll).toHaveBeenCalledWith("session");
		expect(clear).not.toHaveBeenCalled();
	});

	it("restores and persists queue snapshots through the injected sidecar store", async () => {
		const restoredSnapshot = { paused: true, entries: [{ id: "restored" }] };
		const nextSnapshot = { paused: false, entries: [{ id: "next" }] };
		const restoreQueue = vi.fn();
		let emit: ((event: SessionEvent) => void) | undefined;
		let resolveWrite: (() => void) | undefined;
		const writeCompleted = new Promise<void>((resolve) => {
			resolveWrite = resolve;
		});
		const write = vi.fn(async () => resolveWrite?.());
		const host = new RuntimeHost({
			queueSidecarStore: {
				read: async () => restoredSnapshot,
				write,
				remove: async () => {},
			},
			sessionBackend: backend(() =>
				assembly("session", {
					isBusy: () => false,
					reconfigure: async () => {},
					sessionPath: "/workspace/session.jsonl",
					queueController: createQueueController(restoreQueue),
					subscribe: (listener) => {
						emit = listener;
					},
				}),
			),
		});

		await host.createSession({ sessionPath: "/workspace/session.jsonl" });
		expect(restoreQueue).toHaveBeenCalledWith(restoredSnapshot);

		emit?.({
			type: "queue.changed",
			schemaVersion: 1,
			sessionId: "session",
			eventId: "event-1",
			timestamp: 1,
			source: "runtime-core",
			paused: false,
			entries: [{ id: "next", behavior: "followUp", displayText: "next" }],
			snapshot: nextSnapshot,
		});
		await writeCompleted;
		expect(write).toHaveBeenCalledWith("/workspace/session.jsonl", nextSnapshot);
	});

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
		readonly cwd?: string;
		readonly sessionPath?: string;
		readonly queueController?: RuntimeSessionQueueController;
		readonly subscribe?: (listener: (event: SessionEvent) => void) => void;
	},
): RuntimeHostSessionAssembly {
	return {
		lifecycle: {
			sessionId,
			sessionPath: options.sessionPath ?? `/tmp/${sessionId}.jsonl`,
			dispose: async () => {},
		},
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
		workspaceView: { readWorkingDirectory: () => options.cwd },
		configurationController: {
			setSteeringMode: () => {},
			setFollowUpMode: () => {},
			setAgentMode: () => {},
		},
		queueController: options.queueController,
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
				retry: async () => {},
				abort: async () => {},
			},
			eventStream: {
				subscribe: (listener) => {
					options.subscribe?.(listener);
					return () => {};
				},
			},
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

function createQueueController(restoreQueue: (snapshot: unknown) => void): RuntimeSessionQueueController {
	return {
		readSteeringMode: () => "all",
		readFollowUpMode: () => "all",
		readSteeringMessages: () => [],
		readFollowUpMessages: () => [],
		readPendingMessageCount: () => 0,
		clear: () => ({ steering: [], followUp: [] }),
		readQueueState: () => ({ paused: false, entries: [] }),
		readQueueSnapshot: () => ({}),
		restoreQueue,
		removeQueued: () => false,
		reorderQueuedFollowUps: () => {},
		sendQueuedNow: async () => "missing",
		resumeQueue: async () => {},
	};
}
