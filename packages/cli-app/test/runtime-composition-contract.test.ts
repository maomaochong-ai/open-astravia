import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import {
	type CodingAgentRuntimeComposition,
	createCodingAgentRuntimeComposition,
} from "@vetta/coding-agent/composition";
import type { CodingAgentRuntimeModelSource } from "@vetta/coding-agent/host-services";
import { assessRuntimeHostSessionAssembly } from "@vetta/runtime-core";
import {
	createMcpServerRuntimeToolSource,
	type McpClientHandle,
	type McpRuntimeToolSource,
	type McpTool,
} from "@vetta/runtime-mcp";
import { FileConversationRepository } from "@vetta/runtime-storage/conversation";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Runtime composition contract", () => {
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

	it("runs prompt, real read tool, persistence, resume and continue through the parallel backend", async () => {
		const workspace = await createTemporaryDirectory("runtime-workspace-");
		const conversations = await createTemporaryDirectory("runtime-conversations-");
		await writeFile(join(workspace, "message.txt"), "hello from the Runtime composition", "utf8");
		await seedRetryConversation(conversations);
		const responses = [
			assistantMessage(
				[{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "message.txt" } }],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "Read complete." }]),
			assistantMessage([{ type: "text", text: "Continued without another user message." }]),
		];
		const modelCalls: Array<{
			readonly model: Model<Api>;
			readonly apiKey: string | undefined;
			readonly tools: string[];
		}> = [];
		let responseIndex = 0;
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			cwd: workspace,
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: ["read"] },
			streamFn: (model, context, options) => {
				modelCalls.push({
					model,
					apiKey: options?.apiKey,
					tools: (context.tools ?? []).map(({ name }) => name).filter((name) => name === "read"),
				});
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		compositions.push(composition);

		const session = await composition.backend.create({ sessionId: "session-1", includeAgentSkills: false });
		await session.prompt({ text: "Read message.txt" });
		const firstMessages = await session.getMessages();

		expect(firstMessages.map(({ role }) => role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
		expect(firstMessages.find(({ role }) => role === "toolResult")).toMatchObject({
			content: [{ type: "text", text: expect.stringContaining("hello from the Runtime composition") }],
		});
		expect(modelCalls.slice(0, 2)).toEqual([
			{ model: MODEL, apiKey: "test-key", tools: ["read"] },
			{ model: MODEL, apiKey: "test-key", tools: ["read"] },
		]);
		expect(session.readState()).toMatchObject({ contextPercent: 0.025, contextWindow: 8_000 });
		await session.dispose();

		const resumed = await composition.backend.resume({ sessionId: "session-1", includeAgentSkills: false });
		expect(resumed.readState()).toMatchObject({ contextPercent: 0.025, contextWindow: 8_000 });
		expect((await resumed.getMessages()).map(({ role }) => role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
		await resumed.dispose();

		const retrySession = await composition.backend.resume({
			sessionId: "retry-session",
			includeAgentSkills: false,
		});
		await retrySession.continue();
		const retriedMessages = await retrySession.getMessages();
		expect(retriedMessages.map(({ role }) => role)).toEqual(["user", "assistant"]);
		expect(retriedMessages.at(-1)).toMatchObject({
			content: [{ type: "text", text: "Continued without another user message." }],
		});
		expect(modelCalls.at(-1)).toEqual({ model: MODEL, apiKey: "test-key", tools: ["read"] });
		await retrySession.dispose();
	});

	it("wires session-scoped manual compaction through the real composition root", async () => {
		const conversations = await createTemporaryDirectory("runtime-manual-compaction-");
		const generateCompaction = vi.fn(async (preparation, _model, _apiKey, customInstructions) => {
			expect(customInstructions).toBe("preserve architecture decisions");
			return {
				summary: "manual composition summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				details: { source: "composition-test" },
			};
		});
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			resolveCompactionSettings: () => ({
				enabled: true,
				reserveTokens: 20,
				minFreePercent: 20,
				keepRecentTokens: 1,
			}),
			generateCompaction,
			streamFn: () => new RecordedAssistantStream(assistantMessage([{ type: "text", text: "answer".repeat(20) }])),
		});
		compositions.push(composition);
		const session = await composition.backend.create({ sessionId: "manual-compaction" });
		await session.prompt({ text: "request".repeat(40) });
		const contextController = session.createCoreAssembly().contextController;
		if (!contextController) throw new Error("Context controller was not assembled");

		const result = await contextController.compact({
			customInstructions: "preserve architecture decisions",
		});

		expect(result).toMatchObject({
			summary: "manual composition summary",
			details: { source: "composition-test" },
		});
		expect(generateCompaction).toHaveBeenCalledOnce();
		expect(session.readHistory().at(-1)).toMatchObject({
			type: "compaction",
			summary: "manual composition summary",
		});
		await session.dispose();
	});

	it("reflects registry changes on the next model call without rebuilding the session", async () => {
		const conversations = await createTemporaryDirectory("runtime-dynamic-tools-");
		const toolLists: string[][] = [];
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: ["read", "bash"] },
			streamFn: (_model, context) => {
				toolLists.push(
					(context.tools ?? []).map(({ name }) => name).filter((name) => name === "read" || name === "bash"),
				);
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "dynamic-tools",
			includeAgentSkills: false,
		});

		await session.prompt({ text: "first" });
		expect(composition.tools.registry.deactivate("read")).toBe(true);
		expect(composition.tools.registry.deactivate("bash")).toBe(true);
		await session.prompt({ text: "second" });
		expect(composition.tools.registry.unregister("bash")).toBe(true);
		composition.tools.registry.register({
			tool: {
				name: "bash",
				label: "Replacement Bash",
				description: "Replacement command tool",
				inputSchema: { type: "object" },
				execute: async () => ({ content: [{ type: "text", text: "replacement" }] }),
			},
			scopeUse: [],
			category: "core",
		});
		await session.prompt({ text: "third" });

		expect(toolLists).toEqual([["read", "bash"], [], ["bash"]]);
		expect(session.readState().activeToolNames).toEqual(["bash"]);
		await session.dispose();
	});

	it("assembles real host, execution, background work, todo and configuration ports", async () => {
		const conversations = await createTemporaryDirectory("runtime-session-ports-");
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "session-ports",
			agentMode: "work",
		});
		const assessment = assessRuntimeHostSessionAssembly(session.createRuntimeHostAssemblyCandidate());

		expect(assessment.ready).toBe(true);
		if (!assessment.ready) throw new Error("Expected complete RuntimeHost assembly");
		expect(assessment.assembly.backgroundWorkController.readSubagents()).toEqual([]);
		const assembly = session.createRuntimeHostAssemblyCandidate();
		await assembly.hostInteraction?.bind({
			confirm: async () => true,
			requestSandboxGrant: async () => "allow_once",
		});
		expect(assembly.executionController?.isBusy()).toBe(false);
		await assembly.executionController?.reconfigure({
			mode: "full-access",
			sessionId: "session-ports",
		});
		assembly.configurationController?.setSteeringMode("all");
		assembly.configurationController?.setFollowUpMode("all");
		assembly.configurationController?.setAgentMode("plan");
		await assembly.configurationController?.reconfigureAgentPlugins(undefined);
		expect(await session.getState()).toMatchObject({
			steeringMode: "all",
			followUpMode: "all",
		});
		expect(assembly.todoController?.readItems()).toEqual([]);
		await session.dispose();
	});

	it("registers knowledge tools while keeping host availability fail-closed", async () => {
		const enabledConversations = await createTemporaryDirectory("runtime-knowledge-enabled-");
		const enabledModelTools: string[][] = [];
		const enabled = await createCodingAgentRuntimeComposition({
			conversationDir: enabledConversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			knowledgeEnabled: true,
			streamFn: (_model, context) => {
				enabledModelTools.push((context.tools ?? []).map(({ name }) => name));
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});
		compositions.push(enabled);
		const enabledSession = await enabled.backend.create({ sessionId: "knowledge-enabled" });

		await enabledSession.prompt({ text: "normal" });
		await enabledSession.prompt({ text: "search knowledge", metadata: { knowledgeMode: true } });
		expect(enabledModelTools[0]).not.toEqual(expect.arrayContaining(["kb_list_available_tags", "kb_filter_by_tags"]));
		expect(enabledModelTools[1]).toEqual(expect.arrayContaining(["kb_list_available_tags", "kb_filter_by_tags"]));
		await enabledSession.dispose();

		const disabledConversations = await createTemporaryDirectory("runtime-knowledge-disabled-");
		const disabledModelTools: string[][] = [];
		const disabled = await createCodingAgentRuntimeComposition({
			conversationDir: disabledConversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			knowledgeEnabled: false,
			streamFn: (_model, context) => {
				disabledModelTools.push((context.tools ?? []).map(({ name }) => name));
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});
		compositions.push(disabled);
		const disabledSession = await disabled.backend.create({ sessionId: "knowledge-disabled" });

		await disabledSession.prompt({
			text: "search unavailable knowledge",
			metadata: { knowledgeMode: true },
		});
		expect(disabledModelTools[0]).not.toEqual(
			expect.arrayContaining(["kb_list_available_tags", "kb_filter_by_tags"]),
		);
		expect(disabled.tools.registry.snapshot().registrations.map(({ tool }) => tool.name)).toEqual(
			expect.arrayContaining(["kb_list_available_tags", "kb_filter_by_tags"]),
		);
		await disabledSession.dispose();
	});

	it("creates stateful prompt resource resolvers per session", async () => {
		const conversations = await createTemporaryDirectory("runtime-session-resolvers-");
		const createPromptResourceResolver = vi.fn((sessionOptions: { readonly sessionId: string }) => {
			return (text: string) => ({
				text,
				skillInjection: `<skill>${sessionOptions.sessionId}</skill>`,
			});
		});
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			createPromptResourceResolver,
		});
		compositions.push(composition);

		const first = await composition.backend.create({ sessionId: "first-session" });
		const second = await composition.backend.create({ sessionId: "second-session" });

		expect(createPromptResourceResolver.mock.calls.map(([options]) => options.sessionId)).toEqual([
			"first-session",
			"second-session",
		]);
		await first.dispose();
		await second.dispose();
	});

	it("creates a real Resource and Settings prompt runtime for each Runtime session", async () => {
		const conversations = await createTemporaryDirectory("runtime-real-prompt-");
		const agentDir = await createTemporaryDirectory("runtime-agent-dir-");
		const firstWorkspace = await createTemporaryDirectory("runtime-first-workspace-");
		const secondWorkspace = await createTemporaryDirectory("runtime-second-workspace-");
		await writeFile(join(firstWorkspace, "AGENTS.md"), "First session repository instruction", "utf8");
		await writeFile(join(secondWorkspace, "AGENTS.md"), "Second session repository instruction", "utf8");
		const systemPrompts: string[] = [];
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			agentDir,
			activation: { mode: "explicit", toolNames: [] },
			streamFn: (_model, context) => {
				systemPrompts.push(context.systemPrompt ?? "");
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});
		compositions.push(composition);
		const first = await composition.backend.create({ sessionId: "real-prompt-first", cwd: firstWorkspace });
		const second = await composition.backend.create({ sessionId: "real-prompt-second", cwd: secondWorkspace });

		await first.prompt({ text: "first" });
		await second.prompt({ text: "second" });

		expect(systemPrompts[0]).toContain("First session repository instruction");
		expect(systemPrompts[0]).not.toContain("Second session repository instruction");
		expect(systemPrompts[1]).toContain("Second session repository instruction");
		expect(systemPrompts[1]).not.toContain("First session repository instruction");
		await first.dispose();
		await second.dispose();
	});

	it("recompiles the Coding Agent system prompt from current call tools and session-local options", async () => {
		const conversations = await createTemporaryDirectory("runtime-system-prompt-");
		const calls: Array<{
			readonly systemPrompt: string | undefined;
			readonly messages: readonly string[];
			readonly tools: readonly {
				readonly name: string;
				readonly description: string;
				readonly inputSchema: Readonly<Record<string, unknown>>;
			}[];
		}> = [];
		const sourceCalls: Array<{
			readonly sessionId: string;
			readonly activeToolNames: readonly string[];
			readonly messageRoles: readonly string[];
			readonly modelId: string | undefined;
		}> = [];
		let personalization = "Persona version 1";
		const createSystemPromptOptionsResolver = vi.fn(
			(sessionOptions: { readonly sessionId: string; readonly cwd?: string }) => {
				return (context: {
					readonly activeToolNames: readonly string[];
					readonly messages: readonly { readonly role: string }[];
					readonly modelBinding?: { readonly model: { readonly id: string } };
				}) => {
					sourceCalls.push({
						sessionId: sessionOptions.sessionId,
						activeToolNames: context.activeToolNames,
						messageRoles: context.messages.map(({ role }) => role),
						modelId: context.modelBinding?.model.id,
					});
					return {
						customPrompt: "Exact Coding Agent base prompt",
						appendSystemPrompt: "Appended product instruction",
						personalization,
						cwd: sessionOptions.cwd,
						scenario: "cli" as const,
					};
				};
			},
		);
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			cwd: "C:\\workspace",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: ["read"] },
			createSystemPromptOptionsResolver,
			streamFn: (_model, context) => {
				calls.push({
					systemPrompt: context.systemPrompt,
					messages: context.messages.map((message) => messageText(message)),
					tools: (context.tools ?? []).map(({ name, description, parameters }) => ({
						name,
						description,
						inputSchema: jsonValue(parameters),
					})),
				});
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "system-prompt-session",
			cwd: "C:\\session-workspace",
		});

		await session.prompt({ text: "first" });
		personalization = "Persona version 2";
		await session.prompt({ text: "second" });

		expect(createSystemPromptOptionsResolver).toHaveBeenCalledOnce();
		expect(sourceCalls).toEqual([
			{
				sessionId: "system-prompt-session",
				activeToolNames: [],
				messageRoles: [],
				modelId: "recorded-model",
			},
			{
				sessionId: "system-prompt-session",
				activeToolNames: ["read"],
				messageRoles: ["user"],
				modelId: "recorded-model",
			},
			{
				sessionId: "system-prompt-session",
				activeToolNames: ["read"],
				messageRoles: ["user", "assistant", "user"],
				modelId: "recorded-model",
			},
		]);
		expect(calls[0]?.systemPrompt).toContain("Exact Coding Agent base prompt");
		expect(calls[0]?.systemPrompt).toContain("Persona version 1");
		expect(calls[0]?.systemPrompt).not.toContain("Persona version 2");
		expect(calls[1]?.systemPrompt).toContain("Persona version 2");
		expect(calls[1]?.messages).toEqual(["first", "done", "second"]);
		const registeredRead = composition.tools.registry.resolve("read")?.registration.tool;
		expect(calls[0]?.tools).toEqual([
			{
				name: "read",
				description: registeredRead?.description,
				inputSchema: jsonValue(registeredRead?.inputSchema),
			},
		]);
		await session.dispose();
	});

	it("synchronizes MCP additions and removals before each model call", async () => {
		const conversations = await createTemporaryDirectory("runtime-mcp-");
		const tool: McpTool = {
			name: "lookup",
			description: "Lookup a value",
			inputSchema: { type: "object", properties: {} },
		};
		const client = createMcpClient();
		let available = true;
		const reloadIfChanged = vi.fn(async () => false);
		const mcpSource = createMcpServerRuntimeToolSource({
			reloadIfChanged,
			getReadyServerBindings: () => (available ? [createMcpServerBinding(client, [tool])] : []),
		});
		const modelTools: string[][] = [];
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			mcpSource,
			streamFn: (_model, context) => {
				modelTools.push((context.tools ?? []).map(({ name }) => name));
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({ sessionId: "mcp-session" });
		expect(session.readState().activeToolNames).toContain("mcp_search_lookup");
		const initialBinding = composition.tools.registry.resolve("mcp_search_lookup")?.binding;

		await session.prompt({ text: "unchanged MCP" });
		expect(modelTools[0]).toContain("mcp_search_lookup");
		expect(composition.tools.registry.resolve("mcp_search_lookup")?.binding).toEqual(initialBinding);

		available = false;
		await session.prompt({ text: "without MCP" });
		expect(modelTools[1]).not.toContain("mcp_search_lookup");
		expect(composition.tools.registry.resolve("mcp_search_lookup")).toBeUndefined();

		available = true;
		await session.prompt({ text: "with MCP again" });
		expect(modelTools[2]).toContain("mcp_search_lookup");
		expect(reloadIfChanged).toHaveBeenCalledTimes(4);
		await session.dispose();
	});

	it("keeps deferred MCP activation session-local and refreshes the model-call contract", async () => {
		const conversations = await createTemporaryDirectory("runtime-deferred-mcp-");
		const fixture = createMcpSourceFixture(16);
		const modelCalls: Array<{
			readonly systemPrompt: string | undefined;
			readonly messages: string[];
			readonly tools: Array<{
				readonly name: string;
				readonly description: string;
				readonly inputSchema: Readonly<Record<string, unknown>>;
			}>;
		}> = [];
		let responseIndex = 0;
		const responses = [
			assistantMessage(
				[
					{
						type: "toolCall",
						id: "search-1",
						name: "tool_search",
						arguments: { description: "Activate the matching MCP tool", query: "topic-15" },
					},
				],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "activated" }]),
			assistantMessage([{ type: "text", text: "isolated" }]),
			assistantMessage([{ type: "text", text: "removed" }]),
			assistantMessage([{ type: "text", text: "restored" }]),
			assistantMessage([{ type: "text", text: "resumed" }]),
		];
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			mcpSource: fixture.source,
			streamFn: (_model, context) => {
				modelCalls.push({
					systemPrompt: context.systemPrompt,
					messages: context.messages.map((message) => messageText(message)),
					tools: (context.tools ?? [])
						.filter(({ name }) => name === "tool_search" || name.startsWith("mcp_"))
						.map(({ name, description, parameters }) => ({
							name,
							description,
							inputSchema: parameters,
						})),
				});
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		compositions.push(composition);
		const first = await composition.backend.create({ sessionId: "deferred-first" });
		const second = await composition.backend.create({ sessionId: "deferred-second" });

		await first.prompt({ text: "activate topic 15" });
		expect(modelCalls[0]?.systemPrompt).toContain("MCP (Model Context Protocol) tools:");
		expect(modelCalls[0]?.systemPrompt).toContain("- mcp_search_tool_15: Lookup topic-15");
		expect(modelCalls[0]?.systemPrompt).toContain("**MCP tool usage (deferred)**");
		expect(modelCalls[0]?.messages).toEqual(["activate topic 15"]);
		expect(modelCalls[0]?.tools.map(({ name }) => name)).toEqual(["tool_search"]);
		expect(modelCalls[1]?.tools.map(({ name }) => name)).toEqual(["mcp_search_tool_15", "tool_search"]);
		expect(first.readState().activeToolNames).toEqual(expect.arrayContaining(["mcp_search_tool_15", "tool_search"]));

		await second.prompt({ text: "do not inherit activation" });
		expect(modelCalls[2]?.tools.map(({ name }) => name)).toEqual(["tool_search"]);

		fixture.setAvailable(false);
		await first.prompt({ text: "after removal" });
		expect(modelCalls[3]?.systemPrompt).not.toContain("mcp_search_tool_15");
		expect(modelCalls[3]?.tools).toEqual([]);

		fixture.setAvailable(true);
		await first.prompt({ text: "after restore" });
		expect(modelCalls[4]?.tools.map(({ name }) => name)).toEqual(["mcp_search_tool_15", "tool_search"]);
		await first.dispose();

		const resumed = await composition.backend.resume({ sessionId: "deferred-first" });
		await resumed.prompt({ text: "resume without ephemeral activation" });
		expect(modelCalls[5]?.tools.map(({ name }) => name)).toEqual(["tool_search"]);
		await resumed.dispose();
		await second.dispose();
	});

	it("projects all parent file MCP bindings into explorer children without child-side deferral", async () => {
		const conversations = await createTemporaryDirectory("runtime-subagent-mcp-");
		const fixture = createMcpSourceFixture(16);
		const rootMcpTools: string[][] = [];
		const childMcpTools: string[][] = [];
		let rootCalls = 0;
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			enableSubagents: true,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			mcpSource: fixture.source,
			streamFn: (_model, context) => {
				const toolNames = (context.tools ?? []).map(({ name }) => name);
				const mcpTools = toolNames.filter((name) => name === "tool_search" || name.startsWith("mcp_"));
				if (toolNames.includes("spawn_agent")) {
					rootMcpTools.push(mcpTools);
					if (rootCalls === 0) {
						rootCalls += 1;
						return new RecordedAssistantStream(
							assistantMessage(
								[
									{
										type: "toolCall",
										id: "spawn-mcp-explorer",
										name: "spawn_agent",
										arguments: {
											description: "Inspect inherited MCP tools",
											task_name: "inspect_file_mcp",
											message: "Report the available MCP tools.",
											agent_type: "explorer",
										},
									},
								],
								"toolUse",
							),
						);
					}
					return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "root done" }]));
				}
				childMcpTools.push(mcpTools);
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "child done" }]));
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({ sessionId: "subagent-file-mcp" });

		await session.prompt({ text: "delegate MCP inspection" });
		await vi.waitFor(() => expect(childMcpTools).toHaveLength(1));

		expect(rootMcpTools[0]).toEqual(["tool_search"]);
		expect(new Set(childMcpTools[0])).toEqual(new Set(fixture.descriptors.map(({ name }) => name)));
		expect(childMcpTools[0]).toHaveLength(fixture.descriptors.length);
		expect(childMcpTools[0]).not.toContain("tool_search");
		await session.dispose();
	});

	it("keeps explicit MCP activation eager above the deferred threshold", async () => {
		const conversations = await createTemporaryDirectory("runtime-explicit-mcp-");
		const fixture = createMcpSourceFixture(16);
		const calls: Array<{ readonly systemPrompt: string | undefined; readonly tools: string[] }> = [];
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: ["mcp_search_tool_15"] },
			mcpSource: fixture.source,
			streamFn: (_model, context) => {
				calls.push({
					systemPrompt: context.systemPrompt,
					tools: (context.tools ?? []).map(({ name }) => name).filter((name) => name.startsWith("mcp_")),
				});
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "explicit-mcp",
			includeAgentSkills: false,
		});

		await session.prompt({ text: "use the selected MCP tool" });

		expect(calls[0]?.systemPrompt).toContain("- mcp_search_tool_15: Lookup topic-15");
		expect(calls[0]?.systemPrompt).not.toContain("**MCP tool usage (deferred)**");
		expect(calls[0]?.tools).toEqual(["mcp_search_tool_15"]);
		await session.dispose();
	});

	it("merges current session MCP discovery state into the composed Coding Agent prompt", async () => {
		const conversations = await createTemporaryDirectory("runtime-composed-mcp-");
		const fixture = createMcpSourceFixture(16);
		const calls: Array<{ readonly systemPrompt: string | undefined; readonly mcpTools: readonly string[] }> = [];
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			mcpSource: fixture.source,
			resolveSystemPromptOptions: () => ({
				customPrompt: "Composed Coding Agent prompt",
				scenario: "cli",
			}),
			streamFn: (_model, context) => {
				calls.push({
					systemPrompt: context.systemPrompt,
					mcpTools: (context.tools ?? [])
						.map(({ name }) => name)
						.filter((name) => name === "tool_search" || name.startsWith("mcp_")),
				});
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({ sessionId: "composed-mcp" });

		await session.prompt({ text: "discover tools" });
		expect(calls[0]?.systemPrompt).toContain("Composed Coding Agent prompt");
		expect(calls[0]?.systemPrompt).toContain("# MCP (Model Context Protocol) Tools");
		expect(calls[0]?.systemPrompt).toContain("**mcp_search_tool_15**: Lookup topic-15");
		expect(calls[0]?.systemPrompt).toContain("**MCP tool usage (deferred)**");
		expect(calls[0]?.systemPrompt?.match(/# MCP \(Model Context Protocol\) Tools/g)).toHaveLength(1);
		expect(calls[0]?.mcpTools).toEqual(["tool_search"]);

		fixture.setAvailable(false);
		await session.prompt({ text: "after removal" });
		expect(calls[1]?.systemPrompt).toContain("Composed Coding Agent prompt");
		expect(calls[1]?.systemPrompt).not.toContain("mcp_search_tool_15");
		expect(calls[1]?.mcpTools).toEqual([]);
		await session.dispose();
	});

	it("persists hidden prompt contributions while keeping the chat projection clean", async () => {
		const conversations = await createTemporaryDirectory("runtime-prompt-context-");
		const modelInputs: string[][] = [];
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir: conversations,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			resolvePromptResource: (text, promptRef) => ({
				text,
				promptRef,
				skillInjection: "<skill>review</skill>",
			}),
			streamFn: (_model, context) => {
				modelInputs.push(context.messages.map((message) => messageText(message)));
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({ sessionId: "prompt-context" });

		await session.prompt({
			text: "inspect",
			promptRef: { kind: "skill", name: "review" },
			attachments: [{ kind: "file", path: "C:\\workspace\\file.ts" }],
			metadata: {
				pluginInstructions: ["plugin instruction"],
				settingsAssistInstruction: "settings instruction",
			},
		});

		expect(modelInputs[0]).toEqual([
			"plugin instruction",
			"settings instruction",
			expect.stringContaining("<prompt_attachments>"),
			"<skill>review</skill>",
			"inspect",
		]);
		expect((await session.getMessages()).map(({ role }) => role)).toEqual(["user", "assistant"]);
		expect(session.readHistory()).toMatchObject([
			{ type: "settings_assist_marker" },
			{ type: "prompt_attachments_marker" },
			{ type: "prompt_ref_marker" },
			{ type: "message", message: { role: "user" } },
			{ type: "message", message: { role: "assistant" } },
		]);
		await session.dispose();

		const resumed = await composition.backend.resume({ sessionId: "prompt-context" });
		await resumed.prompt({ text: "again" });
		expect(modelInputs[1]).toEqual([
			"plugin instruction",
			"settings instruction",
			expect.stringContaining("<prompt_attachments>"),
			"<skill>review</skill>",
			"inspect",
			"done",
			"again",
		]);
		await resumed.dispose();
	});

	async function createTemporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		temporaryDirectories.push(directory);
		return directory;
	}
});

async function seedRetryConversation(rootDir: string): Promise<void> {
	const repository = new FileConversationRepository({ rootDir });
	try {
		await repository.create({ sessionId: "retry-session", createdAt: 1 });
		await repository.append("retry-session", 0, [
			{
				type: "turn.started",
				sessionId: "retry-session",
				turnId: "failed-turn",
				snapshotId: "seed",
				timestamp: 1,
			},
			{
				type: "message.appended",
				sessionId: "retry-session",
				turnId: "failed-turn",
				message: { role: "user", content: "Retry this request", timestamp: 1 },
				timestamp: 1,
			},
			{
				type: "turn.failed",
				sessionId: "retry-session",
				turnId: "failed-turn",
				error: { code: "SEEDED_FAILURE", message: "Seeded retry state" },
				timestamp: 1,
			},
		]);
	} finally {
		await repository.close();
	}
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
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				this.push({ type: "error", reason: message.stopReason, error: message });
				return;
			}
			this.push({ type: "done", reason: message.stopReason, message });
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

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
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

function messageText(message: unknown): string {
	if (!isRecord(message)) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((item): item is { readonly type: "text"; readonly text: string } => {
			return isRecord(item) && item.type === "text" && typeof item.text === "string";
		})
		.map(({ text }) => text)
		.join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValue<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
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

function createMcpClient(): McpClientHandle {
	return {
		async initialize() {
			throw new Error("Not used");
		},
		async listTools() {
			throw new Error("Not used");
		},
		async callTool() {
			return { content: [{ type: "text", text: "result" }] };
		},
		async listResources() {
			throw new Error("Not used");
		},
		async readResource() {
			throw new Error("Not used");
		},
		async listPrompts() {
			throw new Error("Not used");
		},
		async close() {},
		getName: () => "search",
		getPid: () => undefined,
		isClientInitialized: () => true,
	};
}

function createMcpSourceFixture(toolCount: number): {
	readonly source: McpRuntimeToolSource;
	readonly descriptors: readonly { readonly name: string; readonly description: string }[];
	readonly setAvailable: (available: boolean) => void;
} {
	const client = createMcpClient();
	const tools: McpTool[] = Array.from({ length: toolCount }, (_, index) => ({
		name: `tool_${index}`,
		description: `Lookup topic-${index}`,
		inputSchema: { type: "object", properties: {} },
	}));
	let available = true;
	return {
		source: createMcpServerRuntimeToolSource({
			reloadIfChanged: async () => false,
			getReadyServerBindings: () => (available ? [createMcpServerBinding(client, tools)] : []),
		}),
		descriptors: tools.map(({ name, description }) => ({
			name: `mcp_search_${name}`,
			description: description ?? "",
		})),
		setAvailable(next) {
			available = next;
		},
	};
}

function createMcpServerBinding(client: McpClientHandle, tools: readonly McpTool[]) {
	const view = {
		name: "search",
		config: { command: "test" },
		status: "ready" as const,
		tools,
		resources: [],
		startedAt: 1,
	};
	return {
		client,
		view,
		acquireLease: () => ({ client, view, release: async () => {} }),
	};
}
