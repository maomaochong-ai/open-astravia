import { type TSchema, Type } from "@sinclair/typebox";
import type { AgentTool } from "@vetta/agent-core";
import {
	type EcosystemHookAdapter,
	type EcosystemHookEvent,
	EcosystemHookRuntime,
	emptyHookDispatchOutcome,
	type HookDispatchOutcome,
} from "@vetta/ecosystem-adapter/hooks";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	type EcosystemHookAwareRuntimeTool,
	wrapRuntimeToolsWithEcosystemHooks,
} from "../../src/adapters/runtime-core/ecosystem-hook-tool-wrapper.js";
import {
	type EcosystemHookAwareTool,
	wrapToolsWithEcosystemHooks,
} from "../../src/extensions/runtime/ecosystem-hook-tool-wrapper.js";

describe("Greenfield ecosystem tool hook compatibility", () => {
	it("matches Legacy input rewrite, metadata, feedback and additional-context behavior", async () => {
		const legacy = createHookHarness(successOutcome);
		const greenfield = createHookHarness(successOutcome);
		const legacyInputs: unknown[] = [];
		const greenfieldInputs: unknown[] = [];
		const legacyTool: EcosystemHookAwareTool = {
			name: "mcp_demo_lookup",
			label: "Lookup",
			description: "Lookup",
			parameters: Type.Object({ value: Type.String() }),
			ecosystemHook: MCP_DESCRIPTOR,
			async execute(_toolCallId, input) {
				legacyInputs.push(input);
				return { content: [{ type: "text", text: "raw" }], details: { source: "legacy" } };
			},
		};
		const runtimeTool: EcosystemHookAwareRuntimeTool = {
			name: legacyTool.name,
			label: legacyTool.label,
			description: legacyTool.description,
			inputSchema: legacyTool.parameters,
			ecosystemHook: MCP_DESCRIPTOR,
			async execute(request) {
				greenfieldInputs.push({
					sessionId: request.sessionId,
					turnId: request.turnId,
					input: request.input,
				});
				return { content: [{ type: "text", text: "raw" }], details: { source: "legacy" } };
			},
		};

		const legacyResult = await wrappedLegacyTool(legacyTool, legacy.runtime).execute(
			"call-1",
			{ value: "original" },
			new AbortController().signal,
		);
		const greenfieldResult = await wrappedRuntimeTool(runtimeTool, greenfield.runtime).execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: { value: "original" },
			signal: new AbortController().signal,
		});

		expect(greenfieldResult).toEqual(legacyResult);
		expect(legacyInputs).toEqual([{ value: "rewritten" }]);
		expect(greenfieldInputs).toEqual([{ sessionId: "session-1", turnId: "turn-1", input: { value: "rewritten" } }]);
		expect(greenfield.contexts).toEqual(legacy.contexts);
		expect(greenfield.events.map(projectToolEvent)).toEqual(legacy.events.map(projectToolEvent));
	});

	it("matches Legacy failure feedback and does not classify Hook blocks as tool failures", async () => {
		const legacy = createHookHarness(failureOutcome);
		const greenfield = createHookHarness(failureOutcome);
		const failingLegacyTool = agentTool(async () => {
			throw new Error("boom");
		});
		const failingRuntimeTool = runtimeTool(async () => {
			throw new Error("boom");
		});

		await expect(
			wrappedLegacyTool(failingLegacyTool, legacy.runtime).execute(
				"call-1",
				{ value: "original" },
				new AbortController().signal,
			),
		).rejects.toThrow("boom\n\nfailure feedback");
		await expect(
			wrappedRuntimeTool(failingRuntimeTool, greenfield.runtime).execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "call-1",
				input: { value: "original" },
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("boom\n\nfailure feedback");
		expect(greenfield.contexts).toEqual(legacy.contexts);
		expect(greenfield.events.map(({ eventName }) => eventName)).toEqual(["PreToolUse", "PostToolUseFailure"]);

		const blockedLegacy = createHookHarness(blockingOutcome);
		const blockedGreenfield = createHookHarness(blockingOutcome);
		const legacyExecute = vi.fn(async () => ({ content: [], details: {} }));
		const greenfieldExecute = vi.fn(async () => ({ content: [] }));
		await expect(
			wrappedLegacyTool(agentTool(legacyExecute), blockedLegacy.runtime).execute(
				"call-2",
				{ value: "original" },
				new AbortController().signal,
			),
		).rejects.toThrow("blocked");
		await expect(
			wrappedRuntimeTool(runtimeTool(greenfieldExecute), blockedGreenfield.runtime).execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "call-2",
				input: { value: "original" },
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("blocked");
		expect(legacyExecute).not.toHaveBeenCalled();
		expect(greenfieldExecute).not.toHaveBeenCalled();
		expect(blockedGreenfield.events.map(({ eventName }) => eventName)).toEqual(["PreToolUse"]);
	});
});

