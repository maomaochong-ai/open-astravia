import { describe, expect, it, vi } from "vitest";
import {
	CatalogRoutedRuntimeHostSessionBackend,
	RuntimeHost,
	type RuntimeHostSessionAssembly,
	type RuntimeHostSessionBackend,
	type RuntimeSessionCatalog,
	type RuntimeSessionCreateRequest,
} from "../../src/index.js";

describe("CatalogRoutedRuntimeHostSessionBackend", () => {
	it("exposes a session-scoped view without creating a second lifecycle owner", async () => {
		const dispose = vi.fn(async () => {});
		const retry = vi.fn(async () => {});
		const sessionBackend: RuntimeHostSessionBackend = {
			createAssembly: async () => ({
				...assembly("session-view"),
				lifecycle: { sessionId: "session-view", sessionPath: "C:/sessions/view.jsonl", dispose },
				corePorts: {
					...assembly("session-view").corePorts,
					turnControl: {
						...assembly("session-view").corePorts.turnControl,
						retry,
					},
				},
			}),
		};
		const runtime = new RuntimeHost({ sessionBackend });
		const { sessionId } = await runtime.createSession();
		const session = runtime.getSessionView(sessionId);

		expect(session.sessionId).toBe("session-view");
		expect(session.sessionPath).toBe("C:/sessions/view.jsonl");
		expect(session.readState().isStreaming).toBe(false);
		await session.retry();
		expect(retry).toHaveBeenCalledOnce();

		await session.dispose();
		expect(dispose).toHaveBeenCalledOnce();
		expect(() => session.readState()).toThrow("Session not found");
	});

	it("uses the explicit default backend only for new sessions", async () => {
		const defaultBackend = backend("default");
		const legacyBackend = backend("legacy");
		const greenfieldBackend = backend("greenfield");
		const onRoute = vi.fn();
		const routed = new CatalogRoutedRuntimeHostSessionBackend({
			defaultBackend,
			defaultRouteId: "greenfield",
			routes: [
				{ id: "legacy", catalog: catalog((path) => path.endsWith(".jsonl")), backend: legacyBackend },
				{
					id: "greenfield",
					catalog: catalog((path) => path.endsWith(".conversation.jsonl")),
					backend: greenfieldBackend,
				},
			],
			onRoute,
		});

		await routed.createAssembly(request());

		expect(defaultBackend.createAssembly).toHaveBeenCalledOnce();
		expect(legacyBackend.createAssembly).not.toHaveBeenCalled();
		expect(greenfieldBackend.createAssembly).not.toHaveBeenCalled();
		expect(onRoute).toHaveBeenCalledWith({ routeId: "greenfield", source: "default" });
	});

	it("routes an existing path to the first catalog that owns its format", async () => {
		const defaultBackend = backend("default");
		const legacyBackend = backend("legacy");
		const greenfieldBackend = backend("greenfield");
		const onRoute = vi.fn();
		const routed = new CatalogRoutedRuntimeHostSessionBackend({
			defaultBackend,
			routes: [
				{ id: "legacy", catalog: catalog((path) => path.endsWith(".legacy.jsonl")), backend: legacyBackend },
				{
					id: "greenfield",
					catalog: catalog((path) => path.endsWith(".conversation.jsonl")),
					backend: greenfieldBackend,
				},
			],
			onRoute,
		});
		const input = request("C:/sessions/example.conversation.jsonl");

		await routed.createAssembly(input);

		expect(greenfieldBackend.createAssembly).toHaveBeenCalledWith(input);
		expect(defaultBackend.createAssembly).not.toHaveBeenCalled();
		expect(legacyBackend.createAssembly).not.toHaveBeenCalled();
		expect(onRoute).toHaveBeenCalledWith({ routeId: "greenfield", source: "catalog" });
	});

	it("rejects unknown persisted formats instead of falling back", async () => {
		const defaultBackend = backend("default");
		const onRoute = vi.fn();
		const routed = new CatalogRoutedRuntimeHostSessionBackend({
			defaultBackend,
			routes: [{ catalog: catalog(() => false), backend: backend("known") }],
			onRoute,
		});

		await expect(routed.createAssembly(request("C:/sessions/unknown.data"))).rejects.toThrow(
			"No RuntimeHost session backend owns",
		);
		expect(defaultBackend.createAssembly).not.toHaveBeenCalled();
		expect(onRoute).not.toHaveBeenCalled();
	});
});

function backend(sessionId: string): RuntimeHostSessionBackend & {
	readonly createAssembly: ReturnType<typeof vi.fn>;
} {
	return {
		createAssembly: vi.fn(async () => assembly(sessionId)),
	};
}

function catalog(owns: (path: string) => boolean): RuntimeSessionCatalog {
	return {
		ownsSession: async (path) => owns(path),
		listProjects: async () => [],
		listSessions: async () => [],
		renameSession: async () => {},
		deleteSessionArtifacts: async () => {},
	};
}

function request(sessionPath?: string): RuntimeSessionCreateRequest {
	return {
		sessionPath,
		executionMode: "full-access",
		enableSubagents: true,
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
