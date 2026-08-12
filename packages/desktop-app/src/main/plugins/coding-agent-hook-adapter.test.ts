import type { EcosystemHookEvent, HookRunSummary } from "@vetta/coding-agent/hooks";
import { PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES } from "@vetta-org/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopPluginHookAdapterFactory } from "./coding-agent-hook-adapter.js";
import { setDesktopPluginHookInvoker } from "./coding-agent-hook-invocation.js";
import { desktopPluginHookRegistry } from "./coding-agent-hook-registry.js";

describe("Desktop Plugin Coding Agent Hook adapter", () => {
	afterEach(() => {
		desktopPluginHookRegistry.clear("plugin-a");
		desktopPluginHookRegistry.clear("plugin-denied");
		setDesktopPluginHookInvoker(undefined);
	});

	it("maps every Coding Agent Hook event without exposing transcript paths", async () => {
		const received: unknown[] = [];
		setDesktopPluginHookInvoker(async (invocation) => {
			received.push(invocation.event);
			return { action: "continue" };
		});
		const events = allHookEvents();
		for (const [index, event] of events.entries()) {
			desktopPluginHookRegistry.register("plugin-a", {
				id: `all-events-${index}`,
				eventName: event.eventName,
				handlerId: `handler-${index}`,
				scope_use: ["cli"],
			});
		}
		const adapter = await createAdapter();

		for (const event of events) {
			await adapter.dispatch(event);
		}

		expect(received).toHaveLength(PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES.length);
		expect(received.map((event) => (event as { eventName: string }).eventName)).toEqual(
			PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES,
		);
		for (const event of received) {
			expect(event).not.toHaveProperty("transcriptPath");
			expect(event).not.toHaveProperty("agentTranscriptPath");
		}
	});

	it("dispatches canonical Coding Agent events and maps typed effects", async () => {
		desktopPluginHookRegistry.register("plugin-a", {
			id: "guard",
			eventName: "PreToolUse",
			handlerId: "handler-1",
			scope_use: ["cli"],
			toolNames: ["bash"],
		});
		const invoker = vi.fn(async () => ({
			action: "continue",
			updatedToolInput: { command: "echo safe" },
			additionalContexts: ["checked"],
		}));
		setDesktopPluginHookInvoker(invoker);
		const adapter = await createAdapter();

		const outcome = await adapter.dispatch(preToolEvent());

		expect(invoker).toHaveBeenCalledWith(
			expect.objectContaining({
				pluginId: "plugin-a",
				hookId: "guard",
				session: { id: "session-1", cwd: "C:/workspace", scenario: "cli" },
				event: expect.objectContaining({
					eventName: "PreToolUse",
					tool: expect.objectContaining({ hostName: "bash" }),
				}),
			}),
			expect.any(AbortSignal),
		);
		expect(outcome.updatedToolInput).toEqual({ command: "echo safe" });
		expect(outcome.additionalContexts).toEqual(["checked"]);
		expect(outcome.runs).toMatchObject([{ handlerType: "callback", status: "Completed" }]);
	});

	it("keeps Hook membership stable for the Turn and applies unregister to the next Turn", async () => {
		const released = vi.fn();
		const stopReleased = desktopPluginHookRegistry.onHandlerReleased(released);
		desktopPluginHookRegistry.register("plugin-a", {
			id: "guard",
			eventName: "PreToolUse",
			handlerId: "handler-1",
			activationId: "activation-1",
			scope_use: ["cli"],
		});
		let complete: ((value: unknown) => void) | undefined;
		setDesktopPluginHookInvoker(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const adapter = await createAdapter();

		const running = adapter.dispatch(preToolEvent());
		await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
		desktopPluginHookRegistry.unregister("plugin-a", "guard", "activation-1");
		expect(released).not.toHaveBeenCalled();
		complete?.({ action: "block", reason: "blocked" });

		expect((await running).shouldBlock).toBe(true);
		setDesktopPluginHookInvoker(async () => ({ action: "continue" }));
		expect((await adapter.dispatch(preToolEvent())).runs).toHaveLength(1);
		expect((await adapter.dispatch(preToolEvent("turn-2"))).runs).toHaveLength(0);
		expect(released).toHaveBeenCalledWith({
			pluginId: "plugin-a",
			handlerId: "handler-1",
			activationId: "activation-1",
		});
		stopReleased();
	});

	it("fails open for malformed renderer results and records a failed callback run", async () => {
		desktopPluginHookRegistry.register("plugin-a", {
			id: "invalid",
			eventName: "PreToolUse",
			handlerId: "handler-1",
			scope_use: ["cli"],
		});
		setDesktopPluginHookInvoker(async () => ({ action: "continue", permissionDecision: "allow" }));
		const failedRuns: unknown[] = [];
		const adapter = await createAdapter((run) => failedRuns.push(run));

		const outcome = await adapter.dispatch(preToolEvent());

		expect(outcome.shouldBlock).toBe(false);
		expect(outcome.shouldStop).toBe(false);
		expect(outcome.runs).toMatchObject([{ status: "Failed" }]);
		expect(failedRuns).toHaveLength(1);
	});

	it("filters dynamic hooks by plugin state, scenario, agent mode and tool name", async () => {
		for (const registration of [
			{ id: "allowed", scope_use: ["cli"], agent_mode: ["coding"], toolNames: ["bash"] },
			{ id: "wrong-scope", scope_use: ["project"], agent_mode: ["coding"], toolNames: ["bash"] },
			{ id: "wrong-mode", scope_use: ["cli"], agent_mode: ["work"], toolNames: ["bash"] },
			{ id: "wrong-tool", scope_use: ["cli"], agent_mode: ["coding"], toolNames: ["write"] },
		] as const) {
			desktopPluginHookRegistry.register("plugin-a", {
				...registration,
				eventName: "PreToolUse",
				handlerId: registration.id,
			});
		}
		desktopPluginHookRegistry.register("plugin-denied", {
			id: "denied",
			eventName: "PreToolUse",
			handlerId: "denied",
			scope_use: ["cli"],
		});
		const invoker = vi.fn(async () => ({ action: "continue" }));
		setDesktopPluginHookInvoker(invoker);
		const adapter = await createAdapter(undefined, (pluginId) => pluginId !== "plugin-denied");

		await adapter.dispatch(preToolEvent());

		expect(invoker).toHaveBeenCalledOnce();
		expect(invoker).toHaveBeenCalledWith(expect.objectContaining({ hookId: "allowed" }), expect.any(AbortSignal));
	});

	it("propagates timeout and parent cancellation while failing open", async () => {
		desktopPluginHookRegistry.register("plugin-a", {
			id: "timeout",
			eventName: "PreToolUse",
			handlerId: "handler-1",
			scope_use: ["cli"],
			timeoutMs: 5,
		});
		const abortReasons: unknown[] = [];
		setDesktopPluginHookInvoker(
			(_invocation, signal) =>
				new Promise((_resolve, reject) => {
					signal?.addEventListener(
						"abort",
						() => {
							abortReasons.push(signal.reason);
							reject(signal.reason);
						},
						{ once: true },
					);
				}),
		);
		const adapter = await createAdapter();

		const timedOut = await adapter.dispatch(preToolEvent());
		expect(timedOut.runs).toMatchObject([{ status: "Failed" }]);

		desktopPluginHookRegistry.register("plugin-a", {
			id: "timeout",
			eventName: "PreToolUse",
			handlerId: "handler-1",
			scope_use: ["cli"],
			timeoutMs: 1_000,
		});
		const controller = new AbortController();
		const cancelledPromise = adapter.dispatch(preToolEvent("turn-2"), controller.signal);
		controller.abort(new Error("parent cancelled"));
		const cancelled = await cancelledPromise;

		expect(cancelled.runs).toMatchObject([{ status: "Failed" }]);
		expect(abortReasons).toHaveLength(2);
	});
});

async function createAdapter(
	onFailedRun: (run: HookRunSummary) => void = () => {},
	canInvoke: (pluginId: string) => boolean = () => true,
) {
	const factory = createDesktopPluginHookAdapterFactory({
		scenario: "cli",
		readAgentMode: () => "coding",
		canInvoke,
	});
	const adapter = await factory({
		cwd: "C:/workspace",
		configLayers: [],
		onDiagnostic: () => {},
		onFailedRun,
	});
	if (!adapter) throw new Error("Expected Desktop Plugin Hook adapter");
	return adapter;
}

function allHookEvents(): EcosystemHookEvent[] {
	const base = {
		sessionId: "session-1",
		cwd: "C:/workspace",
		transcriptPath: "C:/sessions/session-1.jsonl",
		model: "test-model",
		permissionMode: "default" as const,
	};
	const tool = { hostName: "bash", kind: "shell" as const };
	return [
		{ ...base, eventName: "SessionStart", source: "startup" },
		{ ...base, eventName: "SessionEnd", cause: "dispose" },
		{ ...base, eventName: "UserPromptSubmit", turnId: "turn-1", prompt: "hello" },
		{ ...base, eventName: "PreToolUse", turnId: "turn-1", tool, toolUseId: "tool-1", toolInput: {} },
		{ ...base, eventName: "PermissionRequest", turnId: "turn-1", tool, toolInput: {}, runIdSuffix: "1" },
		{
			...base,
			eventName: "PostToolUse",
			turnId: "turn-1",
			tool,
			toolUseId: "tool-1",
			toolInput: {},
			toolResponse: "ok",
		},
		{
			...base,
			eventName: "PostToolUseFailure",
			turnId: "turn-1",
			tool,
			toolUseId: "tool-1",
			toolInput: {},
			error: "failed",
			isInterrupt: false,
			durationMs: 10,
		},
		{ ...base, eventName: "PreCompact", turnId: "turn-1", trigger: "auto" },
		{ ...base, eventName: "PostCompact", turnId: "turn-1", trigger: "auto" },
		{
			...base,
			eventName: "SubagentStart",
			turnId: "turn-1",
			agentId: "agent-1",
			agentType: "explore",
		},
		{
			...base,
			eventName: "SubagentStop",
			turnId: "turn-1",
			agentId: "agent-1",
			agentType: "explore",
			stopHookActive: false,
			lastAssistantMessage: "done",
			agentTranscriptPath: "C:/sessions/agent-1.jsonl",
		},
		{ ...base, eventName: "Stop", turnId: "turn-1", stopHookActive: false, lastAssistantMessage: "done" },
	];
}

function preToolEvent(turnId = "turn-1"): EcosystemHookEvent {
	return {
		eventName: "PreToolUse",
		sessionId: "session-1",
		turnId,
		cwd: "C:/workspace",
		transcriptPath: "C:/sessions/session-1.jsonl",
		model: "test-model",
		permissionMode: "default",
		tool: { hostName: "bash", kind: "shell" },
		toolUseId: "tool-1",
		toolInput: { command: "echo original" },
	};
}
