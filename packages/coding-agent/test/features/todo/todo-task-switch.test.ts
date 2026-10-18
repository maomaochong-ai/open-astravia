import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AdapterRegistry,
	type Context,
	createGoogleAdapter,
	createRegistrySimpleStream,
	type Model,
} from "@astravia/ai";
import type { ModelCallContributionProvider, SessionInput } from "@astravia/runtime-core/kernel";
import { afterEach, describe, expect, it } from "vitest";
import type { CodingAgentTodoRuntime } from "../../../src/features/todo/contracts.js";
import { CodingAgentTodoRuntime as TodoRuntime } from "../../../src/features/todo/todo-runtime.js";
import { CODING_AGENT_TODO_READ } from "../../../src/features/todo/todo-session-extension-contract.js";
import {
	createCodingAgentTodoRuntimeFeature,
	createCodingAgentTodoRuntimeToolRegistration,
} from "../../../src/features/todo/todo-tool-feature.js";
import { createCodingAgentRuntimeComposition } from "../../fixtures/conversation-persistence.js";

const MODEL: Model<"google-generative-ai"> = {
	id: "gemini-3.8-flash-high",
	name: "Gemini Test",
	api: "google-generative-ai",
	provider: "cli-proxy-api.google",
	baseUrl: "https://provider.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

describe("Todo 列表随任务切换更新", () => {
	const disposals: Array<() => Promise<void>> = [];
	afterEach(async () => {
		for (const dispose of disposals.splice(0).reverse()) await dispose();
	});

	async function createSession(todoRuntime: CodingAgentTodoRuntime) {
		const directory = await mkdtemp(join(tmpdir(), "todo-task-switch-"));
		disposals.push(() => rm(directory, { recursive: true, force: true }));
		const contexts: Context[] = [];
		const responses: unknown[] = [];
		const adapter = createGoogleAdapter({
			send: async (_params, request) => {
				contexts.push(structuredClone(request.context));
				const response = responses.shift();
				if (!response) throw new Error("Unexpected extra model request");
				return chunks(response);
			},
		});
		const registry = new AdapterRegistry();
		registry.register({ ...adapter, streamSimple: (request) => adapter.stream(request) });
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: directory,
			cwd: directory,
			workspaceFacts: "Isolated test workspace",
			modelRegistry: {
				refresh() {},
				getAvailable: () => [MODEL],
				find: (provider, id) => (provider === MODEL.provider && id === MODEL.id ? MODEL : undefined),
				getApiKey: async () => "test-key",
				setServerToken() {},
				loadRemoteModels: async () => undefined,
			},
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: ["todo"] },
			streamFn: createRegistrySimpleStream(registry),
			createTodoRuntime: () => todoRuntime,
		});
		disposals.push(() => composition.dispose());
		const session = await composition.createSession({ sessionId: "todo-task-switch", cwd: directory });
		disposals.push(() => session.dispose());
		return { session, contexts, responses };
	}

	it("上一份计划全部完成后，下一个用户回合开始前自动清空", async () => {
		const todoRuntime = new TodoRuntime();
		const { session, contexts, responses } = await createSession(todoRuntime);
		responses.push(
			toolResponse("todo", { description: "Plan task A", action: "create", items: ["Task A step 1"] }),
			toolResponse("todo", { description: "Finish task A", action: "update", id: 1, status: "done" }),
			textResponse("Task A done."),
		);
		await session.prompt({ text: "Do task A" });
		expect(await session.invokeExtension(CODING_AGENT_TODO_READ, undefined)).toEqual([
			{ id: 1, content: "Task A step 1", status: "done" },
		]);

		const switchRequest = contexts.length;
		responses.push(textResponse("Task B started."));
		await session.prompt({ text: "Now do something unrelated" });

		expect(await session.invokeExtension(CODING_AGENT_TODO_READ, undefined)).toEqual([]);
		// 清空发生在该回合首次模型调用之前：模型看不到已完成的旧清单。
		expect(contexts[switchRequest]?.systemPrompt).not.toContain("<todo_list>");
	});

	it("未完成的计划保留，并作为当前清单出现在系统提示里，模型可以据此换任务", async () => {
		const todoRuntime = new TodoRuntime();
		const { session, contexts, responses } = await createSession(todoRuntime);
		responses.push(
			toolResponse("todo", {
				description: "Plan task A",
				action: "create",
				items: ["Task A step 1", "Task A step 2"],
			}),
			toolResponse("todo", { description: "Finish first step", action: "update", id: 1, status: "done" }),
			textResponse("First step done."),
		);
		await session.prompt({ text: "Do task A" });

		const switchRequest = contexts.length;
		responses.push(
			toolResponse("todo", { description: "Drop the stale plan", action: "clear" }),
			toolResponse("todo", { description: "Plan task B", action: "create", items: ["Task B step 1"] }),
			textResponse("Task B started."),
		);
		await session.prompt({ text: "Actually do task B" });

		const systemPrompt = contexts[switchRequest]?.systemPrompt ?? "";
		expect(systemPrompt).toContain("# Current todo list");
		expect(systemPrompt).toContain("[x] #1 Task A step 1");
		expect(systemPrompt).toContain("[ ] #2 Task A step 2");
		expect(await session.invokeExtension(CODING_AGENT_TODO_READ, undefined)).toEqual([
			{ id: 1, content: "Task B step 1", status: "pending" },
		]);
	});
});

