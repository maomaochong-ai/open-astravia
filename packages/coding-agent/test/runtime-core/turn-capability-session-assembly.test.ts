import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type { RuntimeModel } from "@vetta/runtime-core";
import {
	type AgentFeatureDefinition,
	type ConversationContextProjector,
	FeatureCompiler,
	type ModelCallContextTransformationInput,
	PassthroughContextStrategy,
	RandomIdGenerator,
	RuntimeCapabilityComposition,
	type RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodingToolsRuntimeComposition } from "../../src/composition/tool-surface/runtime-tools-composition.js";
import { createCodingAgentTurnCapabilitySessionAssembly } from "../../src/composition/turn/capability-session-assembly.js";
import { CodingAgentImageSettingsSnapshotRouter } from "../../src/composition/turn/image-settings-snapshot-router.js";
import type { CodingAgentSessionExecutionRuntime } from "../../src/execution/session/runtime.js";
import { CodingAgentExtensionRunBridge } from "../../src/extensions/runtime/extension-run-bridge.js";
import { CodingAgentTodoRuntime } from "../../src/features/todo/todo-runtime.js";
import type { CodingAgentContextRuntime } from "../../src/runtime-contracts/index.js";
import { createFileSettingsRuntime } from "../fixtures/file-settings-runtime.js";
import { createTestSessionResourceRuntime } from "../fixtures/node-resource-runtime.js";
import { preparePrompt } from "./prompt-adapter-test-fixture.js";

