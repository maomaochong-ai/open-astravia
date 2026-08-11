import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import {
	type CodingAgentRuntimeComposition,
	CodingAgentRuntimeHostSessionBackend,
	createCodingAgentRuntimeComposition,
} from "@vetta/coding-agent/composition";
import type { CodingAgentPluginRuntimeSource, CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import {
	type AgentPluginContinuationInvocation,
	type AgentPluginSystemPromptInvocation,
	type AgentPluginToolInvocation,
	RuntimeHost,
} from "@vetta/runtime-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

describe("Runtime Host capabilities contract", { timeout: INTEGRATION_TEST_TIMEOUT_MS }, () => {
	const directories: string[] = [];
	const disposers: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const dispose of disposers.splice(0).reverse()) await dispose();
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	}, INTEGRATION_TEST_TIMEOUT_MS);

	it("maps plugin prompt, tool and continuation invokers and applies live reconfiguration", async () => {
		const cwd = await temporaryDirectory("runtime-host-plugin-workspace-");
		const conversationDir = await temporaryDirectory("runtime-host-plugin-conversations-");
		const modelCalls: Array<{ readonly prompt?: string; readonly tools: readonly string[] }> = [];
		const responses = [
			assistantToolCall("plugin_artifact", { title: "Report", md_intro: "Finding" }),
			assistantText("artifact complete"),
			assistantText("plugin continuation complete"),
			assistantText("plugins disabled"),
		];
		let responseIndex = 0;
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			cwd,
			scenario: "batch",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: ["plugin_artifact"] },
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			resolveSystemPromptOptions: () => ({ customPrompt: "Base prompt", scenario: "batch" }),
			streamFn: (_model, context) => {
				modelCalls.push({
					prompt: context.systemPrompt,
					tools: (context.tools ?? []).map(({ name }) => name),
				});
				const response = responses[responseIndex++];
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		const backend = new CodingAgentRuntimeHostSessionBackend({
			composition,
			conversationDir,
			cwd,
			scenario: "batch",
			enableSubagents: false,
		});
		const runtime = new RuntimeHost({ sessionBackend: backend });
		const toolInvocations: AgentPluginToolInvocation[] = [];
		const systemPromptInvocations: AgentPluginSystemPromptInvocation[] = [];
		const continuationInvocations: AgentPluginContinuationInvocation[] = [];
		runtime.setPluginToolInvoker(async (invocation) => {
			toolInvocations.push(invocation);
			return { value: { text: "artifact created" }, effects: [] };
		});
		runtime.setPluginSystemPromptInvoker(async (invocation) => {
			systemPromptInvocations.push(invocation);
			return [
				{
					type: "addBlock",
					block: {
						id: "plugin.runtime-host",
						type: "plugin",
						source: { kind: "plugin" },
						content: "RuntimeHost plugin instruction",
						priority: 700,
						enabled: true,
					},
				},
			];
		});
		runtime.setPluginContinuationInvoker(async (invocation) => {
			continuationInvocations.push(invocation);
			return continuationInvocations.length === 1
				? {
						value: { text: "runtime host continuation", idempotencyKey: "runtime-host-once" },
						effects: [],
					}
				: { value: null, effects: [] };
		});
		registerDisposal(runtime, composition);

		const created = await runtime.createSession({
			cwd,
			sessionDir: conversationDir,
			scenario: "batch",
			enableAgentPlugins: true,
			agentPlugins: pluginConfiguration(),
		});
		await runtime.prompt(created.sessionId, { text: "create artifact" });

		expect(toolInvocations).toHaveLength(1);
		expect(continuationInvocations).toHaveLength(2);
		expect(systemPromptInvocations).toHaveLength(1);
		expect(modelCalls).toHaveLength(3);
		expect(modelCalls[0]?.tools).toContain("plugin_artifact");
		expect(modelCalls[0]?.prompt).toContain("RuntimeHost plugin instruction");

		runtime.reconfigureAgentPlugins(undefined);
		await runtime.prompt(created.sessionId, { text: "continue without plugins" });

		expect(modelCalls).toHaveLength(4);
		expect(modelCalls[3]?.tools).not.toContain("plugin_artifact");
		expect(modelCalls[3]?.prompt).not.toContain("RuntimeHost plugin instruction");
		expect(systemPromptInvocations).toHaveLength(1);
	});

	it("toggles ask_user_question per model call without rebuilding the session", async () => {
		const cwd = await temporaryDirectory("runtime-host-question-workspace-");
		const conversationDir = await temporaryDirectory("runtime-host-question-conversations-");
		const toolSurfaces: string[][] = [];
		const responses = [
			assistantToolCall("ask_user_question", {
				description: "Choose the implementation",
				questions: [
					{
						question: "Which implementation should be used?",
						header: "Implementation",
						options: [
							{ label: "A", description: "Use implementation A" },
							{ label: "B", description: "Use implementation B" },
						],
					},
				],
			}),
			assistantText("answer received"),
			assistantText("question tool disabled"),
		];
		let responseIndex = 0;
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			cwd,
			scenario: "conversation",
			enableSubagents: true,
			activation: { mode: "explicit", toolNames: [] },
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			resolveSystemPromptOptions: () => ({ customPrompt: "Base prompt", scenario: "conversation" }),
			streamFn: (_model, context) => {
				toolSurfaces.push((context.tools ?? []).map(({ name }) => name));
				const response = responses[responseIndex++];
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		const backend = new CodingAgentRuntimeHostSessionBackend({
			composition,
			conversationDir,
			cwd,
			scenario: "conversation",
			enableSubagents: true,
		});
		const runtime = new RuntimeHost({ sessionBackend: backend });
		const questionHandler = vi.fn(async () => ({
			cancelled: false,
			answers: [{ question: "Which implementation should be used?", answers: ["A"] }],
		}));
		runtime.setUserQuestionHandler(questionHandler);
		registerDisposal(runtime, composition);

		const created = await runtime.createSession({
			cwd,
			sessionDir: conversationDir,
			scenario: "conversation",
			askUserQuestion: true,
		});
		await runtime.prompt(created.sessionId, { text: "ask me" });

		expect(questionHandler).toHaveBeenCalledOnce();
		expect(toolSurfaces[0]).toContain("ask_user_question");
		expect(toolSurfaces[1]).toContain("ask_user_question");
		expect(runtime.getState(created.sessionId).activeToolNames).toContain("ask_user_question");

		runtime.setUserQuestionHandler(undefined);
		await runtime.prompt(created.sessionId, { text: "continue" });

		expect(toolSurfaces[2]).not.toContain("ask_user_question");
		expect(runtime.getState(created.sessionId).activeToolNames).not.toContain("ask_user_question");
		expect(runtime.getMessages(created.sessionId).find(({ role }) => role === "toolResult")).toMatchObject({
			content: [{ type: "text", text: expect.stringContaining('"Which implementation should be used?"="A"') }],
		});
	});

	it("rejects ambiguous plugin sources instead of silently overriding one", async () => {
		const cwd = await temporaryDirectory("runtime-host-plugin-conflict-workspace-");
		const conversationDir = await temporaryDirectory("runtime-host-plugin-conflict-conversations-");
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			cwd,
			scenario: "batch",
			enableSubagents: false,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			createPluginRuntime: () => ({ readAgentPlugins: () => undefined }),
		});
		const backend = new CodingAgentRuntimeHostSessionBackend({
			composition,
			conversationDir,
			cwd,
			scenario: "batch",
			enableSubagents: false,
		});
		const runtime = new RuntimeHost({ sessionBackend: backend });
		runtime.setPluginToolInvoker(async () => ({ value: undefined, effects: [] }));
		registerDisposal(runtime, composition);

		await expect(
			runtime.createSession({
				cwd,
				sessionDir: conversationDir,
				scenario: "batch",
			}),
		).rejects.toThrow("plugin capabilities conflict with createPluginRuntime");
	});

	function registerDisposal(runtime: RuntimeHost, composition: CodingAgentRuntimeComposition): void {
		disposers.push(async () => {
			await runtime.disposeAllSessions();
			await composition.dispose();
		});
	}

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

