import { describe, expect, it } from "vitest";
import {
	buildContextCompositionReport,
	completeContextCompositionReport,
	HeuristicTokenEstimator,
	instructionSection,
	messageSection,
	stableJsonStringify,
	type TokenEstimator,
	toolSchemaSection,
} from "../../src/context-composition/index.js";

const model = { provider: "test", modelId: "test-model", contextWindow: 100 } as const;

describe("context composition report", () => {
	it("reports each source independently and reconciles a complete estimate", async () => {
		const report = await buildContextCompositionReport(
			{
				callId: "call-1",
				snapshotId: "snapshot-1",
				createdAt: 1,
				model,
				sections: [
					instructionSection({
						id: "instruction:base",
						category: "base",
						source: { owner: "core", id: "base" },
						content: "12345678",
					}),
					instructionSection({
						id: "instruction:skill-a",
						category: "skill",
						source: { owner: "skill", id: "skill-a" },
						content: "1234",
					}),
				],
			},
			new HeuristicTokenEstimator(),
		);

		expect(report.estimate).toEqual({ tokens: 3, knownTokens: 3, coverage: "complete" });
		expect(report.sections).toMatchObject([
			{ id: "instruction:base", estimatedTokens: 2, characters: 8, percentOfWindow: 2 },
			{ id: "instruction:skill-a", estimatedTokens: 1, characters: 4, percentOfWindow: 1 },
		]);
	});

	it.each([
		[[2, null], { tokens: null, knownTokens: 2, coverage: "partial" }],
		[[null, null], { tokens: null, knownTokens: 0, coverage: "none" }],
	] as const)("keeps unknown estimates honest for %j", async (tokens, expected) => {
		let index = 0;
		const estimator: TokenEstimator = {
			estimate() {
				const value = tokens[index];
				index += 1;
				return { tokens: value ?? null, method: value === null ? "unknown" : "model_tokenizer" };
			},
		};
		const report = await buildContextCompositionReport(
			{
				callId: "call-1",
				snapshotId: "snapshot-1",
				createdAt: 1,
				model,
				sections: [
					instructionSection({ id: "one", source: { owner: "core", id: "one" }, content: "one" }),
					instructionSection({ id: "two", source: { owner: "skill", id: "two" }, content: "two" }),
				],
			},
			estimator,
		);

		expect(report.estimate).toEqual(expected);
	});

	it("adds provider usage without rewriting prepared section estimates", async () => {
		const prepared = await buildContextCompositionReport(
			{
				callId: "call-1",
				snapshotId: "snapshot-1",
				createdAt: 1,
				model,
				sections: [instructionSection({ id: "base", source: { owner: "core", id: "base" }, content: "1234" })],
			},
			new HeuristicTokenEstimator(),
		);

		const completed = completeContextCompositionReport(prepared, 20);

		expect(completed).toMatchObject({ phase: "completed", providerReportedInputTokens: 20 });
		expect(completed.sections).toBe(prepared.sections);
		expect(completed.estimate).toBe(prepared.estimate);
	});

	it("serializes tool schemas deterministically and keeps sensitive content out of reports", async () => {
		const first = toolSchemaSection({
			name: "search",
			description: "secret tool description",
			inputSchema: { required: ["query"], properties: { query: { type: "string" } }, type: "object" },
			source: { owner: "mcp", id: "server/search" },
		});
		const second = toolSchemaSection({
			name: "search",
			description: "secret tool description",
			inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
			source: { owner: "mcp", id: "server/search" },
		});
		expect(first.content).toBe(second.content);

		const report = await buildContextCompositionReport(
			{
				callId: "call-1",
				snapshotId: "snapshot-1",
				createdAt: 1,
				model,
				sections: [first],
			},
			new HeuristicTokenEstimator(),
		);

		expect(JSON.stringify(report)).not.toContain("secret tool description");
		expect(report.sections[0]).not.toHaveProperty("content");
	});

	it("classifies final messages by explicit provenance rather than role guesses", () => {
		const user = { role: "user" as const, content: "hello", timestamp: 1 };
		const history = messageSection({
			id: "history:1",
			kind: "history",
			source: { owner: "runtime", id: "conversation" },
			message: user,
		});
		const current = messageSection({
			id: "input:1",
			kind: "user_input",
			source: { owner: "user", id: "prompt" },
			message: user,
		});

		expect(history.kind).toBe("history");
		expect(current.kind).toBe("user_input");
		expect(history.content).toBe(current.content);
	});

	it("uses stable structured serialization", () => {
		expect(stableJsonStringify({ z: 1, a: { d: 2, b: 1 } })).toBe('{"a":{"b":1,"d":2},"z":1}');
	});
});
