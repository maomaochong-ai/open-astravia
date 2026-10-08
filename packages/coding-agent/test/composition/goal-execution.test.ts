import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AdapterRegistry,
	type Context,
	createGoogleAdapter,
	createRegistrySimpleStream,
	type GoogleContentSender,
	type Message,
	type Model,
} from "@vetta/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	CODING_AGENT_GOAL_CREATE,
	CODING_AGENT_GOAL_STATE_READ,
	CODING_AGENT_GOAL_UPDATE,
} from "../../src/features/goal/index.js";
import { CODING_AGENT_TODO_READ } from "../../src/features/todo/todo-session-extension-contract.js";
import { createCodingAgentRuntimeComposition } from "../fixtures/conversation-persistence.js";

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

describe("Goal execution through the Google provider", () => {
	const disposals: Array<() => Promise<void>> = [];
	afterEach(async () => {
		for (const dispose of disposals.splice(0).reverse()) await dispose();
	});

	async function createSession() {
		const directory = await mkdtemp(join(tmpdir(), "goal-google-"));
		disposals.push(() => rm(directory, { recursive: true, force: true }));
		const requests: Array<Parameters<GoogleContentSender>[0]> = [];
		const contexts: Context[] = [];
		const responses: unknown[] = [];
		const adapter = createGoogleAdapter({
			send: async (params, request) => {
				requests.push(structuredClone(params));
				contexts.push(structuredClone(request.context));
				expect(params.contents).not.toEqual([]);
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
		});
		disposals.push(() => composition.dispose());
		const session = await composition.createSession({ sessionId: "goal-session", cwd: directory });
		disposals.push(() => session.dispose());
		return { session, requests, contexts, responses };
	}

	it.each(["new", "existing", "resumed"] as const)(
		"starts a %s session goal, executes Todo, completes, and keeps startup context out of history",
		async (scenario) => {
			const { session, requests, contexts, responses } = await createSession();
			if (scenario === "existing") {
				responses.push(textResponse("Earlier answer"));
				await session.prompt({ text: "Earlier task" });
			}
			const goal = await session.invokeExtension(CODING_AGENT_GOAL_CREATE, { objective: "测试一下todo就停止" });
			if (scenario === "resumed") {
				await session.invokeExtension(CODING_AGENT_GOAL_UPDATE, { goalId: goal.goalId, status: "paused" });
				await session.invokeExtension(CODING_AGENT_GOAL_UPDATE, { goalId: goal.goalId, status: "active" });
			}
			const firstRequest = requests.length;
			responses.push(
				toolResponse("todo", { description: "Create a test Todo", action: "create", items: ["Test Todo"] }),
				toolResponse("todo", { description: "Finish the test Todo", action: "update", id: 1, status: "done" }),
				toolResponse("update_goal", { goal_id: goal.goalId, status: "complete" }),
				textResponse("Todo tested; stopped."),
			);

			await session.continue();

			expect(
				(await session.readMessages()).filter((message) => message.role === "assistant" && message.failure),
			).toEqual([]);
			expect(requests).toHaveLength(firstRequest + 4);
			expect(contexts[firstRequest]?.systemPrompt).toContain("<goal_objective>\n测试一下todo就停止");
			expect(contexts[firstRequest]?.messages.at(-1)).toMatchObject({
				role: "user",
				content: expect.stringContaining("Begin working toward the active goal"),
			});
			expect(JSON.stringify(requests[firstRequest + 1]?.contents)).toContain("Created 1 todo items");
			expect(JSON.stringify(requests[firstRequest + 2]?.contents)).toContain('"functionResponse"');
			expect(await session.invokeExtension(CODING_AGENT_TODO_READ, undefined)).toEqual([
				{ id: 1, content: "Test Todo", status: "done" },
			]);
			expect(await session.invokeExtension(CODING_AGENT_GOAL_STATE_READ, undefined)).toMatchObject({
				status: "complete",
				continuationCount: 0,
			});
			const history = await session.readMessages();
			expect(history.filter(({ role }) => role === "user").map(messageText)).toEqual(
				scenario === "existing" ? ["Earlier task"] : [],
			);
			expect(JSON.stringify(history)).not.toContain("Begin working toward the active goal");
			expect(history.at(-1)).toMatchObject({ content: [{ type: "text", text: "Todo tested; stopped." }] });
		},
	);

	it("uses ordinary user input without adding goal startup context", async () => {
		const { session, contexts, responses } = await createSession();
		const goal = await session.invokeExtension(CODING_AGENT_GOAL_CREATE, { objective: "Test Todo" });
		responses.push(toolResponse("update_goal", { goal_id: goal.goalId, status: "paused" }), textResponse("Paused."));

		await session.prompt({ text: "Pause this goal" });

		expect(contexts[0]?.messages.map(messageText)).toEqual(["Pause this goal"]);
		expect(await session.invokeExtension(CODING_AGENT_GOAL_STATE_READ, undefined)).toMatchObject({
			status: "paused",
			continuationCount: 0,
		});
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

function messageText(message: Message): string {
	return typeof message.content === "string"
		? message.content
		: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}
