import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import { createCodingAgentRuntimeSessionSelection } from "@vetta/coding-agent/composition";
import { ENV_AGENT_DIR, getAgentDir } from "@vetta/coding-agent/config";
import {
	type CodingAgentPluginRuntimeSource,
	type CodingAgentRuntimeModelSource,
	createCodingAgentMcpRuntimeToolSource,
	createCodingAgentPluginMcpRuntime,
} from "@vetta/coding-agent/host-services";
import type { AgentPluginRuntimeConfig } from "@vetta/coding-agent/plugin-runtime";
import { ALL_SCENARIOS, type ConversationScenario } from "@vetta/coding-agent/profile";
import { RuntimeHost } from "@vetta/runtime-core";
import { DesktopRuntimeBackendPool } from "@vetta/runtime-desktop";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	type OpenAiResponsesTestServer,
	type ProviderRequest,
	startOpenAiResponsesTestServer,
	textResponseEvents,
	toolCallResponseEvents,
} from "../../../../cli-host/test/support/openai-responses-test-server.js";
import { getModePrompt } from "../agent-modes/index.js";
import { getDesktopUserQuestionBroker } from "../conversations/user-question-broker.js";
import { createDesktopCodingAgentFunctionSource } from "./function-extension-source.js";
import { createDesktopMcpSupervisor } from "./mcp-supervisor.js";
import { createDesktopPromptRuntimeSources } from "./resource-runtime.js";

type RuntimeBackend = "runtime";

const TEST_FUNCTION_LOGGER = { warn: () => {} };

interface RuntimeFixture {
	readonly runtime: RuntimeHost;
	readonly dispose: () => Promise<void>;
}

interface ModelCallObservation {
	readonly body: Readonly<Record<string, unknown>>;
}

