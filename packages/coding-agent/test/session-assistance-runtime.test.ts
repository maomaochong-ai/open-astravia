import type { StreamFn } from "@vetta/agent-core";
import {
	type Api,
	type AssistantMessage,
	createAssistantMessage,
	createAssistantMessageEventStream,
	type Model,
} from "@vetta/ai";
import type { RuntimeSessionModelView } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import {
	CodingAgentSessionAssistanceRuntime,
	cleanSuggestionList,
	resolveSessionAssistanceCandidates,
	sanitizeAutoTitle,
	sanitizeSuggestions,
} from "../src/features/session-assistance/session-assistance-runtime.js";

function createModel(provider: string, id: string): Model<Api> {
	return { api: "openai-responses", provider, id, input: ["text"] } as Model<Api>;
}

describe("CodingAgentSessionAssistanceRuntime", () => {
	it("uses the injected model-call port and current conversation identity for session assistance", async () => {
		const model = createModel("session-assistance-identity", "current");
		const view = createView(model, [model], async () => "test-key");
		const responses: AssistantMessage[] = [
			{
				...createAssistantMessage({ api: model.api, provider: model.provider, model: model.id }),
				content: [{ type: "text", text: "会话标题" }],
			},
			{
				...createAssistantMessage({ api: model.api, provider: model.provider, model: model.id }),
				content: [
					{
						type: "toolCall",
						id: "call-1",
						name: "provide_prompt_suggestions",
						arguments: { suggestions: ["继续"] },
					},
				],
			},
		];
		const streamFn = vi.fn<StreamFn>(() => completedStream(responses.shift()));
		let sessionId = "conversation-42";
		const runtime = new CodingAgentSessionAssistanceRuntime({
			models: view,
			readSessionId: () => sessionId,
			streamFn,
		});

		await expect(runtime.generateTitle("你好", "")).resolves.toBe("会话标题");
		sessionId = "conversation-43";
		await expect(runtime.generateNextPrompts("用户：你好")).resolves.toEqual(["继续"]);
		expect(streamFn).toHaveBeenCalledTimes(2);
		expect(streamFn.mock.calls[0]?.[2]).toMatchObject({ sessionId: "conversation-42" });
		expect(streamFn.mock.calls[1]?.[2]).toMatchObject({ sessionId: "conversation-43" });
	});

	it("keeps current-model priority, deduplication, available order and the three-candidate limit", async () => {
		const current = createModel("session-assistance-priority", "current");
		const second = createModel("session-assistance-priority", "second");
		const third = createModel("session-assistance-priority", "third");
		const fourth = createModel("session-assistance-priority", "fourth");
		const view = createView(current, [current, second, third, fourth], async (model) => `key:${model.id}`);

		const candidates = await resolveSessionAssistanceCandidates(view);

		expect(candidates.map((candidate) => candidate.key)).toEqual([
			"session-assistance-priority/current",
			"session-assistance-priority/second",
			"session-assistance-priority/third",
		]);
		expect(view.refreshAvailableModels).toHaveBeenCalledOnce();
		expect(view.resolveApiKey).toHaveBeenCalledTimes(3);
	});

	it("skips candidates without credentials while preserving later available candidates", async () => {
		const current = createModel("session-assistance-credentials", "current");
		const available = createModel("session-assistance-credentials", "available");
		const view = createView(current, [available], async (model) =>
			model.id === "available" ? "available-key" : undefined,
		);

		const candidates = await resolveSessionAssistanceCandidates(view);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			key: "session-assistance-credentials/available",
			apiKey: "available-key",
		});
	});

	it("sanitizes product title and suggestion fallbacks without leaking prose", () => {
		expect(sanitizeAutoTitle('  "修复 Runtime 架构。"  ')).toBe("修复 Runtime 架构");
		expect(sanitizeSuggestions('analysis [step 1]\n["继续重构", "补充测试"]')).toEqual(["继续重构", "补充测试"]);
		expect(cleanSuggestionList(["继续重构", "继续重构", 42, "补充测试"])).toEqual(["继续重构", "补充测试"]);
	});
});

function completedStream(message: AssistantMessage | undefined) {
	if (!message) throw new Error("Missing recorded session-assistance response");
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "done", reason: "stop", message });
	return stream;
}

function createView(
	current: Model<Api> | undefined,
	available: readonly Model<Api>[],
	resolve: (model: Model<Api>) => Promise<string | undefined>,
): RuntimeSessionModelView & {
	refreshAvailableModels: ReturnType<typeof vi.fn>;
	resolveApiKey: ReturnType<typeof vi.fn>;
} {
	return {
		readCurrentModel: () => current,
		refreshAvailableModels: vi.fn(),
		readAvailableModels: () => available,
		resolveApiKey: vi.fn(resolve),
	};
}
