import {
	type EcosystemHookAdapter,
	type EcosystemHookEvent,
	EcosystemHookRuntime,
	emptyHookDispatchOutcome,
	type HookDispatchOutcome,
} from "@vetta/ecosystem-adapter/hooks";
import { describe, expect, it } from "vitest";
import { CodingAgentPromptRequestAdapter } from "../../src/adapters/runtime-core/prompt-request-adapter.js";

describe("CodingAgentPromptRequestAdapter ecosystem hooks", () => {
	it("preserves Legacy SessionStart/UserPrompt context ordering for idle and queued prompts", async () => {
		const events: EcosystemHookEvent[] = [];
		const hookRuntime = runtimeFor((event) => {
			events.push(event);
			if (event.eventName === "SessionStart") {
				return outcome({ additionalContexts: ["session context"] });
			}
			if (event.eventName === "UserPromptSubmit") {
				return outcome({ additionalContexts: [`prompt context: ${event.prompt}`] });
			}
			return emptyHookDispatchOutcome();
		});
		const adapter = new CodingAgentPromptRequestAdapter({
			hookRuntime,
			now: () => 42,
			resolvePromptResource: async () => ({
				text: "expanded prompt",
				skillInjection: "skill injection",
			}),
		});

		const idle = await adapter.prepare(
			{ text: "original", promptRef: { kind: "skill", name: "demo" } },
			{ sessionId: "session-1", queueing: false },
		);
		expect(idle.input.context?.map(({ type }) => type)).toEqual([
			"ecosystem_hook_context",
			"ecosystem_hook_context",
			"skill_expansion",
		]);
		expect(idle.input.context?.map(({ content }) => content)).toEqual([
			"session context",
			"prompt context: expanded prompt",
			"skill injection",
		]);
		expect(idle.input.message).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "expanded prompt" }],
			timestamp: 42,
		});

		const queued = await adapter.prepare(
			{
				text: "queued",
				promptRef: { kind: "skill", name: "demo" },
				streamingBehavior: "followUp",
			},
			{ sessionId: "session-1", queueing: true },
		);
		expect(queued.input.context).toBeUndefined();
		expect(queued.input.message.content).toEqual([
			{
				type: "text",
				text: "prompt context: expanded prompt\n\nskill injection\n\nexpanded prompt",
			},
		]);
		expect(events.map(({ eventName }) => eventName)).toEqual([
			"SessionStart",
			"UserPromptSubmit",
			"UserPromptSubmit",
		]);
	});

	it("rejects blocked prompts with the existing error precedence", async () => {
		const hookRuntime = runtimeFor((event) =>
			event.eventName === "UserPromptSubmit"
				? outcome({ shouldBlock: true, blockReason: "prompt denied" })
				: emptyHookDispatchOutcome(),
		);
		const adapter = new CodingAgentPromptRequestAdapter({ hookRuntime });

		await expect(adapter.prepare({ text: "blocked" }, { sessionId: "session-1", queueing: false })).rejects.toThrow(
			"prompt denied",
		);
	});
});

function runtimeFor(resolve: (event: EcosystemHookEvent) => HookDispatchOutcome): EcosystemHookRuntime {
	const adapter: EcosystemHookAdapter = {
		id: "test",
		supports: () => true,
		dispatch: async (event) => resolve(event),
	};
	return new EcosystemHookRuntime({
		host: {
			cwd: "C:\\workspace",
			getSessionId: () => "session-1",
			getTranscriptPath: () => "session.jsonl",
			getModelId: () => "model-1",
			abortCurrentRun() {},
		},
		initialSessionStartSource: "startup",
		loadAdapters: async () => [adapter],
	});
}

function outcome(overrides: Partial<HookDispatchOutcome>): HookDispatchOutcome {
	return { ...emptyHookDispatchOutcome(), ...overrides };
}
