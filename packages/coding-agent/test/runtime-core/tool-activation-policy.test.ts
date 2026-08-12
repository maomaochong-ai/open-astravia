import type { ModelCallContributionContext, SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { CodingToolActivation } from "@vetta/runtime-tools/coding";
import { describe, expect, it } from "vitest";
import {
	isCodingAgentKnowledgeToolEnabled,
	resolveCodingAgentToolActivation,
} from "../../src/tool-policy/activation-policy.js";

describe("Coding Agent Tool Activation Policy", () => {
	it("uses the turn override before the composition activation", () => {
		const override = ["read", "mcp_docs"];
		const result = resolveCodingAgentToolActivation(
			{ mode: "explicit", toolNames: ["bash"] },
			context(),
			availability(),
			override,
		);

		expect(result).toEqual({ mode: "explicit", toolNames: override });
		expect(result.mode === "explicit" && result.toolNames).not.toBe(override);
	});

	it("preserves an explicit composition activation when there is no turn override", () => {
		const activation: CodingToolActivation = { mode: "explicit", toolNames: ["read"] };

		expect(resolveCodingAgentToolActivation(activation, context(), availability())).toBe(activation);
	});

	it("adds runtime capabilities to a scoped activation", () => {
		const result = resolveCodingAgentToolActivation(
			{ mode: "scope", scope: "cli", capabilities: new Set(["existing"]) },
			context({ type: "knowledge_mode_instruction" }),
			availability({ backgroundTasksAvailable: true, knowledgeAvailable: true }),
		);

		expect(result).toMatchObject({ mode: "scope", scope: "cli" });
		expect(result.mode === "scope" ? [...(result.capabilities ?? [])] : []).toEqual([
			"existing",
			"bg-tasks",
			"knowledge",
		]);
	});

	it("keeps Knowledge disabled when the runtime capability is unavailable", () => {
		const callContext = context({ type: "knowledge_mode_instruction" });

		expect(isCodingAgentKnowledgeToolEnabled({ mode: "scope", scope: "kb-processing" }, callContext, false)).toBe(
			false,
		);
	});

	it("enables Knowledge for the processing scope or instruction context", () => {
		expect(isCodingAgentKnowledgeToolEnabled({ mode: "scope", scope: "kb-processing" }, context(), true)).toBe(true);
		expect(
			isCodingAgentKnowledgeToolEnabled(
				{ mode: "scope", scope: "cli" },
				context({ type: "knowledge_mode_instruction" }),
				true,
			),
		).toBe(true);
	});

	it("does not enable Knowledge for unrelated context", () => {
		expect(
			isCodingAgentKnowledgeToolEnabled({ mode: "scope", scope: "cli" }, context({ type: "unrelated" }), true),
		).toBe(false);
	});
});

function availability(
	overrides: Partial<{
		readonly backgroundTasksAvailable: boolean;
		readonly knowledgeAvailable: boolean;
	}> = {},
) {
	return {
		backgroundTasksAvailable: false,
		knowledgeAvailable: false,
		...overrides,
	};
}

function context(record?: Pick<SessionContextRecord, "type">): ModelCallContributionContext {
	return {
		sessionId: "session",
		turnId: "turn",
		signal: new AbortController().signal,
		input: record
			? {
					message: { role: "user", content: "test", timestamp: 0 },
					context: [{ ...record, content: "", modelVisible: true }],
				}
			: undefined,
	};
}
