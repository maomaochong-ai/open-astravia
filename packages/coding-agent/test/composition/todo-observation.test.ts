import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import type { SessionEvent } from "@vetta/runtime-core";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CodingAgentRuntimeComposition,
	createCodingAgentRuntimeComposition,
} from "../../src/composition/index.js";
import type { CodingAgentRuntimeModelSource } from "../../src/public-api/host-services.js";
import { CodingAgentTodoRuntime } from "../../src/work-state/todo-runtime.js";

describe("Coding Agent Todo observation", () => {
	const temporaryDirectories: string[] = [];
	const compositions: CodingAgentRuntimeComposition[] = [];

	afterEach(async () => {
		for (const composition of compositions.splice(0).reverse()) {
			await composition.dispose();
		}
		for (const directory of temporaryDirectories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("publishes todo_update whenever the session Todo state mutates", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "todo-observation-"));
		temporaryDirectories.push(conversationDir);
		const todoRuntime = new CodingAgentTodoRuntime();
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "explicit", toolNames: [] },
			resolveSystemPromptOptions: () => ({ customPrompt: "Base prompt", scenario: "cli" }),
			createTodoRuntime: () => todoRuntime,
			// 本用例只观察 Todo 状态广播，不发起任何回合。
			streamFn: () => {
				throw new Error("Model must not be called");
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "todo-observation-session",
			cwd: "C:\\workspace",
		});
		const events: SessionEvent[] = [];
		const unsubscribe = session.subscribe((event) => events.push(event));

		todoRuntime.createMany(["Task one", "Task two"]);
		todoRuntime.update(1, "in_progress");
		await todoRuntime.flush();
		await Promise.resolve();

		const todoEvents = events.filter(
			(event): event is Extract<SessionEvent, { type: "todo_update" }> => event.type === "todo_update",
		);
		expect(todoEvents.length).toBeGreaterThanOrEqual(2);
		expect(todoEvents.at(-1)?.items).toEqual([
			{ id: 1, content: "Task one", status: "in_progress" },
			{ id: 2, content: "Task two", status: "pending" },
		]);

		unsubscribe();
		await session.dispose();
	});
});

function modelRegistry(): CodingAgentRuntimeModelSource {
	return {
		refresh() {},
		getAvailable: () => [MODEL],
		find: (provider, modelId) => (provider === MODEL.provider && modelId === MODEL.id ? MODEL : undefined),
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}

const MODEL: Model<Api> = {
	id: "recorded-model",
	name: "Recorded Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
