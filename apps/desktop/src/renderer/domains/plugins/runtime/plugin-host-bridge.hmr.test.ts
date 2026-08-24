import { beforeEach, describe, expect, it, vi } from "vitest";

const RUNTIME_STATE_KEY = "__vettaPluginHostBridgeRuntimeState_v1";

vi.mock("@shared/store/atoms", async () => {
	const { atom } = await import("jotai");
	return {
		activeSessionAtom: atom(null),
		chatMessagesAtom: atom([]),
		inputValueAtom: atom(""),
		isStreamingAtom: atom(false),
		languageAtom: atom("zh"),
		openSessionFnRef: { current: null },
		promptAttachmentAtom: atom(null),
		selectedModelAtom: atom(null),
		sessionExecutionModeAtom: atom("workspace-write"),
	};
});

beforeEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
	delete (globalThis as unknown as Record<string, unknown>)[RUNTIME_STATE_KEY];
});

describe("plugin host bridge HMR lifecycle", () => {
	it("reuses handlers and IPC listener guards when the bridge module is evaluated again", async () => {
		const toolRequestListeners: Array<(request: unknown) => void> = [];
		const respondAgentTool = vi.fn(async () => undefined);
		const plugins = {
			onAgentToolRequest: (listener: (request: unknown) => void) => {
				toolRequestListeners.push(listener);
				return () => undefined;
			},
			onAgentHookRequest: () => () => undefined,
			onAgentHandlerReleased: () => () => undefined,
			onAppActionRequest: () => () => undefined,
			onAppActionCancel: () => () => undefined,
			onContinuationRequest: () => () => undefined,
			onSystemPromptRequest: () => () => undefined,
			onMediaProviderRequest: () => () => undefined,
			respondAgentTool,
		};
		vi.stubGlobal("window", {
			vetta: {
				plugins,
				session: { subscribe: async () => () => undefined },
			},
		});

		const first = await import("./plugin-host-bridge.js");
		first.installPluginHostBridge();
		first.registerPluginAgentToolHandler({
			pluginId: "demo",
			toolId: "inspect",
			handlerId: "inspect:handler",
			activationId: "activation-1",
			handler: async () => ({ ok: true }),
			api: {} as never,
		});

		vi.resetModules();
		const reloaded = await import("./plugin-host-bridge.js");
		reloaded.installPluginHostBridge();

		expect(toolRequestListeners).toHaveLength(1);
		toolRequestListeners[0]?.({
			requestId: "request-1",
			pluginId: "demo",
			toolId: "inspect",
			toolName: "demo_inspect",
			handlerId: "inspect:handler",
			activationId: "activation-1",
			settings: {},
			input: {},
			session: { id: "session-1", cwd: "C:/workspace", scenario: "project" },
			model: { provider: "test", id: "test", api: "test", input: [] },
			conversation: { messages: [], messageCount: 0 },
			runtime: { activeToolNames: ["demo_inspect"], availableToolNames: ["demo_inspect"], runIndex: 0 },
			trigger: { kind: "tool-call", timestamp: 1, toolCallId: "call-1" },
		});

		await vi.waitFor(() => {
			expect(respondAgentTool).toHaveBeenCalledTimes(1);
		});
		expect(respondAgentTool).toHaveBeenCalledWith("request-1", {
			value: { ok: true },
			effects: [],
		});
	});
});
