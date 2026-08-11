import type { AgentModelCallLifecycle } from "@vetta/agent-core";
import type { AssistantMessage, Context, Model } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import type { ContextCompositionReport } from "../../src/context-composition/index.js";
import {
	type ContextCompositionPublisher,
	createContextCompositionLifecycle,
	type ModelCallFrame,
} from "../../src/kernel/index.js";

describe("context composition model-call lifecycle", () => {
	it("publishes source breakdowns without leaking section content", async () => {
		const reports: ContextCompositionReport[] = [];
		const lifecycle = lifecycleFor(reports, frame());
		const context: Context = {
			systemPrompt: "core instructions\n\nskill instructions",
			messages: [
				{ role: "user", content: "old secret", timestamp: 1 },
				{ role: "user", content: "current secret", timestamp: 2 },
			],
		};

		await lifecycle.prepared(context);

		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({
			phase: "prepared",
			callId: "turn-1:model-call:1",
			snapshotId: "snapshot-1",
			model: { provider: "openai", modelId: "mock", contextWindow: 8_192 },
			estimate: { coverage: "complete" },
		});
		expect(reports[0]?.sections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "instruction:core", source: { owner: "core", id: "core" } }),
				expect.objectContaining({ id: "instruction:skill", source: { owner: "skill", id: "review" } }),
				expect.objectContaining({ id: "tool:lookup", kind: "tool_schema" }),
				expect.objectContaining({
					id: "runtime:workspace",
					kind: "runtime_context",
					source: { owner: "runtime", id: "workspace" },
				}),
				expect.objectContaining({ id: "message:0", kind: "history" }),
				expect.objectContaining({ id: "message:1", kind: "user_input" }),
			]),
		);
		expect(JSON.stringify(reports[0])).not.toContain("secret");
		expect(JSON.stringify(reports[0])).not.toContain("instructions");
		expect(JSON.stringify(reports[0])).not.toContain("private workspace context");

		await lifecycle.completed(context, assistant(20, 5, 3));
		expect(reports[1]).toMatchObject({
			phase: "completed",
			providerReportedInputTokens: 28,
		});
		expect(reports[1]?.sections).toEqual(reports[0]?.sections);
	});

	it("falls back to an explicitly unattributed effective prompt when metadata is stale", async () => {
		const reports: ContextCompositionReport[] = [];
		const lifecycle = lifecycleFor(reports, frame());

		await lifecycle.prepared({ systemPrompt: "changed", messages: [] });

		expect(reports[0]?.sections.filter(({ kind }) => kind === "instruction")).toEqual([
			expect.objectContaining({
				id: "instruction:effective-system-prompt",
				source: { owner: "unknown", id: "effective-system-prompt" },
			}),
		]);
	});

	it("uses a new stable call id for each model invocation", async () => {
		const reports: ContextCompositionReport[] = [];
		const lifecycle = lifecycleFor(reports, frame());
		const context: Context = { systemPrompt: "core instructions\n\nskill instructions", messages: [] };

		await lifecycle.prepared(context);
		lifecycle.failed(context, new Error("failed"));
		await lifecycle.prepared(context);

		expect(reports.map(({ callId }) => callId)).toEqual(["turn-1:model-call:1", "turn-1:model-call:2"]);
	});
});

function lifecycleFor(reports: ContextCompositionReport[], currentFrame: ModelCallFrame): AgentModelCallLifecycle {
	const publisher: ContextCompositionPublisher = {
		publishContextComposition(report) {
			reports.push(report);
		},
	};
	return createContextCompositionLifecycle({
		turnId: "turn-1",
		snapshotId: "snapshot-1",
		model: model(),
		publisher,
		readFrame: () => currentFrame,
		input: { message: { role: "user", content: "current secret", timestamp: 2 } },
		now: () => 100,
	});
}

function frame(): ModelCallFrame {
	return {
		instructions: [{ id: "system", content: "core instructions\n\nskill instructions", priority: 0 }],
		tools: new Map(),
		contextCompositionSections: [
			{
				id: "instruction:core",
				kind: "instruction",
				source: { owner: "core", id: "core" },
				content: "core instructions",
			},
			{
				id: "instruction:skill",
				kind: "instruction",
				source: { owner: "skill", id: "review" },
				content: "skill instructions",
			},
			{
				id: "tool:lookup",
				kind: "tool_schema",
				source: { owner: "runtime", id: "lookup" },
				content: '{"name":"lookup"}',
			},
			{
				id: "runtime:workspace",
				kind: "runtime_context",
				source: { owner: "runtime", id: "workspace" },
				content: "private workspace context",
			},
		],
	};
}

function model(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "Mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8_192,
		maxTokens: 2_048,
	};
}

function assistant(input: number, cacheRead: number, cacheWrite: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input,
			output: 2,
			cacheRead,
			cacheWrite,
			totalTokens: input + cacheRead + cacheWrite + 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 3,
	};
}
