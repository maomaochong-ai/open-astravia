import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { AskUserQuestionCapability, AskUserQuestionRequest } from "@vetta/runtime-tools/coding";
import { describe, expect, it } from "vitest";
import { DynamicContributionCatalog } from "../../src/interception/contribution-catalog.js";
import {
	CODING_AGENT_TOOL_INTERCEPTION_ORDER,
	type CodingAgentToolInterceptor,
} from "../../src/interception/tool/contracts.js";
import { wrapRuntimeToolsWithInterceptionPipeline } from "../../src/interception/tool/pipeline.js";
import {
	createHeavyToolConfirmationInterceptor,
	DEFAULT_HEAVY_TOOL_CONFIRMATION_TEXTS,
	type HeavyToolConfirmationFallback,
	HeavyToolConfirmationLedger,
} from "../../src/tool-policy/heavy-tool-confirmation.js";
import { createCodingAgentToolSideEffectResolver } from "../../src/tool-policy/tool-side-effect.js";

describe("heavy tool confirmation gate", () => {
	it("asks for confirmation before the first heavy tool call in a session", async () => {
		const harness = createHarness();

		const result = await harness.run("vetd_create");

		expect(harness.asked).toHaveLength(1);
		expect(harness.asked[0]?.questions[0]?.question).toContain("vetd_create");
		expect(harness.executed).toEqual(["vetd_create"]);
		expect(result.content[0]).toEqual({ type: "text", text: "ok" });
	});

	it("skips confirmation for later calls in the same session and re-asks in another session", async () => {
		const harness = createHarness();

		await harness.run("vetd_create");
		await harness.run("vetd_create");
		await harness.run("vetd_create", { sessionId: "other-session" });

		expect(harness.asked).toHaveLength(2);
		expect(harness.executed).toEqual(["vetd_create", "vetd_create", "vetd_create"]);
	});

	it("asks only once when the same heavy tool is called concurrently", async () => {
		let release: (() => void) | undefined;
		const harness = createHarness({
			answer: async () => {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return DEFAULT_HEAVY_TOOL_CONFIRMATION_TEXTS.allowLabel;
			},
		});

		const calls = [harness.run("vetd_create"), harness.run("vetd_create")];
		await vi_waitFor(() => release !== undefined);
		release?.();
		await Promise.all(calls);

		expect(harness.asked).toHaveLength(1);
		expect(harness.executed).toEqual(["vetd_create", "vetd_create"]);
	});

	it("fails the call without side effects when the user declines", async () => {
		const harness = createHarness({ answer: async () => DEFAULT_HEAVY_TOOL_CONFIRMATION_TEXTS.denyLabel });

		await expect(harness.run("vetd_create")).rejects.toThrow(/User declined to run "vetd_create"/);

		expect(harness.executed).toEqual([]);
	});

	it("treats a cancelled question as a decline", async () => {
		const harness = createHarness({ cancelled: true });

		await expect(harness.run("vetd_create")).rejects.toThrow(/did not run and no side effect was produced/);

		expect(harness.executed).toEqual([]);
	});

	it("treats free-text answers as a decline and re-asks on the next call", async () => {
		const harness = createHarness({ answer: async () => "先看看再说" });

		await expect(harness.run("vetd_create")).rejects.toThrow(/User declined to run "vetd_create"/);
		await expect(harness.run("vetd_create")).rejects.toThrow(/User declined to run "vetd_create"/);

		expect(harness.asked).toHaveLength(2);
		expect(harness.executed).toEqual([]);
	});

	it("fails the call when the confirmation channel itself errors", async () => {
		const harness = createHarness({
			answer: async () => {
				throw new Error("renderer gone");
			},
		});

		await expect(harness.run("vetd_create")).rejects.toThrow(/renderer gone/);

		expect(harness.executed).toEqual([]);
	});

	it("leaves light tools untouched", async () => {
		const harness = createHarness();

		await harness.run("read");
		await harness.run("read");

		expect(harness.asked).toEqual([]);
		expect(harness.executed).toEqual(["read", "read"]);
	});

	it("blocks the first call then allows a retry when no host:ask capability exists", async () => {
		const harness = createHarness({ withoutCapability: true });

		await expect(harness.run("vetd_create")).rejects.toThrow(/no interactive confirmation channel/);
		expect(harness.executed).toEqual([]);

		await harness.run("vetd_create");

		expect(harness.executed).toEqual(["vetd_create"]);
		expect(harness.asked).toEqual([]);
	});

	it("blocks the first call when the host:ask capability is present but disabled", async () => {
		const harness = createHarness({ enabled: false });

		await expect(harness.run("vetd_create")).rejects.toThrow(/no interactive confirmation channel/);

		expect(harness.asked).toEqual([]);
		expect(harness.executed).toEqual([]);
	});

	it("keeps failing under the block fallback", async () => {
		const harness = createHarness({ withoutCapability: true, fallback: "block" });

		await expect(harness.run("vetd_create")).rejects.toThrow(/Proceed without it/);
		await expect(harness.run("vetd_create")).rejects.toThrow(/Proceed without it/);

		expect(harness.executed).toEqual([]);
	});

	it("honours an explicit light declaration over the default heavy name list", async () => {
		const harness = createHarness({ declarations: [{ name: "vetd_create", side_effect: "light" }] });

		await harness.run("vetd_create");

		expect(harness.asked).toEqual([]);
		expect(harness.executed).toEqual(["vetd_create"]);
	});

	it("confirms a tool declared heavy by a plugin contribution", async () => {
		const harness = createHarness({ declarations: [{ name: "read", side_effect: "HEAVY" }] });

		await harness.run("read");

		expect(harness.asked).toHaveLength(1);
		expect(harness.executed).toEqual(["read"]);
	});
});