function createHookHarness(resolve: (event: EcosystemHookEvent) => HookDispatchOutcome) {
	const contexts: string[] = [];
	const events: EcosystemHookEvent[] = [];
	const adapter: EcosystemHookAdapter = {
		id: "test",
		supports: () => true,
		async dispatch(event) {
			events.push(event);
			return resolve(event);
		},
	};
	const runtime = new EcosystemHookRuntime({
		host: {
			cwd: "C:\\workspace",
			getSessionId: () => "session-1",
			getTranscriptPath: () => "session.jsonl",
			getModelId: () => "model-1",
			recordAdditionalContexts: (values) => {
				contexts.push(...values);
			},
			abortCurrentRun() {},
		},
		initialSessionStartSource: "startup",
		loadAdapters: async () => [adapter],
	});
	return { contexts, events, runtime };
}

function successOutcome(event: EcosystemHookEvent): HookDispatchOutcome {
	if (event.eventName === "PreToolUse") {
		return outcome({ additionalContexts: ["pre context"], updatedToolInput: { value: "rewritten" } });
	}
	if (event.eventName === "PostToolUse") {
		return outcome({ additionalContexts: ["post context"], feedbackMessage: "post feedback" });
	}
	return emptyHookDispatchOutcome();
}

function failureOutcome(event: EcosystemHookEvent): HookDispatchOutcome {
	if (event.eventName === "PostToolUseFailure") {
		return outcome({ additionalContexts: ["failure context"], feedbackMessage: "failure feedback" });
	}
	return emptyHookDispatchOutcome();
}

function blockingOutcome(event: EcosystemHookEvent): HookDispatchOutcome {
	return event.eventName === "PreToolUse"
		? outcome({ shouldBlock: true, blockReason: "blocked" })
		: emptyHookDispatchOutcome();
}

function outcome(overrides: Partial<HookDispatchOutcome>): HookDispatchOutcome {
	return { ...emptyHookDispatchOutcome(), ...overrides };
}

function agentTool(
	execute: AgentTool<ReturnType<typeof Type.Object<{ value: ReturnType<typeof Type.String> }>>, unknown>["execute"],
): AgentTool<ReturnType<typeof Type.Object<{ value: ReturnType<typeof Type.String> }>>, unknown> {
	return {
		name: "test",
		label: "Test",
		description: "Test",
		parameters: Type.Object({ value: Type.String() }),
		execute,
	};
}

function runtimeTool(execute: RuntimeToolDefinition["execute"]): RuntimeToolDefinition {
	return {
		name: "test",
		label: "Test",
		description: "Test",
		inputSchema: Type.Object({ value: Type.String() }),
		execute,
	};
}

function wrappedLegacyTool<TParameters extends TSchema, TDetails>(
	tool: AgentTool<TParameters, TDetails>,
	runtime: EcosystemHookRuntime,
): AgentTool<TParameters, TDetails> {
	const wrapped = wrapToolsWithEcosystemHooks([tool], runtime)[0];
	if (!wrapped) throw new Error("Legacy tool was not wrapped");
	return wrapped;
}

function wrappedRuntimeTool(tool: RuntimeToolDefinition, runtime: EcosystemHookRuntime): RuntimeToolDefinition {
	const wrapped = wrapRuntimeToolsWithEcosystemHooks(new Map([[tool.name, tool]]), runtime).get(tool.name);
	if (!wrapped) throw new Error("Runtime tool was not wrapped");
	return wrapped;
}

function projectToolEvent(event: EcosystemHookEvent): unknown {
	if (
		event.eventName !== "PreToolUse" &&
		event.eventName !== "PostToolUse" &&
		event.eventName !== "PostToolUseFailure"
	) {
		return event.eventName;
	}
	return {
		eventName: event.eventName,
		tool: event.tool,
		toolUseId: event.toolUseId,
		toolInput: event.toolInput,
	};
}

const MCP_DESCRIPTOR = {
	hostName: "mcp_demo_lookup",
	kind: "mcp",
	source: {
		ecosystem: "mcp",
		serverName: "demo",
		originalName: "lookup",
	},
} as const;
