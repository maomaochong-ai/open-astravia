import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import { DynamicContributionCatalog } from "../../src/interception/contribution-catalog.js";
import {
	CODING_AGENT_TOOL_INTERCEPTION_ORDER,
	type CodingAgentToolInterceptor,
} from "../../src/interception/tool/contracts.js";
import { wrapRuntimeToolsWithInterceptionPipeline } from "../../src/interception/tool/pipeline.js";
import {
	createHeavyToolConfirmationInterceptor,
	HeavyToolConfirmationLedger,
	type HeavyToolConsentPort,
} from "../../src/tool-policy/heavy-tool-confirmation.js";
import type { CodingAgentToolConsentDecision } from "../../src/tool-policy/tool-consent-contract.js";
import { createCodingAgentToolSideEffectResolver } from "../../src/tool-policy/tool-side-effect.js";

describe("heavy tool confirmation gate", () => {
	it("requests consent before the first heavy tool call in a session", async () => {
		const harness = createHarness();
		const result = await harness.run("vetd_create");

		expect(harness.requests).toEqual([{ sessionId: "session", toolName: "vetd_create" }]);
		expect(harness.executed).toEqual(["vetd_create"]);
		expect(result.content[0]).toEqual({ type: "text", text: "ok" });
	});

	it("reuses consent in one session and requests it again in another session", async () => {
		const harness = createHarness();
		await harness.run("vetd_create");
		await harness.run("vetd_create");
		await harness.run("vetd_create", { sessionId: "other-session" });

		expect(harness.requests).toEqual([
			{ sessionId: "session", toolName: "vetd_create" },
			{ sessionId: "other-session", toolName: "vetd_create" },
		]);
		expect(harness.executed).toEqual(["vetd_create", "vetd_create", "vetd_create"]);
	});

	it("shares one consent request between concurrent calls", async () => {
		let release: (() => void) | undefined;
		const harness = createHarness({
			decide: async () => {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return "allow_session";
			},
		});

		const calls = [harness.run("vetd_create"), harness.run("vetd_create")];
		await waitFor(() => release !== undefined);
		release?.();
		await Promise.all(calls);

		expect(harness.requests).toHaveLength(1);
		expect(harness.executed).toEqual(["vetd_create", "vetd_create"]);
	});

	it("fails closed and requests consent again after a denial", async () => {
		const harness = createHarness({ decide: async () => "deny" });
		await expect(harness.run("vetd_create")).rejects.toThrow(/User declined to run "vetd_create"/);
		await expect(harness.run("vetd_create")).rejects.toThrow(/User declined to run "vetd_create"/);

		expect(harness.requests).toHaveLength(2);
		expect(harness.executed).toEqual([]);
	});

	it("fails closed without leaking a consent provider error", async () => {
		const harness = createHarness({
			decide: async () => {
				throw new Error("renderer gone with sensitive detail");
			},
		});

		const call = harness.run("vetd_create");
		await expect(call).rejects.toThrow(/Could not obtain consent/);
		await expect(call).rejects.not.toThrow(/sensitive detail/);
		expect(harness.executed).toEqual([]);
	});

	it("propagates cancellation without executing the tool", async () => {
		const controller = new AbortController();
		const abortReason = new Error("cancelled by test");
		const harness = createHarness({
			decide: async () => {
				controller.abort(abortReason);
				throw abortReason;
			},
		});

		await expect(harness.run("vetd_create", { signal: controller.signal })).rejects.toBe(abortReason);
		expect(harness.executed).toEqual([]);
	});

	it("leaves light tools untouched", async () => {
		const harness = createHarness();
		await harness.run("read");
		await harness.run("read");

		expect(harness.requests).toEqual([]);
		expect(harness.executed).toEqual(["read", "read"]);
	});

	it("blocks every heavy call while the consent function is unavailable", async () => {
		const harness = createHarness({ available: false });
		await expect(harness.run("vetd_create")).rejects.toThrow(/no tool-consent function/);
		await expect(harness.run("vetd_create")).rejects.toThrow(/no tool-consent function/);

		expect(harness.requests).toEqual([]);
		expect(harness.executed).toEqual([]);
	});

	it("honours an explicit light declaration over the default heavy name list", async () => {
		const harness = createHarness({ declarations: [{ name: "vetd_create", side_effect: "light" }] });
		await harness.run("vetd_create");

		expect(harness.requests).toEqual([]);
		expect(harness.executed).toEqual(["vetd_create"]);
	});

	it("protects a tool declared heavy by a plugin contribution", async () => {
		const harness = createHarness({ declarations: [{ name: "read", side_effect: "HEAVY" }] });
		await harness.run("read");

		expect(harness.requests).toHaveLength(1);
		expect(harness.executed).toEqual(["read"]);
	});
});

interface HarnessOptions {
	readonly available?: boolean;
	readonly decide?: () => Promise<CodingAgentToolConsentDecision>;
	readonly declarations?: readonly { name: string; side_effect?: unknown }[];
}

function createHarness(options: HarnessOptions = {}) {
	const requests: Array<{ readonly sessionId: string; readonly toolName: string }> = [];
	const executed: string[] = [];
	const consent: HeavyToolConsentPort = {
		isAvailable: () => options.available ?? true,
		request: async (request) => {
			requests.push(request);
			return options.decide?.() ?? "allow_session";
		},
	};
	const interceptor: CodingAgentToolInterceptor = createHeavyToolConfirmationInterceptor({
		ledger: new HeavyToolConfirmationLedger(),
		consent,
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
		requests,
		executed,
		run: (toolName: string, overrides: { readonly sessionId?: string; readonly signal?: AbortSignal } = {}) =>
			tools.get(toolName)!.execute({
				sessionId: overrides.sessionId ?? "session",
				turnId: "turn",
				toolCallId: `call-${requests.length}`,
				input: {},
				signal: overrides.signal ?? new AbortController().signal,
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

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("condition was never met");
}
