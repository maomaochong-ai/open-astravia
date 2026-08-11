import { dirname, join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { Api, Message, Model } from "@vetta/ai";
import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import { emptyHookDispatchOutcome } from "@vetta/ecosystem-adapter";
import type { RuntimeResourceContext, RuntimeSession } from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import { SubagentTypeRegistry } from "@vetta/runtime-subagents";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentSubagentProfile } from "../../src/composition/subagent/runtime.js";
import {
	type CodingAgentSubagentChildCompositionRequest,
	type CodingAgentSubagentChildFactory,
	createCodingAgentSubagentSessionAssembly,
} from "../../src/composition/subagent/session-assembly.js";

describe("Coding Agent Subagent session assembly", () => {
	it("does not assemble the capability when it is disabled", () => {
		const runtime = createCodingAgentSubagentSessionAssembly({
			...baseOptions(),
			enabled: false,
		});

		expect(runtime).toBeUndefined();
	});

	it("owns child policy, hook mapping, notifications, observations and cleanup", async () => {
		const compositionRequests: CodingAgentSubagentChildCompositionRequest[] = [];
		const childSessionOptions: unknown[] = [];
		const promptInputs: string[] = [];
		const hookCalls: string[] = [];
		const contexts: SessionContextRecord[] = [];
		const observations: unknown[] = [];
		let childCompositionDisposals = 0;
		const parentSessionPath = join("C:\\conversations", "parent.conversation.jsonl");
		const inheritedMcpView = {
			tools: [{ tool: { name: "mcp_parent_search" } }],
		} as unknown as McpRuntimeToolView;
		const hookRuntime = {
			async runSubagentStart(_context, turnId) {
				hookCalls.push(turnId);
				return { ...emptyHookDispatchOutcome(), additionalContexts: ["hook context"] };
			},
			async runSubagentStop(context) {
				hookCalls.push(context.turnId);
				return emptyHookDispatchOutcome();
			},
			async recordAdditionalContexts() {},
		} satisfies Pick<EcosystemHookRuntime, "recordAdditionalContexts" | "runSubagentStart" | "runSubagentStop">;
		const resourceContext = {
			async deliverAsyncContext(records) {
				contexts.push(...records);
			},
			async reportObservation(observation) {
				observations.push(observation);
			},
		} satisfies Pick<RuntimeResourceContext, "deliverAsyncContext" | "reportObservation">;
		const runtime = createCodingAgentSubagentSessionAssembly({
			enabled: true,
			cwd: "C:\\workspace",
			scenario: "cli",
			readParentSessionId: () => "parent",
			readParentSessionPath: () => parentSessionPath,
			readParentMessages: async () => [],
			readModel: () => MODEL,
			readThinkingLevel: () => "off",
			readInheritedMcpView: async () => inheritedMcpView,
			createChildComposition: async (request) => {
				compositionRequests.push(request);
				return {
					createSession: async (options) => {
						childSessionOptions.push(options);
						return childSession(options.sessionId, promptInputs);
					},
					resumeSession: async (options) => childSession(options.sessionId, promptInputs),
					appendSessionContext() {},
					async deliverSessionContext() {},
					async dispose() {
						childCompositionDisposals += 1;
					},
				};
			},
			hookRuntime,
			resourceContext,
		});
		if (!runtime) throw new Error("Expected enabled Subagent runtime");
		const spawnTool = runtime.readTools().find(({ name }) => name === "spawn_agent");
		if (!spawnTool) throw new Error("Expected spawn_agent tool");

		await spawnTool.execute({
			sessionId: "parent",
			turnId: "turn-1",
			toolCallId: "spawn-1",
			signal: new AbortController().signal,
			input: {
				description: "Inspect repository",
				task_name: "inspect_repo",
				message: "Inspect the repository.",
				agent_type: "explorer",
			},
		});
		await vi.waitFor(() => {
			expect(runtime.list()[0]?.status).toBe("completed");
		});

		expect(compositionRequests).toHaveLength(1);
		expect(compositionRequests[0]).toMatchObject({
			conversationDir: join(dirname(parentSessionPath), ".subagents", "parent"),
			cwd: "C:\\workspace",
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: {
				mode: "explicit",
				toolNames: expect.arrayContaining(["read", "grep", "glob", "find", "ls", "dir_tree", "mcp_parent_search"]),
			},
			inheritedMcpView,
		});
		expect(childSessionOptions[0]).toMatchObject({
			cwd: "C:\\workspace",
			parentSessionPath,
		});
		expect(hookCalls).toEqual([
			expect.stringMatching(/^parent:subagent-start:/),
			expect.stringMatching(/^parent:subagent-stop:.+:0$/),
		]);
		expect(promptInputs[0]).toContain("hook context");
		expect(observations).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: "subagents_update", source: "tool" })]),
		);
		await vi.waitFor(() => {
			expect(contexts).toEqual(expect.arrayContaining([expect.objectContaining({ type: "subagent-notification" })]));
		});

		await runtime.dispose();
		expect(childCompositionDisposals).toBe(1);
	});

	it("disposes the child composition once when child Session creation fails", async () => {
		const dispose = vi.fn(async () => {});
		const runtime = createCodingAgentSubagentSessionAssembly({
			...baseOptions(),
			createChildComposition: async () => ({
				createSession: async () => {
					throw new Error("child creation failed");
				},
				resumeSession: async () => {
					throw new Error("child resume failed");
				},
				appendSessionContext() {},
				async deliverSessionContext() {},
				dispose,
			}),
		});
		if (!runtime) throw new Error("Expected enabled Subagent runtime");
		const spawnTool = runtime.readTools().find(({ name }) => name === "spawn_agent");
		if (!spawnTool) throw new Error("Expected spawn_agent tool");

		await expect(
			spawnTool.execute({
				sessionId: "parent",
				turnId: "turn-failed",
				toolCallId: "spawn-failed",
				signal: new AbortController().signal,
				input: {
					description: "Fail child creation",
					task_name: "fail_child",
					message: "Fail while opening the child Session.",
					agent_type: "explorer",
				},
			}),
		).rejects.toThrow("child creation failed");
		await vi.waitFor(() => {
			expect(runtime.list()[0]?.status).toBe("failed");
		});
		expect(dispose).toHaveBeenCalledOnce();

		await runtime.dispose();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("reads the live parent MCP view at every child creation boundary", async () => {
		const firstView = { tools: [{ tool: { name: "mcp_first" } }] } as unknown as McpRuntimeToolView;
		const secondView = { tools: [{ tool: { name: "mcp_second" } }] } as unknown as McpRuntimeToolView;
		let currentView = firstView;
		const received: McpRuntimeToolView[] = [];
		const runtime = createCodingAgentSubagentSessionAssembly({
			...baseOptions(),
			readInheritedMcpView: async () => currentView,
			createChildComposition: async (request) => {
				if (request.inheritedMcpView) received.push(request.inheritedMcpView);
				return {
					createSession: async (options) => childSession(options.sessionId, []),
					resumeSession: async (options) => childSession(options.sessionId, []),
					appendSessionContext() {},
					async deliverSessionContext() {},
					async dispose() {},
				};
			},
		});
		if (!runtime) throw new Error("Expected enabled Subagent runtime");
		const spawnTool = runtime.readTools().find(({ name }) => name === "spawn_agent");
		if (!spawnTool) throw new Error("Expected spawn_agent tool");
		const executeSpawn = (taskName: string) =>
			spawnTool.execute({
				sessionId: "parent",
				turnId: `turn-${taskName}`,
				toolCallId: `spawn-${taskName}`,
				signal: new AbortController().signal,
				input: {
					task_name: taskName,
					message: `Inspect ${taskName}.`,
					agent_type: "explorer",
				},
			});

		await executeSpawn("first");
		currentView = secondView;
		await executeSpawn("second");

		expect(received).toEqual([firstView, secondView]);
		await runtime.dispose();
	});

	it("reads an injected type registry live and delegates child creation to the injected factory", async () => {
		const registry = new SubagentTypeRegistry<CodingAgentSubagentProfile>();
		const create = vi.fn<CodingAgentSubagentChildFactory["create"]>(async () => completedChild("custom-child"));
		const runtime = createCodingAgentSubagentSessionAssembly({
			...baseOptions(),
			typeRegistry: registry,
			createChildFactory: () => ({ create }),
		});
		if (!runtime) throw new Error("Expected enabled Subagent runtime");
		const spawnTool = runtime.readTools().find(({ name }) => name === "spawn_agent");
		if (!spawnTool) throw new Error("Expected spawn_agent tool");
		const request = {
			description: "Review repository",
			task_name: "review_repo",
			message: "Review the repository.",
			agent_type: "reviewer",
		};

		await expect(
			spawnTool.execute({
				sessionId: "parent",
				turnId: "turn-before-register",
				toolCallId: "spawn-before-register",
				signal: new AbortController().signal,
				input: request,
			}),
		).rejects.toThrow('Unknown agent_type "reviewer"');

		registry.register({
			id: "reviewer",
			label: "Reviewer",
			description: "Review code without changing it.",
			profile: {
				activation: { mode: "explicit", toolNames: [] },
				inheritParentMcp: false,
				systemPromptAddon: "Review only.",
				forkParentContext: true,
				includeTodo: false,
			},
		});
		const signal = new AbortController().signal;
		await expect(
			spawnTool.execute({
				sessionId: "parent",
				turnId: "turn-after-register",
				toolCallId: "spawn-after-register",
				signal,
				input: request,
			}),
		).resolves.toBeDefined();
		await vi.waitFor(() => expect(runtime.list()[0]?.status).toBe("completed"));
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ agentType: "reviewer", taskName: "review_repo" }),
			expect.objectContaining({ id: "reviewer" }),
			[],
			expect.any(AbortSignal),
		);

		await runtime.dispose();
	});

	it("injects custom type tools into the default Coding Agent child without changing their execution contract", async () => {
		const registry = new SubagentTypeRegistry<CodingAgentSubagentProfile>().register({
			id: "reviewer",
			label: "Reviewer",
			description: "Review code.",
			profile: {
				activation: { mode: "explicit", toolNames: [] },
				inheritParentMcp: false,
				systemPromptAddon: "Review only.",
				forkParentContext: false,
				includeTodo: false,
				createRuntimeTools: () => [
					{
						tool: {
							name: "review_code",
							label: "Review code",
							description: "Review code.",
							inputSchema: Type.Object({}),
							execute: async () => ({ content: [{ type: "text", text: "reviewed" }] }),
						},
						scopeUse: ["cli"],
						category: "external",
					},
				],
			},
		});
		const compositionRequests: CodingAgentSubagentChildCompositionRequest[] = [];
		const childOptions: unknown[] = [];
		const runtime = createCodingAgentSubagentSessionAssembly({
			...baseOptions(),
			typeRegistry: registry,
			createChildComposition: async (request) => {
				compositionRequests.push(request);
				return {
					createSession: async (options) => {
						childOptions.push(options);
						return childSession(options.sessionId, []);
					},
					resumeSession: async (options) => childSession(options.sessionId, []),
					appendSessionContext() {},
					async deliverSessionContext() {},
					async dispose() {},
				};
			},
		});
		if (!runtime) throw new Error("Expected enabled Subagent runtime");
		const spawnTool = runtime.readTools().find(({ name }) => name === "spawn_agent");
		if (!spawnTool) throw new Error("Expected spawn_agent tool");

		await spawnTool.execute({
			sessionId: "parent",
			turnId: "turn-custom-tool",
			toolCallId: "spawn-custom-tool",
			signal: new AbortController().signal,
			input: {
				description: "Review repository",
				task_name: "review_custom",
				message: "Review the repository.",
				agent_type: "reviewer",
			},
		});
		expect(compositionRequests[0]?.activation).toEqual({
			mode: "explicit",
			toolNames: ["review_code"],
		});
		expect(childOptions[0]).toMatchObject({
			sessionRuntimeTools: [expect.objectContaining({ tool: expect.objectContaining({ name: "review_code" }) })],
		});

		await runtime.dispose();
	});
});

