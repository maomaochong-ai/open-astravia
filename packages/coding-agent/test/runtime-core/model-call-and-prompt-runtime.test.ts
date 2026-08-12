import type { Api, Model } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import {
	CodingAgentRuntimeModelAdapter,
	type CodingAgentRuntimeModelSource,
} from "../../src/adapters/runtime-core/model-runtime-adapter.js";
import { CodingAgentPromptRequestAdapter } from "../../src/adapters/runtime-core/prompt-request-adapter.js";
import { buildSystemPrompt } from "../../src/model-context/index.js";
import { CodingAgentModelCallFrameComposer } from "../../src/model-context/model-call-frame-composer.js";
import { CodingAgentPromptRuntime } from "../../src/model-context/prompt-runtime.js";
import {
	CODING_AGENT_MODEL_TOOL_ORDER,
	CODING_AGENT_SUBAGENT_MODEL_TOOL_ORDER_STEP,
} from "../../src/tool-policy/model-tool-order.js";
import { preparePrompt } from "./prompt-adapter-test-fixture.js";

describe("Coding Agent model call and prompt runtime", () => {
	it("holds the Desktop Plugin handler lease for the complete Turn composer binding", async () => {
		const release = vi.fn();
		const config = {
			toolContributions: [
				{
					pluginId: "demo",
					id: "tool",
					name: "demo_tool",
					description: "Demo",
					parameters: { type: "object" },
					handlerId: "handler-1",
				},
			],
		};
		const bindForTurn = vi.fn(() => ({ release }));
		const composer = new CodingAgentModelCallFrameComposer({
			resolveSystemPromptOptions: async () => ({ cwd: "C:/workspace", scenario: "cli" }),
			readAgentPlugins: () => config,
			pluginHandlerLeaseProvider: { bindForTurn },
		});

		const bound = await composer.bindForTurn({
			sessionId: "session-1",
			operationId: "turn-1",
			reason: "turn",
			signal: new AbortController().signal,
		});

		expect(bindForTurn).toHaveBeenCalledWith(config, {
			sessionId: "session-1",
			turnId: "turn-1",
			signal: expect.any(AbortSignal),
		});
		await bound.releaseTurnBinding?.();
		expect(release).toHaveBeenCalledOnce();
	});

	it("adapts the live model runtime to catalog, credentials and auth refresh ports", async () => {
		const refresh = vi.fn();
		const getApiKey = vi.fn(async () => "test-key");
		const setServerToken = vi.fn();
		const loadRemoteModels = vi.fn(async () => undefined);
		const source: CodingAgentRuntimeModelSource = {
			refresh,
			getAvailable: () => [MODEL],
			find: (provider, modelId) => (provider === MODEL.provider && modelId === MODEL.id ? MODEL : undefined),
			getApiKey,
			setServerToken,
			loadRemoteModels,
		};
		const adapter = new CodingAgentRuntimeModelAdapter(source);

		adapter.refresh();
		expect(adapter.listAvailable()).toEqual([MODEL]);
		expect(adapter.find("test", "model")).toBe(MODEL);
		expect(await adapter.resolve(MODEL)).toBe("test-key");
		await adapter.refreshAuth("server-token");

		expect(refresh).toHaveBeenCalledOnce();
		expect(getApiKey).toHaveBeenCalledWith(MODEL);
		expect(setServerToken).toHaveBeenCalledWith("server-token");
		expect(loadRemoteModels).toHaveBeenCalledOnce();
	});

	it("maps basic prompt fields without adding synthetic context", async () => {
		const adapter = new CodingAgentPromptRequestAdapter({ now: () => 42 });
		const prepared = await preparePrompt(
			adapter,
			{
				text: "inspect image",
				images: [{ type: "image", data: "base64", mimeType: "image/png" }],
				streamingBehavior: "followUp",
				modelKey: "test/model",
				reasoning: "medium",
			},
			{ sessionId: "session-1", queueing: false },
		);

		expect(prepared).toEqual({
			input: {
				message: {
					role: "user",
					content: [
						{ type: "text", text: "inspect image" },
						{ type: "image", data: "base64", mimeType: "image/png" },
					],
					timestamp: 42,
				},
			},
		});
	});

	it("translates legacy prompt contributions into ordered generic context records", async () => {
		const adapter = new CodingAgentPromptRequestAdapter({
			now: () => 42,
			resolvePromptResource: (text, promptRef) => ({
				text,
				promptRef,
				skillInjection: "<skill>review</skill>",
			}),
		});
		const prepared = await preparePrompt(
			adapter,
			{
				text: "review this",
				promptRef: { kind: "skill", name: " review " },
				attachments: [{ kind: "file", path: "C:\\workspace\\a<b>.ts" }],
				metadata: {
					pluginInstructions: [" first ", 1, ""],
					knowledgeMode: true,
					settingsAssistInstruction: " configure ",
					settingsAssistTabId: " model ",
					ignored: true,
				},
			},
			{ sessionId: "session-1", queueing: false },
		);

		expect(prepared.input.message).toMatchObject({
			content: [{ type: "text", text: "review this" }],
			timestamp: 42,
		});
		expect(prepared.input.context?.map(({ type, modelVisible }) => ({ type, modelVisible }))).toEqual([
			{ type: "plugin_prompt_instruction", modelVisible: true },
			{ type: "knowledge_mode_instruction", modelVisible: true },
			{ type: "settings_assist_instruction", modelVisible: true },
			{ type: "prompt_attachment_context", modelVisible: true },
			{ type: "skill_expansion", modelVisible: true },
		]);
		expect(prepared.input.context?.[1]?.content).toContain("知识检索");
		expect(prepared.input.context?.[2]?.metadata).toEqual({ tabId: "model" });
		expect(prepared.input.context?.[3]?.content).toContain("a\\u003cb\\u003e.ts");
		expect(prepared.input.context?.[4]?.metadata).toEqual({
			promptRef: { kind: "skill", name: "review" },
		});
	});

	it("keeps unavailable resources model-invisible and flattens queued injections like the legacy path", async () => {
		const unavailable = new CodingAgentPromptRequestAdapter({ now: () => 42 });
		const prepared = await preparePrompt(
			unavailable,
			{ text: "use it", promptRef: { kind: "skill", name: "missing" }, attachments: [] },
			{ sessionId: "session-1", queueing: false },
		);
		expect(prepared.input.context).toMatchObject([
			{ type: "prompt_attachment_reference", modelVisible: false },
			{ type: "prompt_resource_reference", modelVisible: false },
		]);

		const queued = new CodingAgentPromptRequestAdapter({
			now: () => 42,
			resolvePromptResource: (text, promptRef) => ({
				text,
				promptRef,
				sceneInjection: "<scene>deploy</scene>",
			}),
		});
		const queuedPrompt = await preparePrompt(
			queued,
			{
				text: "now",
				promptRef: { kind: "scene", name: "deploy" },
				attachments: [{ kind: "file", path: "C:\\workspace\\deploy.md" }],
				streamingBehavior: "followUp",
			},
			{ sessionId: "session-1", queueing: true },
		);
		expect(queuedPrompt.input.context).toBeUndefined();
		expect(queuedPrompt.input.message.content).toEqual([
			{
				type: "text",
				text: expect.stringMatching(
					/^<prompt_attachments>[\s\S]+<\/prompt_attachments>[\s\S]+<scene>deploy<\/scene>\n\nnow$/,
				),
			},
		]);
	});

	it("compiles the exact legacy structured prompt from the current model-call tools and context", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-28T06:00:00.000Z"));
		try {
			const promptOptions = {
				cwd: "C:\\workspace",
				appendSystemPrompt: "Appended instruction",
				contextFiles: [{ path: "AGENTS.md", content: "Repository instruction" }],
				modePrompt: "Work mode instruction",
				personalization: "Persona instruction",
				scenario: "cli" as const,
				agentPlugins: {
					systemPromptContributions: [
						{
							pluginId: "plugin-a",
							operations: [
								{
									type: "addBlock" as const,
									block: {
										id: "plugin.extra",
										type: "plugin" as const,
										source: { kind: "plugin" as const, pluginId: "plugin-a" },
										content: "Plugin static instruction",
										priority: 875,
										enabled: true,
									},
								},
							],
						},
					],
				},
			};
			const observed: Array<{
				readonly activeToolNames: readonly string[];
				readonly messageRoles: readonly string[];
				readonly modelId: string | undefined;
			}> = [];
			const composer = new CodingAgentModelCallFrameComposer({
				resolveSystemPromptOptions(context) {
					observed.push({
						activeToolNames: context.activeToolNames,
						messageRoles: context.messages.map(({ role }) => role),
						modelId: context.modelBinding?.model.id,
					});
					return promptOptions;
				},
			});
			const readTool = {
				name: "read",
				label: "Read",
				description: "Read a file",
				inputSchema: { type: "object" },
				async execute() {
					return { content: [] };
				},
			};

			const frame = await composer.compose({
				sessionId: "session-1",
				turnId: "turn-1",
				signal: new AbortController().signal,
				messages: [{ role: "user", content: "inspect", timestamp: 1 }],
				modelBinding: { model: MODEL },
				frame: {
					instructions: [],
					tools: new Map([["read", readTool]]),
				},
			});

			expect(observed).toEqual([
				{
					activeToolNames: ["read"],
					messageRoles: ["user"],
					modelId: "model",
				},
			]);
			expect(frame.instructions).toEqual([
				{
					id: "coding-agent.system-prompt",
					content: buildSystemPrompt({
						...promptOptions,
						selectedTools: ["read"],
						toolDescriptions: { read: "Read a file" },
					}),
					priority: 0,
				},
			]);
			expect(frame.instructions[0]?.content).toContain("- read: Read a file");
			expect([...frame.tools.keys()]).toEqual(["read"]);
			const composition = frame.contextCompositionSections ?? [];
			expect(composition).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: "instruction:plugin.extra",
						kind: "instruction",
						source: { owner: "plugin", id: "plugin-a" },
					}),
					expect.objectContaining({
						id: "tool:read",
						kind: "tool_schema",
						source: { owner: "runtime", id: "read" },
					}),
				]),
			);
			expect(
				composition
					.filter(({ kind }) => kind === "instruction")
					.map(({ content }) => content)
					.join("\n\n"),
			).toBe(frame.instructions[0]?.content);
		} finally {
			vi.useRealTimers();
		}
	});

	it("merges ordered Feature instructions into the structured prompt and rejects block collisions", async () => {
		const composer = new CodingAgentModelCallFrameComposer({
			resolveSystemPromptOptions: () => ({
				customPrompt: "Base prompt",
				cwd: "C:\\workspace",
			}),
		});
		const context = {
			sessionId: "session-1",
			turnId: "turn-1",
			signal: new AbortController().signal,
			messages: [{ role: "user" as const, content: "inspect", timestamp: 1 }],
			frame: {
				instructions: [
					{ id: "feature.after", content: "After feature", priority: 650 },
					{ id: "feature.before", content: "Before feature", priority: 450 },
				],
				tools: new Map(),
			},
		};

		const frame = await composer.compose(context);
		const prompt = frame.instructions[0]?.content ?? "";
		expect(prompt.indexOf("Before feature")).toBeLessThan(prompt.indexOf("After feature"));
		expect(prompt).toContain("Base prompt");

		await expect(
			composer.compose({
				...context,
				frame: {
					instructions: [{ id: "core.tools", content: "collision", priority: 1 }],
					tools: new Map(),
				},
			}),
		).rejects.toThrow("Duplicate Coding Agent system prompt block id: core.tools");
	});

	it("reports final prompt diagnostics after feature contributions", async () => {
		const diagnostics = vi.fn();
		const composer = new CodingAgentModelCallFrameComposer({
			resolveSystemPromptOptions: () => ({
				customPrompt: "Base prompt",
				cwd: "C:\\workspace",
				promptBudgetTokens: 1,
			}),
			onPromptDiagnostics: diagnostics,
		});

		await composer.compose({
			sessionId: "session-1",
			turnId: "turn-1",
			signal: new AbortController().signal,
			messages: [],
			frame: {
				instructions: [{ id: "feature.extra", content: "Feature instruction", priority: 500 }],
				tools: new Map(),
			},
		});

		expect(diagnostics).toHaveBeenCalledOnce();
		expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ promptBudgetTokens: 1, overBudget: true }));
		expect(diagnostics.mock.calls[0]?.[0].blocks).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "feature.extra" })]),
		);
	});

	it("emits tools by generic modelOrder metadata while preserving unordered contribution order", async () => {
		const composer = new CodingAgentModelCallFrameComposer({
			resolveSystemPromptOptions: () => ({ customPrompt: "test", cwd: "C:\\workspace" }),
		});
		const names = [
			"kb_list_available_tags",
			"invoke_skill",
			"plugin_first",
			"ask_user_question",
			"todo",
			"current_time",
			"followup_task",
			"shell",
			"read",
			"doc_to_pdf",
			"spawn_agent",
			"kb_filter_by_tags",
			"plugin_second",
			"progress",
		];
		const orders = new Map<string, number>([
			["read", CODING_AGENT_MODEL_TOOL_ORDER.read],
			["shell", CODING_AGENT_MODEL_TOOL_ORDER.command],
			["doc_to_pdf", CODING_AGENT_MODEL_TOOL_ORDER.docToPdf],
			["current_time", CODING_AGENT_MODEL_TOOL_ORDER.currentTime],
			["progress", CODING_AGENT_MODEL_TOOL_ORDER.progress],
			["kb_filter_by_tags", CODING_AGENT_MODEL_TOOL_ORDER.knowledgeFilter],
			["kb_list_available_tags", CODING_AGENT_MODEL_TOOL_ORDER.knowledgeTags],
			["invoke_skill", CODING_AGENT_MODEL_TOOL_ORDER.invokeSkill],
			["todo", CODING_AGENT_MODEL_TOOL_ORDER.todo],
			["spawn_agent", CODING_AGENT_MODEL_TOOL_ORDER.subagentStart],
			["followup_task", CODING_AGENT_MODEL_TOOL_ORDER.subagentStart + CODING_AGENT_SUBAGENT_MODEL_TOOL_ORDER_STEP],
			["ask_user_question", CODING_AGENT_MODEL_TOOL_ORDER.askUserQuestion],
		]);
		const frame = await composer.compose({
			sessionId: "session-1",
			turnId: "turn-1",
			signal: new AbortController().signal,
			messages: [],
			frame: {
				instructions: [],
				tools: new Map(names.map((name) => [name, runtimeTool(name, orders.get(name))])),
			},
		});

		expect([...frame.tools.keys()]).toEqual([
			"read",
			"shell",
			"doc_to_pdf",
			"current_time",
			"progress",
			"kb_filter_by_tags",
			"kb_list_available_tags",
			"invoke_skill",
			"todo",
			"spawn_agent",
			"followup_task",
			"ask_user_question",
			"plugin_first",
			"plugin_second",
		]);
	});

	it("freezes Resource, Settings, Mode and Memory per Turn without sharing sessions", () => {
		let firstBasePrompt = "First session prompt v1";
		let firstPersonalization = "First persona v1";
		let firstMode: string | undefined = "work";
		let firstMemory = "First memory v1";
		const firstRefresh = vi.fn();
		const firstContextRefresh = vi.fn();
		const firstReloadPersonalization = vi.fn();
		const first = new CodingAgentPromptRuntime({
			cwd: "C:\\first",
			scenario: "cli",
			resourceLoader: {
				refreshContextResourcesIfChanged: firstContextRefresh,
				getSystemPrompt: () => firstBasePrompt,
				getAppendSystemPrompt: () => ["First append"],
				getAgentsFiles: () => ({
					agentsFiles: [{ path: "C:\\first\\AGENTS.md", content: "First repository instruction" }],
				}),
				getSkills: () => ({ skills: [], diagnostics: [] }),
				setRuntimeSkillPaths: () => {},
				refreshSkillsIfChanged: firstRefresh,
			},
			settingsManager: {
				reloadPersonalizationSettings: firstReloadPersonalization,
				getPersonalization: () => ({ personaId: "default", customPrompt: firstPersonalization }),
			},
			readAgentMode: () => firstMode,
			readMemory: () => ({
				enabled: true,
				file: "C:\\first\\MEMORY.md",
				snapshot: firstMemory,
				charLimit: 4_000,
			}),
		});
		const second = new CodingAgentPromptRuntime({
			cwd: "C:\\second",
			scenario: "cli",
			resourceLoader: {
				refreshContextResourcesIfChanged: () => false,
				getSystemPrompt: () => "Second session prompt",
				getAppendSystemPrompt: () => [],
				getAgentsFiles: () => ({ agentsFiles: [] }),
				getSkills: () => ({ skills: [], diagnostics: [] }),
				setRuntimeSkillPaths: () => {},
				refreshSkillsIfChanged: () => false,
			},
			settingsManager: {
				reloadPersonalizationSettings() {},
				getPersonalization: () => ({ personaId: "default", customPrompt: "Second persona" }),
			},
		});
		const context = {
			sessionId: "first",
			turnId: "turn-1",
			signal: new AbortController().signal,
			messages: [],
			frame: { instructions: [], tools: new Map() },
			activeToolNames: ["read"],
		};

		const firstTurn = first.bindForTurn();
		const firstCall = firstTurn(context);
		firstBasePrompt = "First session prompt v2";
		firstPersonalization = "First persona v2";
		firstMode = undefined;
		firstMemory = "First memory v2";
		const secondCall = firstTurn(context);
		const nextTurnCall = first.bindForTurn()({ ...context, turnId: "turn-2" });
		const isolatedCall = second.bindForTurn()({ ...context, sessionId: "second" });

		expect(firstCall).toMatchObject({
			customPrompt: "First session prompt v1",
			appendSystemPrompt: "First append",
			contextFiles: [{ content: "First repository instruction" }],
			memory: expect.stringContaining("First memory v1"),
			personalization: "First persona v1",
		});
		expect(firstCall.modePrompt).toBeTruthy();
		expect(secondCall).toMatchObject({
			customPrompt: "First session prompt v1",
			memory: expect.stringContaining("First memory v1"),
			personalization: "First persona v1",
		});
		expect(secondCall.modePrompt).toBeTruthy();
		expect(nextTurnCall).toMatchObject({
			customPrompt: "First session prompt v2",
			memory: expect.stringContaining("First memory v2"),
			personalization: "First persona v2",
		});
		expect(nextTurnCall.modePrompt).toBe("");
		expect(isolatedCall).toMatchObject({
			customPrompt: "Second session prompt",
			personalization: "Second persona",
		});
		expect(firstRefresh).toHaveBeenCalledTimes(2);
		expect(firstContextRefresh).toHaveBeenCalledTimes(2);
		expect(firstReloadPersonalization).toHaveBeenCalledTimes(2);
	});
});

const MODEL: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

function runtimeTool(name: string, modelOrder?: number) {
	return {
		name,
		label: name,
		description: name,
		inputSchema: { type: "object" },
		modelOrder,
		async execute() {
			return { content: [] };
		},
	};
}