describe("Coding Agent Turn Capability session assembly", () => {
	const disposals: Array<() => Promise<void> | void> = [];
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		for (const dispose of disposals.splice(0).reverse()) await dispose();
		for (const directory of temporaryDirectories.splice(0).reverse()) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("owns the session-local capability definition without changing its tool surface", async () => {
		const codingTools = createCodingToolsRuntimeComposition({
			cwd: "C:\\workspace",
			environment: emptyToolEnvironment(),
			activation: { mode: "explicit", toolNames: [] },
		});
		disposals.push(() => codingTools.dispose());
		const todoRuntime = new CodingAgentTodoRuntime();
		disposals.push(() => todoRuntime.dispose());
		const contextRuntime = createContextRuntime();
		const extensionEvents = new CodingAgentExtensionRunBridge();
		const specializedTool = createTool("specialized_tool");
		const executionTool = createTool("execution_tool");
		const executionFeature = createFeature("execution", []);
		const executionRuntime = {
			feature: executionFeature,
			ownsTool: () => false,
			readAvailableTools: () => new Map([[executionTool.name, executionTool]]),
		} as unknown as CodingAgentSessionExecutionRuntime;
		const assembly = await createCodingAgentTurnCapabilitySessionAssembly({
			session: {
				initialSessionId: "session-1",
				readSessionId: () => "session-1",
				cwd: "C:\\workspace",
				scenario: "cli",
			},
			activation: {
				resolve: () => ({ mode: "explicit", toolNames: [] }),
				readAgentMode: () => undefined,
				readAgentPlugins: () => undefined,
				readActiveToolNamesOverride: () => undefined,
			},
			prompt: {
				systemPromptOptionsResolver: async () => ({ cwd: "C:\\workspace" }),
			},
			baseCapabilities: {
				...codingTools.capabilities,
				features: [...codingTools.capabilities.features, executionFeature],
			},
			codingTools,
			executionRuntime,
			specializedToolFeature: createFeature("specialized", [specializedTool]),
			specializedToolRegistrations: [],
			continuationSources: [],
			todoRuntime,
			contextRuntime,
			conversationContextProjector: {
				project: () => [],
			} satisfies ConversationContextProjector,
			modelRuntime: { bind: () => undefined } as unknown as RuntimeModel,
			hookRuntime: {} as unknown as EcosystemHookRuntime,
			extensionEvents,
			imageSettingsSnapshots: new CodingAgentImageSettingsSnapshotRouter(),
		});
		disposals.push(() => assembly.dispose());
		const capabilities = await compileAssemblyCapabilities(assembly);
		disposals.push(() => capabilities.close());

		const lease = await capabilities.acquire();
		try {
			expect(lease.snapshot.tools.has(specializedTool.name)).toBe(true);
			expect(lease.snapshot.contextStrategy).toBe(contextRuntime);
			expect(lease.snapshot.modelCallFrameComposer).toBeDefined();
			expect(lease.snapshot.modelCallMessageFinalizer).toBeDefined();
			expect(lease.snapshot.continuationPolicy).toBeDefined();
			expect(lease.snapshot.agentRunPreparer).toBe(extensionEvents);
		} finally {
			await lease.release();
		}
		expect(assembly.readAvailableTools().get(executionTool.name)).toBe(executionTool);
		expect(assembly.readAvailableTools().has(specializedTool.name)).toBe(false);
		expect(() => assembly.rebindSession("session-2")).not.toThrow();
	});

	it("expands a Scene through an explicit host-owned Prompt Runtime", async () => {
		const root = mkdtempSync(join(tmpdir(), "turn-capability-scene-"));
		temporaryDirectories.push(root);
		const workspace = join(root, "workspace");
		const agentDir = join(root, "agent");
		const sceneName = "assembly-scene";
		const sceneDir = join(workspace, ".vetta", "skills", sceneName);
		mkdirSync(sceneDir, { recursive: true });
		writeFileSync(
			join(sceneDir, "SKILL.md"),
			`---\nname: ${sceneName}\ndescription: assembly scene\nmetadata:\n  type: scene\n---\nRun the assembly scene.\n`,
		);
		writeFileSync(join(sceneDir, "tasks.json"), JSON.stringify(["inspect", "report"]));

		const codingTools = createCodingToolsRuntimeComposition({
			cwd: workspace,
			environment: emptyToolEnvironment(),
			activation: { mode: "explicit", toolNames: [] },
		});
		disposals.push(() => codingTools.dispose());
		const todoRuntime = new CodingAgentTodoRuntime();
		disposals.push(() => todoRuntime.dispose());
		const executionRuntime = {
			feature: createFeature("execution", []),
			ownsTool: () => false,
			readAvailableTools: () => new Map(),
		} as unknown as CodingAgentSessionExecutionRuntime;
		const hookRuntime = createEmptyHookRuntime(workspace);
		const settingsSource = createFileSettingsRuntime(workspace, agentDir);
		const resourceSource = createTestSessionResourceRuntime({
			cwd: workspace,
			agentDir,
			settings: settingsSource,
			includeAgentSkills: false,
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
		});
		await resourceSource.reload();
		const runtimeSourceFactory = vi.fn(async (_context: { readonly runtimeSkillPaths: readonly string[] }) => ({
			resourceSource,
			settingsSource,
		}));
		const assembly = await createCodingAgentTurnCapabilitySessionAssembly({
			session: {
				initialSessionId: "session-1",
				readSessionId: () => "session-1",
				cwd: workspace,
				agentDir,
				includeAgentSkills: false,
				scenario: "conversation",
			},
			activation: {
				resolve: () => ({ mode: "explicit", toolNames: [] }),
				readAgentMode: () => undefined,
				readAgentPlugins: () => ({
					skillPathContributions: [{ pluginId: "scene-plugin", paths: [sceneDir] }],
				}),
				readActiveToolNamesOverride: () => undefined,
			},
			prompt: {
				runtimeSourceFactory,
			},
			baseCapabilities: codingTools.capabilities,
			codingTools,
			executionRuntime,
			specializedToolFeature: createFeature("specialized", []),
			specializedToolRegistrations: [],
			continuationSources: [],
			todoRuntime,
			contextRuntime: createContextRuntime(),
			conversationContextProjector: { project: () => [] } satisfies ConversationContextProjector,
			modelRuntime: { bind: () => undefined } as unknown as RuntimeModel,
			hookRuntime,
			extensionEvents: new CodingAgentExtensionRunBridge(),
			imageSettingsSnapshots: new CodingAgentImageSettingsSnapshotRouter(),
		});
		disposals.push(() => assembly.dispose());
		expect(runtimeSourceFactory).toHaveBeenCalledWith({ runtimeSkillPaths: [sceneDir] });

		const prepared = await preparePrompt(
			assembly.promptAdapter,
			{ text: "review it", promptRef: { kind: "scene", name: sceneName } },
			{ sessionId: "session-1", queueing: false },
		);

		expect(prepared.input.context?.[0]).toMatchObject({
			type: "scene_expansion",
			content: expect.stringContaining("Run the assembly scene."),
		});
		expect(todoRuntime.getLockSource()).toBe("scene");
		expect(todoRuntime.getAll()).toHaveLength(2);
	});

	it("previews the initial system prompt from the freshly loaded resource generation", async () => {
		const root = mkdtempSync(join(tmpdir(), "turn-capability-preview-"));
		temporaryDirectories.push(root);
		const workspace = join(root, "workspace");
		const agentDir = join(root, "agent");
		mkdirSync(workspace, { recursive: true });

		const codingTools = createCodingToolsRuntimeComposition({
			cwd: workspace,
			environment: emptyToolEnvironment(),
			activation: { mode: "explicit", toolNames: [] },
		});
		disposals.push(() => codingTools.dispose());
		const todoRuntime = new CodingAgentTodoRuntime();
		disposals.push(() => todoRuntime.dispose());
		const settingsSource = createFileSettingsRuntime(workspace, agentDir);
		const resourceSource = createTestSessionResourceRuntime({
			cwd: workspace,
			agentDir,
			settings: settingsSource,
			includeAgentSkills: false,
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
		});
		await resourceSource.reload();
		const refreshContext = vi.spyOn(resourceSource, "refreshContextResourcesIfChanged");
		const refreshSkills = vi.spyOn(resourceSource, "refreshSkillsIfChanged");
		const extensionEvents = new CodingAgentExtensionRunBridge();
		const assembly = await createCodingAgentTurnCapabilitySessionAssembly({
			session: {
				initialSessionId: "session-preview",
				readSessionId: () => "session-preview",
				cwd: workspace,
				agentDir,
				includeAgentSkills: false,
				scenario: "conversation",
			},
			activation: {
				resolve: () => ({ mode: "explicit", toolNames: [] }),
				readAgentMode: () => undefined,
				readAgentPlugins: () => undefined,
				readActiveToolNamesOverride: () => undefined,
			},
			prompt: {
				runtimeSourceFactory: async () => ({ resourceSource, settingsSource }),
			},
			baseCapabilities: codingTools.capabilities,
			codingTools,
			executionRuntime: {
				feature: createFeature("execution", []),
				ownsTool: () => false,
				readAvailableTools: () => new Map(),
			} as unknown as CodingAgentSessionExecutionRuntime,
			specializedToolFeature: createFeature("specialized", []),
			specializedToolRegistrations: [],
			continuationSources: [],
			todoRuntime,
			contextRuntime: createContextRuntime(),
			conversationContextProjector: { project: () => [] } satisfies ConversationContextProjector,
			modelRuntime: { bind: () => undefined } as unknown as RuntimeModel,
			hookRuntime: createPassthroughHookRuntime(),
			extensionEvents,
			imageSettingsSnapshots: new CodingAgentImageSettingsSnapshotRouter(),
		});
		disposals.push(() => assembly.dispose());
		const capabilities = await compileAssemblyCapabilities(assembly);
		disposals.push(() => capabilities.close());

		await assembly.previewInitialSystemPrompt(() => capabilities.acquire());

		expect(extensionEvents.readSystemPrompt()).not.toBe("");
		expect(refreshContext).not.toHaveBeenCalled();
		expect(refreshSkills).not.toHaveBeenCalled();
	});

	it.each(["specialized", "plugin"] as const)("executes %s tools without a consent provider", async (source) => {
		const codingTools = createCodingToolsRuntimeComposition({
			cwd: "C:\\workspace",
			environment: emptyToolEnvironment(),
			activation: { mode: "explicit", toolNames: [] },
		});
		disposals.push(() => codingTools.dispose());
		const todoRuntime = new CodingAgentTodoRuntime();
		disposals.push(() => todoRuntime.dispose());
		const executed: string[] = [];
		const specializedTool = createTool("vetd_create", executed);
		const pluginToolName = "generate_image";
		const toolName = source === "specialized" ? specializedTool.name : pluginToolName;
		const agentPlugins = {
			toolContributions: [
				{
					pluginId: "image-test",
					id: pluginToolName,
					name: pluginToolName,
					description: "Test image generation",
					parameters: { type: "object" },
					handlerId: "image-handler",
					scope_use: ["cli"],
				},
			],
		};
		const executionRuntime = {
			feature: createFeature("execution", []),
			ownsTool: () => false,
			readAvailableTools: () => new Map(),
		} as unknown as CodingAgentSessionExecutionRuntime;
		const assembly = await createCodingAgentTurnCapabilitySessionAssembly({
			session: {
				initialSessionId: "session-1",
				readSessionId: () => "session-1",
				cwd: "C:\\workspace",
				scenario: "cli",
			},
			activation: {
				resolve: () => ({ mode: "explicit", toolNames: [toolName] }),
				readAgentMode: () => undefined,
				readAgentPlugins: () => agentPlugins,
				readActiveToolNamesOverride: () => undefined,
			},
			prompt: {
				systemPromptOptionsResolver: async () => ({ cwd: "C:\\workspace" }),
			},
			baseCapabilities: codingTools.capabilities,
			codingTools,
			executionRuntime,
			specializedToolFeature: createFeature("specialized", [specializedTool]),
			specializedToolRegistrations: [{ tool: specializedTool, scopeUse: ["cli"], category: "core" }],
			pluginRuntime: {
				readAgentPlugins: () => agentPlugins,
				invokeTool: async () => {
					executed.push(pluginToolName);
					return { value: pluginToolName, effects: [] };
				},
			},
			continuationSources: [],
			todoRuntime,
			contextRuntime: createContextRuntime(),
			conversationContextProjector: { project: () => [] } satisfies ConversationContextProjector,
			modelRuntime: { bind: () => undefined } as unknown as RuntimeModel,
			hookRuntime: createPassthroughHookRuntime(),
			extensionEvents: new CodingAgentExtensionRunBridge(),
			imageSettingsSnapshots: new CodingAgentImageSettingsSnapshotRouter(),
		});
		disposals.push(() => assembly.dispose());
		const capabilities = await compileAssemblyCapabilities(assembly);
		disposals.push(() => capabilities.close());

		const lease = await capabilities.acquire({
			sessionId: "session-1",
			operationId: "turn-1",
			reason: "turn",
			signal: new AbortController().signal,
		});
		try {
			const composer = lease.snapshot.modelCallFrameComposer!;
			const frame = await composer.compose({
				sessionId: "session-1",
				turnId: "turn-1",
				signal: new AbortController().signal,
				messages: [],
				modelBinding: { model: TEST_MODEL },
				frame: { instructions: [], tools: new Map([[specializedTool.name, specializedTool]]) },
			} as unknown as Parameters<typeof composer.compose>[0]);
			const tool = frame.tools.get(toolName)!;

			await tool.execute(toolRequest("call-1"));
			await tool.execute(toolRequest("call-2"));
		} finally {
			await lease.release();
		}

		expect(executed).toEqual([toolName, toolName]);
	});
});