function baseOptions() {
	return {
		enabled: true,
		cwd: "C:\\workspace",
		scenario: "cli" as const,
		readParentSessionId: () => "parent",
		readParentSessionPath: () => "C:\\conversations\\parent.conversation.jsonl",
		readParentMessages: async (): Promise<readonly Message[]> => [],
		readModel: () => MODEL,
		readThinkingLevel: () => "off" as const,
		readInheritedMcpView: async () => ({ tools: [] }) as McpRuntimeToolView,
		createChildComposition: async () => {
			throw new Error("disabled assembly must not create a child composition");
		},
		hookRuntime: {
			async runSubagentStart() {
				return emptyHookDispatchOutcome();
			},
			async runSubagentStop() {
				return emptyHookDispatchOutcome();
			},
			async recordAdditionalContexts() {},
		} satisfies Pick<EcosystemHookRuntime, "recordAdditionalContexts" | "runSubagentStart" | "runSubagentStop">,
		resourceContext: {
			async deliverAsyncContext() {},
			async reportObservation() {},
		} satisfies Pick<RuntimeResourceContext, "deliverAsyncContext" | "reportObservation">,
	};
}

function childSession(sessionId: string, promptInputs: string[]): RuntimeSession {
	const session = {
		sessionId,
		createCoreAssembly: () => ({
			lifecycle: { sessionPath: `C:\\conversations\\.subagents\\parent\\${sessionId}.conversation.jsonl` },
			todoController: undefined,
		}),
		prompt: async ({ text }: { readonly text: string }) => {
			promptInputs.push(text);
		},
		abort: async () => {},
		readState: () => ({ isStreaming: false }),
		readMessages: (): readonly Message[] => [],
		dispose: async () => {},
		subscribe: () => () => {},
	};
	return session as unknown as RuntimeSession;
}

function completedChild(sessionId: string) {
	return {
		sessionId,
		async prompt() {},
		async sendMessage() {},
		async followUp() {},
		abort() {},
		async waitForIdle() {},
		isStreaming: () => false,
		getLastAssistantText: () => "done",
		dispose() {},
		subscribe: () => () => {},
	};
}

const MODEL: Model<Api> = {
	id: "subagent-model",
	name: "Subagent Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
