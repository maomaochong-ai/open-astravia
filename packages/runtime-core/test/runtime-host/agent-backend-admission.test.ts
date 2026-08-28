import { describe, expect, it, vi } from "vitest";
import {
	createRuntimeObservationPublisher,
	RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
	type RuntimeHostAgentBackendObservation,
	RuntimeHostAgentBackendRegistry,
	type RuntimeHostSessionAssembly,
	type RuntimeHostSessionBackend,
	type RuntimeObservationRecord,
	type RuntimeSessionCatalog,
	type RuntimeSessionCreateRequest,
} from "../../src/index.js";

describe("RuntimeHostAgentBackendRegistry", () => {
	it("routes explicit peer Agents and keeps replaced Backend generations alive for existing Sessions", async () => {
		const oldDispose = vi.fn(async () => {});
		const nextDispose = vi.fn(async () => {});
		const oldBackend = backend("old-session", oldDispose);
		const nextBackend = backend("next-session", nextDispose);
		const registry = new RuntimeHostAgentBackendRegistry({ createRevisionId: sequentialIds() });

		const first = registry.upsert({
			agentId: "reviewer",
			source: { id: "code", revision: "1" },
			backend: oldBackend,
			ownsBackend: true,
		});
		const oldSession = await registry.createAssembly(request({ id: "reviewer" }));
		const second = registry.upsert({
			agentId: "reviewer",
			source: { id: "code", revision: "2" },
			backend: nextBackend,
			ownsBackend: true,
		});
		const nextSession = await registry.createAssembly(request({ id: "reviewer" }));

		expect(first.status).toBe("registered");
		expect(second.status).toBe("replaced");
		expect(oldBackend.createAssembly).toHaveBeenCalledOnce();
		expect(nextBackend.createAssembly).toHaveBeenCalledOnce();
		expect(oldDispose).not.toHaveBeenCalled();
		expect(registry.snapshot()).toMatchObject({
			generationCount: 2,
			retiredGenerationCount: 1,
			activeLeaseCount: 2,
		});

		await nextSession.lifecycle.dispose();
		expect(nextDispose).not.toHaveBeenCalled();
		await oldSession.lifecycle.dispose();
		expect(oldDispose).toHaveBeenCalledOnce();
		expect(registry.snapshot()).toMatchObject({ generationCount: 1, activeLeaseCount: 0 });

		await registry.close();
		expect(nextDispose).toHaveBeenCalledOnce();
	});

	it("fails closed after removal while an existing Session can still release its retired generation", async () => {
		const dispose = vi.fn(async () => {});
		const registry = new RuntimeHostAgentBackendRegistry({ defaultBackend: backend("default") });
		registry.upsert({
			agentId: "reviewer",
			source: { id: "plugin", revision: "1" },
			backend: backend("reviewer", dispose),
			ownsBackend: true,
		});
		const existing = await registry.createAssembly(request({ id: "reviewer" }));
		const retirement = registry.remove("reviewer");

		await expect(registry.createAssembly(request({ id: "reviewer" }))).rejects.toMatchObject({
			code: "RUNTIME_HOST_AGENT_BACKEND_UNAVAILABLE",
		});
		expect(dispose).not.toHaveBeenCalled();
		await existing.lifecycle.dispose();
		await retirement?.dispose();
		expect(dispose).toHaveBeenCalledOnce();
		expect(registry.snapshot().removedAgentCount).toBe(1);
	});

	it("uses Catalog ownership for resume and rejects ambiguous persisted Sessions", async () => {
		const defaultBackend = backend("default");
		const alpha = backend("alpha");
		const beta = backend("beta");
		const registry = new RuntimeHostAgentBackendRegistry({ defaultBackend });
		registry.upsert({
			agentId: "alpha",
			source: { id: "code", revision: "1" },
			backend: alpha,
			catalog: catalog((path) => path.endsWith("alpha.jsonl")),
		});
		registry.upsert({
			agentId: "beta",
			source: { id: "code", revision: "1" },
			backend: beta,
			catalog: catalog((path) => path.endsWith("alpha.jsonl")),
		});

		await expect(registry.createAssembly(request(undefined, "C:/sessions/alpha.jsonl"))).rejects.toMatchObject({
			code: "RUNTIME_HOST_AGENT_BACKEND_AMBIGUOUS_SESSION",
		});
		expect(defaultBackend.createAssembly).not.toHaveBeenCalled();

		registry.remove("beta");
		const resumed = await registry.createAssembly(request(undefined, "C:/sessions/alpha.jsonl"));
		expect(resumed.lifecycle.sessionId).toBe("alpha");
		await resumed.lifecycle.dispose();
	});

	it("releases a route lease when Backend creation fails", async () => {
		const dispose = vi.fn(async () => {});
		const failure = new Error("contains-private-create-details");
		const failingBackend: RuntimeHostSessionBackend = {
			createAssembly: vi.fn(async () => {
				throw failure;
			}),
			dispose,
		};
		const registry = new RuntimeHostAgentBackendRegistry();
		registry.upsert({
			agentId: "failing",
			source: { id: "code", revision: "1" },
			backend: failingBackend,
			ownsBackend: true,
		});

		await expect(registry.createAssembly(request({ id: "failing" }))).rejects.toBe(failure);
		expect(registry.snapshot().activeLeaseCount).toBe(0);
		const retirement = registry.remove("failing");
		await retirement?.dispose();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("retains failed Backend disposal for an explicit retry", async () => {
		const dispose = vi.fn().mockRejectedValueOnce(new Error("first failure")).mockResolvedValueOnce(undefined);
		const registry = new RuntimeHostAgentBackendRegistry();
		registry.upsert({
			agentId: "retryable",
			source: { id: "code", revision: "1" },
			backend: backend("retryable", dispose),
			ownsBackend: true,
		});
		const retirement = registry.remove("retryable");

		await expect(retirement?.dispose()).rejects.toThrow("first failure");
		expect(registry.snapshot().generationCount).toBe(1);
		await retirement?.dispose();
		expect(dispose).toHaveBeenCalledTimes(2);
		expect(registry.snapshot().generationCount).toBe(0);
	});

	it("publishes only safe admission diagnostics", async () => {
		const records: RuntimeObservationRecord[] = [];
		const observationPublisher = createRuntimeObservationPublisher({
			port: {
				record: (record) => {
					records.push(record);
				},
			},
		});
		const registry = new RuntimeHostAgentBackendRegistry({
			observationPublisher,
		});
		registry.upsert({
			agentId: "safe",
			source: { id: "plugin", revision: "secret-free-revision" },
			backend: {
				createAssembly: async () => {
					throw new Error("secret prompt and token");
				},
			},
		});

		await expect(registry.createAssembly(request({ id: "safe" }))).rejects.toThrow();
		await observationPublisher.flush();
		const admissionRecords = records.filter(
			(record): record is RuntimeObservationRecord<RuntimeHostAgentBackendObservation> =>
				record.token.id === RUNTIME_HOST_AGENT_BACKEND_OBSERVATION.id,
		);
		expect(admissionRecords.some((record) => record.payload.phase === "failed")).toBe(true);
		expect(JSON.stringify(admissionRecords)).not.toContain("secret prompt and token");
	});
});

function backend(
	sessionId: string,
	dispose?: () => Promise<void>,
): RuntimeHostSessionBackend & {
	readonly createAssembly: ReturnType<typeof vi.fn>;
} {
	return {
		createAssembly: vi.fn(async () => assembly(sessionId)),
		...(dispose ? { dispose } : {}),
	};
}

function catalog(ownsSession: (path: string) => boolean): RuntimeSessionCatalog {
	return {
		ownsSession: async (path) => ownsSession(path),
		listProjects: async () => [],
		listSessions: async () => [],
		renameSession: async () => {},
		deleteSessionArtifacts: async () => {},
	};
}

function request(agent?: RuntimeSessionCreateRequest["agent"], sessionPath?: string): RuntimeSessionCreateRequest {
	return {
		agent,
		sessionPath,
		executionMode: "full-access",
		getSessionId: () => undefined,
	};
}

function assembly(sessionId: string): RuntimeHostSessionAssembly {
	return {
		lifecycle: { sessionId, sessionPath: undefined, dispose: async () => {} },
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
		configurationController: {
			setSteeringMode: () => {},
			setFollowUpMode: () => {},
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

function sequentialIds(): () => string {
	let sequence = 0;
	return () => `backend-${++sequence}`;
}