function compileAssemblyCapabilities(
	assembly: Awaited<ReturnType<typeof createCodingAgentTurnCapabilitySessionAssembly>>,
): Promise<RuntimeCapabilityComposition> {
	return RuntimeCapabilityComposition.create({
		initialDefinition: assembly.capabilityDefinition,
		compiler: new FeatureCompiler({ idGenerator: new RandomIdGenerator() }),
	});
}

function toolRequest(toolCallId: string) {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId,
		input: {},
		signal: new AbortController().signal,
	};
}

function emptyToolEnvironment() {
	return { registrations: [], dispose() {} };
}

function createPassthroughHookRuntime(): EcosystemHookRuntime {
	return {
		runPreToolUse: async () => ({ shouldStop: false, shouldBlock: false, additionalContexts: [] }),
		runPostToolUse: async () => ({ shouldStop: false, shouldBlock: false, additionalContexts: [] }),
		runPostToolUseFailure: async () => ({ shouldStop: false, shouldBlock: false, additionalContexts: [] }),
		recordAdditionalContexts: async () => {},
	} as unknown as EcosystemHookRuntime;
}

function createEmptyHookRuntime(cwd: string): EcosystemHookRuntime {
	return new EcosystemHookRuntime({
		host: {
			cwd,
			getSessionId: () => "session-1",
			getTranscriptPath: () => join(cwd, "session.jsonl"),
			getModelId: () => "model-1",
			abortCurrentRun() {},
		},
		initialSessionStartSource: "startup",
		loadAdapters: async () => [],
	});
}

function createFeature(id: string, tools: readonly RuntimeToolDefinition[]): AgentFeatureDefinition {
	return {
		id,
		async prepare() {
			return {
				async contribute() {
					return { tools };
				},
				async dispose() {},
			};
		},
	};
}

function createTool(name: string, executed?: string[]): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description: name,
		inputSchema: { type: "object", additionalProperties: false },
		async execute() {
			executed?.push(name);
			return { content: [{ type: "text", text: name }] };
		},
	};
}

function createContextRuntime(): CodingAgentContextRuntime {
	const contextStrategy = new PassthroughContextStrategy();
	return {
		id: "test-context",
		prepare: contextStrategy.prepare.bind(contextStrategy),
		async transform(input: ModelCallContextTransformationInput) {
			return input.messages;
		},
		async observe() {},
	} as unknown as CodingAgentContextRuntime;
}

const TEST_MODEL: Model<Api> = {
	id: "model",
	name: "Test model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8000,
	maxTokens: 1000,
};