describe("Desktop RuntimeHost model-call frame contract", () => {
	const directories: string[] = [];
	const fixtures: RuntimeFixture[] = [];
	const questionHandlerDisposals: Array<() => void> = [];
	const servers: OpenAiResponsesTestServer[] = [];
	const originalAgentDir = process.env[ENV_AGENT_DIR];
	let isolatedGlobalAgentDir: string;

	beforeAll(async () => {
		isolatedGlobalAgentDir = await mkdtemp(join(tmpdir(), "desktop-frame-global-agent-"));
		process.env[ENV_AGENT_DIR] = isolatedGlobalAgentDir;
	});

	afterEach(async () => {
		for (const fixture of fixtures.splice(0).reverse()) await fixture.dispose();
		for (const dispose of questionHandlerDisposals.splice(0).reverse()) dispose();
		for (const server of servers.splice(0).reverse()) await server.dispose();
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	afterAll(async () => {
		if (originalAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = originalAgentDir;
		await rm(isolatedGlobalAgentDir, { recursive: true, force: true });
	});

	for (const scenario of ALL_SCENARIOS) {
		it(`preserves the exact ${scenario} model-call frame contract`, async () => {
			const cwd = await temporaryDirectory(`desktop-frame-${scenario}-workspace-`);
			const observations = await observeBackends(cwd, scenario);

			assertCanonicalModelCallFrame(observations.runtime);
		}, 30_000);
	}

	it("applies host capability changes at the next production Runtime turn boundary", async () => {
		const cwd = await temporaryDirectory("desktop-frame-dynamic-workspace-");
		const observations: Record<RuntimeBackend, readonly ModelCallObservation[]> = {
			runtime: [],
		};

		for (const backend of RUNTIME_BACKENDS) {
			const server = await createServer();
			const model = { ...MODEL, baseUrl: server.baseUrl };
			const agentStateDir = await temporaryDirectory(`desktop-frame-${backend}-dynamic-agent-`);
			const sessionDir = await temporaryDirectory(`desktop-frame-${backend}-dynamic-sessions-`);
			const pluginRuntime = createMutablePluginRuntimeSource(pluginConfiguration());
			const fixture = createRuntimeFixture(backend, agentStateDir, model, pluginRuntime.source);
			fixtures.push(fixture);
			const unregisterQuestion = getDesktopUserQuestionBroker().setInteractiveHandler(async () => ({
				cancelled: true,
				answers: [],
			}));
			questionHandlerDisposals.push(unregisterQuestion);

			const created = await fixture.runtime.createSession({
				cwd,
				agentDir: agentStateDir,
				sessionDir,
				model,
				thinkingLevel: "off",
				agent: createCodingAgentRuntimeSessionSelection({
					scenario: "conversation",
					agentMode: "work",
					enableBackgroundTasks: true,
					includeAgentSkills: false,
					systemPromptAddon: "Model-call frame host instruction",
				}),
				executionMode: "full-access",
			});
			await fixture.runtime.prompt(created.sessionId, { text: "Inspect the active capabilities" });
			const firstFrame = observeRequest(server, 0);

			pluginRuntime.publish(undefined);
			unregisterQuestion();
			await fixture.runtime.prompt(created.sessionId, {
				text: "Inspect the capabilities after reconfiguration",
				metadata: { knowledgeMode: true },
			});
			const secondFrame = observeRequest(server, 1);
			observations[backend] = [firstFrame, secondFrame];
		}

		const [before, after] = observations.runtime;
		if (!before || !after) {
			throw new Error("Expected two model-call observations");
		}
		assertCanonicalModelCallFrame(before);
		assertCanonicalModelCallFrame(after);
		const beforeNames = toolNames(before.body.tools);
		expect(beforeNames).toContain("plugin_model_call_frame");
		expect(beforeNames).toContain("ask_user_question");
		expect(JSON.stringify(before.body.input)).toContain("Model-call frame plugin instruction");
		const afterNames = toolNames(after.body.tools);
		expect(afterNames).not.toContain("plugin_model_call_frame");
		expect(afterNames).not.toContain("ask_user_question");
		expect(JSON.stringify(after.body.input)).not.toContain("Model-call frame plugin instruction");
		expect(sharedProviderBody(after.body)).not.toEqual(sharedProviderBody(before.body));
	}, 30_000);

	it("applies Skill add, change and deletion on the next model call without rebuilding the session", async () => {
		const observations: Record<RuntimeBackend, readonly SkillFrameObservation[]> = {
			runtime: [],
		};

		for (const backend of RUNTIME_BACKENDS) {
			const cwd = await temporaryDirectory(`desktop-frame-${backend}-dynamic-skill-workspace-`);
			const server = await createServer();
			const model = { ...MODEL, baseUrl: server.baseUrl };
			const agentStateDir = await temporaryDirectory(`desktop-frame-${backend}-dynamic-skill-agent-`);
			const sessionDir = await temporaryDirectory(`desktop-frame-${backend}-dynamic-skill-sessions-`);
			const fixture = createRuntimeFixture(backend, agentStateDir, model);
			fixtures.push(fixture);
			const created = await fixture.runtime.createSession({
				cwd,
				agentDir: agentStateDir,
				sessionDir,
				model,
				thinkingLevel: "off",
				agent: createCodingAgentRuntimeSessionSelection({
					scenario: "conversation",
					enableBackgroundTasks: false,
					includeAgentSkills: false,
				}),
				executionMode: "full-access",
			});

			await fixture.runtime.prompt(created.sessionId, { text: "Observe skills before creation" });
			const skillDirectory = join(cwd, ".vetta", "skills", "phase-112-dynamic-skill");
			const skillPath = join(skillDirectory, "SKILL.md");
			await mkdir(skillDirectory, { recursive: true });
			await writeFile(skillPath, skillDocument(PHASE_112_SKILL_V1), "utf8");
			await fixture.runtime.prompt(created.sessionId, { text: "Observe the added skill" });
			await writeFile(skillPath, skillDocument(PHASE_112_SKILL_V2), "utf8");
			await fixture.runtime.prompt(created.sessionId, { text: "Observe the changed skill" });
			await rm(skillDirectory, { recursive: true, force: true });
			await fixture.runtime.prompt(created.sessionId, { text: "Observe skills after deletion" });

			expect(fixture.runtime.getState(created.sessionId).sessionId).toBe(created.sessionId);
			observations[backend] = server.requests.map(({ body }) => observeSkillFrame(body));
		}

		const expected: readonly SkillFrameObservation[] = [
			{ hasVersionOne: false, hasVersionTwo: false },
			{ hasVersionOne: true, hasVersionTwo: false },
			{ hasVersionOne: false, hasVersionTwo: true },
			{ hasVersionOne: false, hasVersionTwo: false },
		];
		expect(observations.runtime).toEqual(expected);
	}, 30_000);

	it("keeps specialized-tool cwd isolated across sessions sharing one RuntimeHost", async () => {
		const firstCwd = await temporaryDirectory("desktop-frame-first-cwd-");
		const secondCwd = await temporaryDirectory("desktop-frame-second-cwd-");
		await Promise.all([
			writeFile(join(firstCwd, "source.pdf"), "%PDF-1.4\n", "utf8"),
			writeFile(join(secondCwd, "source.pdf"), "%PDF-1.4\n", "utf8"),
		]);
		const server = await startOpenAiResponsesTestServer((_request, index) => {
			if (index === 0 || index === 2) {
				return {
					kind: "events",
					events: toolCallResponseEvents(
						"render_pdf_page",
						{ input: "source.pdf", page: 1, output: "invalid.txt" },
						{
							callId: `call_cwd_${index}`,
							itemId: `item_cwd_${index}`,
							responseId: `response_cwd_${index}`,
						},
					),
				};
			}
			return { kind: "events", events: textResponseEvents(`cwd result ${index}`) };
		});
		servers.push(server);
		const model = { ...MODEL, baseUrl: server.baseUrl };
		const agentStateDir = await temporaryDirectory("desktop-frame-cwd-agent-");
		const fixture = createRuntimeFixture("runtime", agentStateDir, model);
		fixtures.push(fixture);

		const first = await fixture.runtime.createSession({
			cwd: firstCwd,
			agentDir: agentStateDir,
			sessionDir: await temporaryDirectory("desktop-frame-first-sessions-"),
			model,
			thinkingLevel: "off",
			agent: createCodingAgentRuntimeSessionSelection({
				scenario: "conversation",
				agentMode: "work",
				includeAgentSkills: false,
			}),
			executionMode: "full-access",
		});
		const second = await fixture.runtime.createSession({
			cwd: secondCwd,
			agentDir: agentStateDir,
			sessionDir: await temporaryDirectory("desktop-frame-second-sessions-"),
			model,
			thinkingLevel: "off",
			agent: createCodingAgentRuntimeSessionSelection({
				scenario: "conversation",
				agentMode: "work",
				includeAgentSkills: false,
			}),
			executionMode: "full-access",
		});

		await fixture.runtime.prompt(first.sessionId, { text: "Render the relative PDF in the first workspace" });
		await fixture.runtime.prompt(second.sessionId, { text: "Render the relative PDF in the second workspace" });

		expect(server.requests).toHaveLength(4);
		const firstToolResult = collectStringValues(server.requests[1]?.body.input).join("\n");
		const secondToolResult = collectStringValues(server.requests[3]?.body.input).join("\n");
		expect(firstToolResult).toContain(join(firstCwd, "invalid.txt"));
		expect(firstToolResult).not.toContain(secondCwd);
		expect(secondToolResult).toContain(join(secondCwd, "invalid.txt"));
		expect(secondToolResult).not.toContain(firstCwd);
	}, 30_000);

	// 工作模式注册表归 desktop 所有（ADR-0071 修订）：coding-agent 只保留 core.mode 槽位。
	// 这条用例验证整条注入链——宿主 resolver → composition → Prompt Runtime → system prompt。
	it("carries the Desktop-owned mode prompt into the system prompt of the session's agentMode", async () => {
		const cwd = await temporaryDirectory("desktop-frame-mode-prompt-workspace-");
		const server = await createServer();
		const model = { ...MODEL, baseUrl: server.baseUrl };
		const agentStateDir = await temporaryDirectory("desktop-frame-mode-prompt-agent-");
		const fixture = createRuntimeFixture("runtime", agentStateDir, model);
		fixtures.push(fixture);

		const created = await fixture.runtime.createSession({
			cwd,
			agentDir: agentStateDir,
			sessionDir: await temporaryDirectory("desktop-frame-mode-prompt-sessions-"),
			model,
			thinkingLevel: "off",
			agent: createCodingAgentRuntimeSessionSelection({
				scenario: "conversation",
				agentMode: "coding",
				includeAgentSkills: false,
			}),
			executionMode: "full-access",
		});
		await fixture.runtime.prompt(created.sessionId, { text: "State the active mode" });

		const systemPrompt = collectStringValues(observeRequest(server, 0).body.input).join("\n");
		expect(systemPrompt).toContain(getModePrompt("coding"));
		expect(systemPrompt).not.toContain(getModePrompt("work"));
	}, 30_000);

	async function observeBackends(
		cwd: string,
		scenario: ConversationScenario,
	): Promise<Record<RuntimeBackend, ModelCallObservation>> {
		const observations = {} as Record<RuntimeBackend, ModelCallObservation>;
		for (const backend of RUNTIME_BACKENDS) {
			const server = await createServer();
			const model = { ...MODEL, baseUrl: server.baseUrl };
			const agentStateDir = await temporaryDirectory(`desktop-frame-${backend}-${scenario}-agent-`);
			const sessionDir = await temporaryDirectory(`desktop-frame-${backend}-${scenario}-sessions-`);
			const fixture = createRuntimeFixture(backend, agentStateDir, model);
			fixtures.push(fixture);
			const created = await fixture.runtime.createSession({
				cwd,
				agentDir: agentStateDir,
				sessionDir,
				model,
				thinkingLevel: "off",
				agent: createCodingAgentRuntimeSessionSelection({
					scenario,
					enableBackgroundTasks: false,
					includeAgentSkills: false,
				}),
				executionMode: "full-access",
			});

			await fixture.runtime.prompt(created.sessionId, { text: `Observe the ${scenario} model-call frame` });
			observations[backend] = observeRequest(server, 0);
		}
		return observations;
	}

	async function createServer(): Promise<OpenAiResponsesTestServer> {
		const server = await startOpenAiResponsesTestServer(() => ({
			kind: "events",
			events: textResponseEvents("Model-call frame captured"),
		}));
		servers.push(server);
		return server;
	}

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

function observeRequest(server: OpenAiResponsesTestServer, requestIndex: number): ModelCallObservation {
	const request = server.requests[requestIndex];
	if (!request) throw new Error(`Missing Provider request at index ${requestIndex}`);
	return { body: observableProviderBody(request.body) };
}

function observableProviderBody(body: ProviderRequest): Readonly<Record<string, unknown>> {
	const observation: Record<string, unknown> = { ...body };
	delete observation.prompt_cache_key;
	return observation;
}

function assertCanonicalModelCallFrame(observation: ModelCallObservation): void {
	expect(observation.body.model).toBe(MODEL.id);
	expect(Array.isArray(observation.body.input)).toBe(true);
	expect(Array.isArray(observation.body.tools)).toBe(true);
}

function sharedProviderBody(body: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	const shared = { ...body };
	delete shared.tools;
	shared.input = normalizeModelVisibleValue(shared.input);
	return shared;
}

function normalizeModelVisibleValue(value: unknown): unknown {
	if (typeof value === "string") return normalizeSystemPrompt(value);
	if (Array.isArray(value)) return value.map(normalizeModelVisibleValue);
	if (!isRecord(value)) return value;
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeModelVisibleValue(entry)]));
}

function normalizeSystemPrompt(value: string): string {
	// 系统提示词已不再复述工具清单（工具面板只由 params.tools 承载），因此这里不需要抹平工具段落。
	return value
		.replace(
			/<available_skills>[\s\S]*?<\/available_skills>/g,
			"<available_skills>\n<skill-surface>\n</available_skills>",
		)
		.replace(/^Current date: .*$/gm, "Current date: <turn-date>");
}

function toolNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((tool) => {
		if (!isRecord(tool) || typeof tool.name !== "string") return [];
		return [tool.name];
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function collectStringValues(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(collectStringValues);
	if (!isRecord(value)) return [];
	return Object.values(value).flatMap(collectStringValues);
}

interface SkillFrameObservation {
	readonly hasVersionOne: boolean;
	readonly hasVersionTwo: boolean;
}

function observeSkillFrame(body: ProviderRequest): SkillFrameObservation {
	const modelVisibleText = collectStringValues(body.input).join("\n");
	return {
		hasVersionOne: modelVisibleText.includes(PHASE_112_SKILL_V1),
		hasVersionTwo: modelVisibleText.includes(PHASE_112_SKILL_V2),
	};
}

function skillDocument(description: string): string {
	return `---
name: phase-112-dynamic-skill
description: ${description}
---

Use this skill only for the Phase 112 runtime-boundary test.
`;
}

function pluginConfiguration(): AgentPluginRuntimeConfig {
	return {
		systemPromptProviderContributions: [
			{
				pluginId: "model-call-frame",
				id: "model-call-frame-prompt",
				handlerId: "model-call-frame-prompt-handler",
				context: { conversation: "messages", systemPrompt: "rendered" },
			},
		],
		toolContributions: [
			{
				pluginId: "model-call-frame",
				id: "model-call-frame-tool",
				name: "plugin_model_call_frame",
				description: "Observe the plugin tool frame",
				parameters: { type: "object", properties: {}, additionalProperties: false },
				handlerId: "model-call-frame-tool-handler",
				scope_use: ["conversation"],
			},
		],
	};
}

function createRuntimeFixture(
	_backend: RuntimeBackend,
	_agentStateDir: string,
	model: Model<Api>,
	pluginRuntime?: CodingAgentPluginRuntimeSource,
): RuntimeFixture {
	const pool = new DesktopRuntimeBackendPool({
		compositionDefaults: {
			modelRegistry: modelRegistry(model),
			initialModel: model,
			initialThinkingLevel: "off",
			sessionExtensionFunctions: createDesktopCodingAgentFunctionSource({ logger: TEST_FUNCTION_LOGGER }),
			createPromptRuntimeSources: createDesktopPromptRuntimeSources,
			resolveModePrompt: getModePrompt,
			createPluginRuntime: pluginRuntime ? () => pluginRuntime : undefined,
			createPluginMcpRuntime: ({ cwd, agentDir }) =>
				createCodingAgentPluginMcpRuntime({
					supervisor: createDesktopMcpSupervisor({
						projectRoot: cwd,
						agentDir: agentDir ?? getAgentDir(),
						debug: false,
						dynamicOnly: true,
					}),
				}),
		},
		// Legacy MCP resolves its global config from getAgentDir(), even when the
		// session uses an isolated agentDir. Mirror that compatibility behavior.
		createMcpRuntimeSource: ({ cwd }) =>
			createCodingAgentMcpRuntimeToolSource({
				supervisor: createDesktopMcpSupervisor({
					projectRoot: cwd,
					agentDir: getAgentDir(),
					debug: false,
				}),
			}),
	});
	const runtime = new RuntimeHost({
		sessionBackend: pool,
		getDefaultExecutionMode: () => "full-access",
	});
	return {
		runtime,
		dispose: async () => {
			try {
				await runtime.disposeAllSessions();
			} finally {
				await pool.dispose();
			}
		},
	};
}

function createMutablePluginRuntimeSource(initial: AgentPluginRuntimeConfig | undefined): {
	readonly source: CodingAgentPluginRuntimeSource;
	publish(config: AgentPluginRuntimeConfig | undefined): void;
} {
	let current = initial;
	const listeners = new Set<() => void>();
	const source: CodingAgentPluginRuntimeSource = {
		readAgentPlugins: () => current,
		invokeTool: async () => ({ value: { text: "unused" }, effects: [] }),
		invokeSystemPrompt: async () => [
			{
				type: "addBlock",
				block: {
					id: "plugin.model-call-frame",
					type: "plugin",
					source: { kind: "plugin" },
					content: "Model-call frame plugin instruction",
					priority: 700,
					enabled: true,
				},
			},
		],
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		source,
		publish(config) {
			current = config;
			for (const listener of listeners) listener();
		},
	};
}

function modelRegistry(model: Model<Api>): CodingAgentRuntimeModelSource {
	return {
		refresh() {},
		getAvailable: () => [model],
		find: (provider, modelId) => (provider === model.provider && modelId === model.id ? model : undefined),
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}

const RUNTIME_BACKENDS = ["runtime"] as const;
const PHASE_112_SKILL_V1 = "Phase 112 dynamic skill version one";
const PHASE_112_SKILL_V2 = "Phase 112 dynamic skill version two with changed instructions";

const MODEL: Model<Api> = {
	id: "desktop-model-call-frame",
	name: "Desktop Model Call Frame",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