interface HarnessOptions {
	/** 模拟宿主完全没有 host:ask 能力。 */
	readonly withoutCapability?: boolean;
	readonly enabled?: boolean;
	readonly cancelled?: boolean;
	readonly answer?: () => Promise<string>;
	readonly fallback?: HeavyToolConfirmationFallback;
	readonly declarations?: readonly { name: string; side_effect?: unknown }[];
}

function createHarness(options: HarnessOptions = {}) {
	const asked: AskUserQuestionRequest[] = [];
	const executed: string[] = [];
	const capability: AskUserQuestionCapability | undefined = options.withoutCapability
		? undefined
		: {
				isEnabled: () => options.enabled ?? true,
				ask: async (request) => {
					asked.push(request);
					if (options.cancelled) return { cancelled: true, answers: [] };
					const answer = await (options.answer?.() ??
						Promise.resolve(DEFAULT_HEAVY_TOOL_CONFIRMATION_TEXTS.allowLabel));
					return {
						cancelled: false,
						answers: request.questions.map((question) => ({
							question: question.question,
							answers: [answer],
						})),
					};
				},
			};
	const interceptor: CodingAgentToolInterceptor = createHeavyToolConfirmationInterceptor({
		ledger: new HeavyToolConfirmationLedger(),
		capability,
		fallback: options.fallback,
		resolveSideEffect: createCodingAgentToolSideEffectResolver({
			readDeclarations: () => options.declarations ?? [],
		}),
	});
	const catalog = new DynamicContributionCatalog<CodingAgentToolInterceptor>();
	catalog.register({
		sourceId: "tool-policy",
		localId: "heavy-tool-confirmation",
		revision: "test",
		order: CODING_AGENT_TOOL_INTERCEPTION_ORDER.sideEffectConfirmation,
		value: interceptor,
	});
	const tools = wrapRuntimeToolsWithInterceptionPipeline(
		new Map([
			["vetd_create", createTool("vetd_create", executed)],
			["read", createTool("read", executed)],
		]),
		catalog,
	);

	return {
		asked,
		executed,
		run: (toolName: string, overrides: { sessionId?: string } = {}) =>
			tools.get(toolName)!.execute({
				sessionId: overrides.sessionId ?? "session",
				turnId: "turn",
				toolCallId: `call-${executed.length}`,
				input: {},
				signal: new AbortController().signal,
			}),
	};
}

function createTool(name: string, executed: string[]): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description: name,
		inputSchema: { type: "object" },
		execute: async () => {
			executed.push(name);
			return { content: [{ type: "text", text: "ok" }] };
		},
	};
}

async function vi_waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("condition was never met");
}