function pluginConfiguration(): NonNullable<ReturnType<CodingAgentPluginRuntimeSource["readAgentPlugins"]>> {
	return {
		systemPromptProviderContributions: [
			{
				pluginId: "plugin-a",
				id: "runtime-host-prompt",
				handlerId: "runtime-host-prompt-handler",
				context: { conversation: "messages", systemPrompt: "rendered" },
			},
		],
		toolContributions: [
			{
				pluginId: "plugin-a",
				id: "artifact",
				name: "plugin_artifact",
				label: "Artifact",
				description: "Create an artifact",
				parameters: {
					type: "object",
					properties: { title: { type: "string" } },
					required: ["title"],
				},
				handlerId: "artifact-handler",
				context: { conversation: "messages" },
			},
		],
		continuationContributions: [
			{
				pluginId: "plugin-a",
				id: "continue",
				handlerId: "continue-handler",
				context: { conversation: "messages" },
			},
		],
	};
}

class RecordedAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected assistant event");
			},
		);
		queueMicrotask(() => {
			this.push({ type: "done", reason: successfulStopReason(message), message });
		});
	}
}

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

function assistantToolCall(name: string, args: Readonly<Record<string, unknown>>): AssistantMessage {
	return assistantMessage([{ type: "toolCall", id: `${name}-call`, name, arguments: args }], "toolUse");
}

function assistantText(text: string): AssistantMessage {
	return assistantMessage([{ type: "text", text }], "stop");
}

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 2,
	};
}

function successfulStopReason(message: AssistantMessage): "length" | "stop" | "toolUse" {
	if (message.stopReason === "length" || message.stopReason === "stop" || message.stopReason === "toolUse") {
		return message.stopReason;
	}
	throw new Error(`Recorded assistant message did not complete successfully: ${message.stopReason}`);
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