describe("Todo 清理的回合边界", () => {
	const input: SessionInput = {
		message: { role: "user", content: [{ type: "text", text: "next" }], timestamp: 0 },
	};

	async function providers(runtime: CodingAgentTodoRuntime): Promise<ModelCallContributionProvider> {
		const feature = createCodingAgentTodoRuntimeFeature(
			runtime,
			createCodingAgentTodoRuntimeToolRegistration(runtime),
		);
		const agent = await feature.prepare({ signal: new AbortController().signal });
		const contribution = await agent.contribute({ signal: new AbortController().signal });
		const provider = contribution.modelCallProviders?.[0];
		if (!provider) throw new Error("Todo feature did not contribute a model call provider");
		return provider;
	}

	const signal = new AbortController().signal;

	it("用户回合清空全部完成的计划", async () => {
		const runtime = new TodoRuntime();
		runtime.createMany(["only"]);
		runtime.update(1, "done");
		const provider = await providers(runtime);

		const contribution = await provider.contribute({ sessionId: "s", turnId: "t", signal, input });

		expect(runtime.readItems()).toEqual([]);
		expect(contribution.instructions ?? []).toEqual([]);
		expect(contribution.tools).toHaveLength(1);
	});

	it("续跑回合（没有用户输入）不清空已完成的计划", async () => {
		const runtime = new TodoRuntime();
		runtime.createMany(["only"]);
		runtime.update(1, "done");
		const provider = await providers(runtime);

		await provider.contribute({ sessionId: "s", turnId: "t", signal });

		expect(runtime.readItems()).toEqual([{ id: 1, content: "only", status: "done" }]);
	});

	it("同一回合的后续模型调用不再清理", async () => {
		const runtime = new TodoRuntime();
		runtime.createMany(["first"]);
		runtime.update(1, "done");
		const provider = await providers(runtime);
		await provider.contribute({ sessionId: "s", turnId: "t", signal, input });
		expect(runtime.readItems()).toEqual([]);

		// 回合进行中模型又建了一份已完成的清单：同一 Turn 不允许被再次抹掉。
		runtime.createMany(["mid-turn"]);
		runtime.update(1, "done");
		await provider.contribute({ sessionId: "s", turnId: "t", signal, input });

		expect(runtime.readItems()).toEqual([{ id: 1, content: "mid-turn", status: "done" }]);
	});

	it("场景锁定的清单不会被清空", async () => {
		const runtime = new TodoRuntime();
		runtime.initializeTodoItems(["locked step"], "scene");
		runtime.update(1, "done");
		const provider = await providers(runtime);

		await provider.contribute({ sessionId: "s", turnId: "t", signal, input });

		expect(runtime.isLocked()).toBe(true);
		expect(runtime.readItems()).toEqual([{ id: 1, content: "locked step", status: "done" }]);
	});
});

async function* chunks(response: unknown): AsyncIterable<unknown> {
	yield response;
}

function toolResponse(name: string, args: Record<string, unknown>) {
	return {
		candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] }, finishReason: "STOP" }],
	};
}

function textResponse(text: string) {
	return { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] };
}
