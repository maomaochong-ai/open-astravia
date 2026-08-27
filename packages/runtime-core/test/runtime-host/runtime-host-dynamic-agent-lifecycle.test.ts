import { describe, expect, it, vi } from "vitest";
import {
	defineRuntimeAgent,
	RUNTIME_HOST_LIFECYCLE_OBSERVATION,
	RuntimeHost,
	type RuntimeHostSessionAssembly,
	type RuntimeHostSessionBackend,
	type RuntimeObservationRecord,
} from "../../src/index.js";
import { createDefaultRuntimeCapabilityDefinition } from "../../src/kernel/index.js";

describe("RuntimeHost dynamic Agent lifecycle", () => {
	it("installs and retires a peer main Agent as one Host transaction", async () => {
		const backendDispose = vi.fn(async () => {});
		const definitionDispose = vi.fn(async () => {});
		const backend = sessionBackend(() => assembly("review-session"), backendDispose);
		const host = new RuntimeHost();
		const installation = await host.installAgent({
			source: { id: "plugin", revision: "1" },
			definition: defineRuntimeAgent({
				id: "reviewer",
				createInstance: () => ({
					prepareSession: () => ({ capabilities: createDefaultRuntimeCapabilityDefinition() }),
				}),
				dispose: definitionDispose,
			}),
			createBackend: () => backend,
		});

		expect(host.agents.registry.snapshot().entries).toEqual([
			expect.objectContaining({ agentId: "reviewer", state: "active" }),
		]);
		expect(host.agentBackends.snapshot().entries).toEqual([
			expect.objectContaining({ agentId: "reviewer", state: "active" }),
		]);
		const created = await host.createSession({ agent: { id: "reviewer" }, executionMode: "full-access" });
		expect(created.sessionId).toBe("review-session");

		const retirement = installation.retire();
		expect(retirement.definitionRemoved).toBe(true);
		await expect(
			host.createSession({ agent: { id: "reviewer" }, executionMode: "full-access" }),
		).rejects.toMatchObject({ code: "RUNTIME_HOST_AGENT_BACKEND_UNAVAILABLE" });
		expect(backendDispose).not.toHaveBeenCalled();
		await host.disposeSession(created.sessionId);
		await retirement.backendRetirement?.dispose();
		expect(backendDispose).toHaveBeenCalledOnce();

		await host.close();
		expect(definitionDispose).toHaveBeenCalledOnce();
	});

	it("does not publish a Definition when asynchronous Backend preparation fails", async () => {
		const host = new RuntimeHost();
		const definition = defineRuntimeAgent({
			id: "broken",
			createInstance: () => ({
				prepareSession: () => ({ capabilities: createDefaultRuntimeCapabilityDefinition() }),
			}),
		});

		await expect(
			host.installAgent({
				source: { id: "code", revision: "1" },
				definition,
				createBackend: async () => {
					throw new Error("backend unavailable");
				},
			}),
		).rejects.toThrow("backend unavailable");
		expect(host.agents.registry.snapshot().entries).toEqual([]);
		expect(host.agentBackends.snapshot().entries).toEqual([]);
		await host.close();
	});

	it("retains failed Session ownership and retries Host close from the failed phase", async () => {
		const sessionDispose = vi.fn().mockRejectedValueOnce(new Error("locked")).mockResolvedValueOnce(undefined);
		const backendDispose = vi.fn(async () => {});
		const host = new RuntimeHost({
			createSessionBackend: () => sessionBackend(() => assembly("session-1", sessionDispose), backendDispose),
		});
		await host.createSession({ executionMode: "full-access" });

		await expect(host.close()).rejects.toThrow("Failed to close RuntimeHost resources");
		expect(host.getState("session-1").sessionId).toBe("session-1");
		expect(backendDispose).not.toHaveBeenCalled();

		await host.close();
		expect(sessionDispose).toHaveBeenCalledTimes(2);
		expect(backendDispose).toHaveBeenCalledOnce();
		await host.close();
		expect(backendDispose).toHaveBeenCalledOnce();
	});

	it("waits for an admitted in-flight creation before closing Sessions and Backends", async () => {
		let resolveAssembly!: (value: RuntimeHostSessionAssembly) => void;
		const pendingAssembly = new Promise<RuntimeHostSessionAssembly>((resolve) => {
			resolveAssembly = resolve;
		});
		const sessionDispose = vi.fn(async () => {});
		const backendDispose = vi.fn(async () => {});
		const host = new RuntimeHost({
			createSessionBackend: () => ({
				createAssembly: () => pendingAssembly,
				dispose: backendDispose,
			}),
		});
		const creation = host.createSession({ executionMode: "full-access" });
		const closing = host.close();
		await Promise.resolve();
		expect(backendDispose).not.toHaveBeenCalled();

		resolveAssembly(assembly("late-session", sessionDispose));
		await creation;
		await closing;
		expect(sessionDispose).toHaveBeenCalledOnce();
		expect(backendDispose).toHaveBeenCalledOnce();
	});

	it("keeps one Host handle addressable when a persisted continuation changes its canonical Session id", async () => {
		let sessionId = "source-session";
		const observations: RuntimeObservationRecord[] = [];
		const base = assembly(sessionId);
		const host = new RuntimeHost({
			sessionBackend: sessionBackend(() => ({
				...base,
				lifecycle: {
					get sessionId() {
						return sessionId;
					},
					sessionPath: undefined,
					dispose: async () => {},
				},
				corePorts: {
					...base.corePorts,
					turnControl: {
						...base.corePorts.turnControl,
						prompt: async () => {
							sessionId = "continued-session";
							return { status: "completed" as const };
						},
					},
				},
			})),
			observationPort: {
				record: (observation) => {
					observations.push(observation);
				},
			},
		});
		const created = await host.createSession({ executionMode: "full-access" });
		const session = host.getSessionView(created.sessionId);

		await expect(session.prompt({ text: "continue" })).resolves.toEqual({
			status: "completed",
			sessionId: "continued-session",
		});
		expect(session.sessionId).toBe("continued-session");
		expect(host.getState("continued-session").sessionId).toBe("continued-session");
		expect(host.getState("source-session").sessionId).toBe("continued-session");
		expect(host.getSessionView("continued-session").sessionId).toBe("continued-session");
		expect(
			observations.some(
				(record) =>
					record.token === RUNTIME_HOST_LIFECYCLE_OBSERVATION &&
					record.context.sessionId === "continued-session" &&
					(record.payload as { operation?: string }).operation === "session.rebind",
			),
		).toBe(true);

		await session.dispose();
		expect(() => host.getState("source-session")).toThrow("Session not found");
		expect(() => host.getState("continued-session")).toThrow("Session not found");
		await host.close();
	});
});

function sessionBackend(
	create: () => RuntimeHostSessionAssembly | Promise<RuntimeHostSessionAssembly>,
	dispose?: () => Promise<void>,
): RuntimeHostSessionBackend {
	return { createAssembly: async () => create(), ...(dispose ? { dispose } : {}) };
}

function assembly(sessionId: string, dispose: () => Promise<void> = async () => {}): RuntimeHostSessionAssembly {
	return {
		lifecycle: { sessionId, sessionPath: undefined, dispose },
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
		configurationController: {
			setSteeringMode: () => {},
			setFollowUpMode: () => {},
			setAgentMode: () => {},
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
				retry: async () => {},
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
