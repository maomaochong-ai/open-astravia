import {
	type EcosystemHookAdapter,
	type EcosystemHookEvent,
	EcosystemHookRuntime,
	emptyHookDispatchOutcome,
	type HookDispatchOutcome,
} from "@vetta/ecosystem-adapter/hooks";
import { describe, expect, it, vi } from "vitest";
import { CodingAgentPromptRequestAdapter } from "../../src/adapters/runtime-core/prompt-request-adapter.js";
import { preparePrompt } from "./prompt-adapter-test-fixture.js";

describe("CodingAgentPromptRequestAdapter ecosystem hooks", () => {
	it("uses the Extension input interceptor captured at Turn admission", async () => {
		let revision = "r1";
		const release = vi.fn();
		const adapter = new CodingAgentPromptRequestAdapter({
			extensionEvents: {
				bindForTurn: () => {
					const captured = revision;
					return {
						releaseTurnBinding: release,
						interceptInput: async () => ({ action: "transform", text: captured }),
					};
				},
				interceptInput: async () => ({ action: "transform", text: revision }),
			},
		});
		const bound = adapter.bindForTurn({
			sessionId: "session-1",
			operationId: "turn-1",
			reason: "turn",
			signal: new AbortController().signal,
		});
		revision = "r2";

		const result = await bound.prepare(adapter.createRequest({ text: "original" }), {
			sessionId: "session-1",
			turnId: "turn-1",
			queueing: false,
			signal: new AbortController().signal,
		});

		expect(result).toMatchObject({
			action: "continue",
			input: { message: { content: [{ type: "text", text: "r1" }] } },
		});
		await bound.releaseTurnBinding?.();
		expect(release).toHaveBeenCalledOnce();
	});

	it("registers an explicitly expanded Skill contribution before UserPromptSubmit", async () => {
		const order: string[] = [];
		const register = vi.fn(() => order.push("register"));
		const hookRuntime = runtimeFor((event) => {
			order.push(event.eventName);
			return emptyHookDispatchOutcome();
		}, register);
		const adapter = new CodingAgentPromptRequestAdapter({
			hookRuntime,
			resolvePromptResource: () => ({
				text: "expanded prompt",
				skillInjection: "skill injection",
				skillHookContribution: {
					id: "skill:C:/skills/demo/SKILL.md",
					revision: "v1",
					profileId: "test",
					sourcePath: "C:/skills/demo/SKILL.md",
					configuration: { UserPromptSubmit: [] },
				},
			}),
		});

		await preparePrompt(
			adapter,
			{ text: "original", promptRef: { kind: "skill", name: "demo" } },
			{ sessionId: "session-1", queueing: false },
		);

		expect(register).toHaveBeenCalledTimes(1);
		expect(order).toEqual(["SessionStart", "register", "UserPromptSubmit"]);
	});

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

		const idle = await preparePrompt(
			adapter,
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

		const queued = await preparePrompt(
			adapter,
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

		await expect(
			preparePrompt(adapter, { text: "blocked" }, { sessionId: "session-1", queueing: false }),
		).rejects.toThrow("prompt denied");
	});
});

function runtimeFor(
	resolve: (event: EcosystemHookEvent) => HookDispatchOutcome,
	onRegister?: () => void,
): EcosystemHookRuntime {
	const adapter: EcosystemHookAdapter = {
		id: "test",
		supports: () => true,
		dispatch: async (event) => resolve(event),
		async registerContribution() {
			onRegister?.();
			return { release() {} };
		},
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
