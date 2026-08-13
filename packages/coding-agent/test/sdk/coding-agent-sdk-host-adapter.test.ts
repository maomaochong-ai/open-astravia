import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { Api, Model, UserMessage } from "@vetta/ai";
import type { RuntimeTracer } from "@vetta/runtime-telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../../src/auth/index.js";
import { createCodingAgentSessionFromPublicOptions } from "../../src/host/sdk-session/index.js";
import { type CodingAgentModelRuntime, createCodingAgentModelRuntime } from "../../src/models/index.js";
import type {
	CodingAgentSession,
	CodingAgentSessionToolDefinition,
	CreateCodingAgentSessionOptions,
} from "../../src/public-api/sdk/index.js";
import {
	CODING_AGENT_SESSION_CREATE_ERROR_CODES,
	CodingAgentSessionCreateError,
} from "../../src/public-api/sdk/index.js";
import { SettingsRuntime } from "../../src/settings/index.js";

describe("Coding Agent SDK Host Adapter", () => {
	const temporaryDirectories: string[] = [];
	const sessions: CodingAgentSession[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(
			temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("wires scoped models into initial selection and fixed-session cycling", async () => {
		const resources = await createResources("sdk-host-scoped-");
		registerTestModel(resources.modelRegistry);
		const result = await createSession(resources, {
			scopedModels: [
				{ model: OTHER_MODEL, thinkingLevel: "high" },
				{ model: MODEL, thinkingLevel: "low" },
			],
		});
		sessions.push(result.session);

		expect(result.session.model).toMatchObject({ id: OTHER_MODEL.id });
		expect(result.session.scopedModels).toHaveLength(2);
		await expect(result.session.cycleModel()).resolves.toMatchObject({
			model: { id: MODEL.id },
			thinkingLevel: "low",
			isScoped: true,
		});
	});

	it("keeps default file storage inside the configured agent directory", async () => {
		const resources = await createResources("sdk-host-agent-dir-");
		const result = await createSession(resources, { model: MODEL });
		sessions.push(result.session);

		expect(result.session.sessionFile).toBeTruthy();
		expect(result.session.sessionFile?.startsWith(join(resources.agentDir, "sessions"))).toBe(true);
	});

	it("preserves explicit built-in tool activation, including an empty tool list", async () => {
		const emptyResources = await createResources("sdk-host-no-tools-");
		const emptyResult = await createSession(emptyResources, {
			model: MODEL,
			activeTools: [],
		});
		sessions.push(emptyResult.session);
		expect(emptyResult.session.getActiveToolNames()).toEqual([]);

		const subsetResources = await createResources("sdk-host-tool-subset-");
		const subsetResult = await createSession(subsetResources, {
			model: MODEL,
			activeTools: ["read"],
		});
		sessions.push(subsetResult.session);
		expect(subsetResult.session.getActiveToolNames()).toEqual(["read"]);
	});

	it("registers, replaces and removes Session-private SDK custom tools", async () => {
		const resources = await createResources("sdk-host-custom-tools-");
		const result = await createSession(resources, {
			model: MODEL,
			customTools: [customTool("before")],
		});
		sessions.push(result.session);

		expect(result.session.getAllTools().find(({ name }) => name === "sdk_echo")?.description).toBe("before");
		expect(result.session.getActiveToolNames()).toContain("sdk_echo");

		result.session.reconfigureCustomTools([customTool("after")]);
		expect(result.session.getAllTools().find(({ name }) => name === "sdk_echo")?.description).toBe("after");

		result.session.reconfigureCustomTools(undefined);
		expect(result.session.getAllTools().some(({ name }) => name === "sdk_echo")).toBe(false);
		expect(result.session.getActiveToolNames()).not.toContain("sdk_echo");
	});

	it("keeps SDK custom tools inactive when the caller supplied an explicit built-in tool list", async () => {
		const resources = await createResources("sdk-host-explicit-custom-tools-");
		const result = await createSession(resources, {
			model: MODEL,
			activeTools: [],
			customTools: [customTool("inactive")],
		});
		sessions.push(result.session);

		expect(result.session.getAllTools().some(({ name }) => name === "sdk_echo")).toBe(true);
		expect(result.session.getActiveToolNames()).not.toContain("sdk_echo");
	});

	it("accepts tracing options without taking ownership of the injected tracer", async () => {
		const resources = await createResources("sdk-host-tracing-");
		const shutdown = vi.fn(async () => {});
		const tracer: RuntimeTracer = {
			startObservation() {
				throw new Error("Session creation must not start a Turn observation");
			},
			shutdown,
		};
		const result = await createSession(resources, {
			model: MODEL,
			tracer,
			tracingTraceName: "sdk-trace",
			tracingMetadata: { tenant: "test" },
		});
		sessions.push(result.session);

		await result.session.close();
		expect(shutdown).not.toHaveBeenCalled();
	});

	it("keeps subagents fail-closed when enableSubagents is omitted", async () => {
		const resources = await createResources("sdk-host-subagents-default-");
		const result = await createSession(resources, {
			enableSubagents: undefined,
			model: MODEL,
		});
		sessions.push(result.session);

		expect(result.session.getActiveToolNames()).not.toContain("spawn_agent");
		expect(result.session.listSubagents()).toEqual([]);
		expect(result.session.clearFinishedSubagents()).toBe(0);
	});

	it("maps an unavailable initial model to the stable public SDK error", async () => {
		const resources = await createResources("sdk-host-no-model-");
		vi.spyOn(resources.modelRegistry, "getAvailable").mockReturnValue([]);
		let creationError: unknown;

		try {
			await createSession(resources, {});
		} catch (error) {
			creationError = error;
		}

		expect(creationError).toBeInstanceOf(CodingAgentSessionCreateError);
		if (!(creationError instanceof CodingAgentSessionCreateError)) return;
		expect(creationError.code).toBe(CODING_AGENT_SESSION_CREATE_ERROR_CODES.NO_MODEL);
	});

	it("serves product behavior through narrow SDK capabilities", async () => {
		const resources = await createResources("sdk-host-product-capabilities-");
		registerTestModel(resources.modelRegistry);
		const memoryFile = join(resources.cwd, "MEMORY.md");
		const result = await createSession(resources, {
			model: MODEL,
			memoryMode: true,
			memoryFile,
		});
		sessions.push(result.session);

		expect(await result.session.listAvailableModels()).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: MODEL.id })]),
		);
		expect(result.session.getSystemPrompt()).not.toBe("");
		expect(result.session.getPromptTemplates()).toEqual([]);
		expect(result.session.listBackgroundTasks()).toEqual([]);
		expect(result.session.getTodos()).toEqual([]);
		expect(result.session.getMemoryConfiguration()).toEqual({ enabled: true, file: memoryFile, charLimit: 4_000 });
		await expect(result.session.flushMemory()).resolves.toBe(0);
		await expect(result.session.reconfigureAgentPlugins(undefined)).resolves.toBeUndefined();
		await expect(result.session.reloadMcp()).resolves.toBeUndefined();
		await expect(result.session.reload()).resolves.toBeUndefined();
		expect(result.session.hasExtensionHandlers("before_agent_start")).toBe(false);

		await result.session.recordBashResult("echo recorded", {
			output: "recorded",
			exitCode: 0,
			cancelled: false,
			truncated: false,
		});
		expect(result.session.getSessionBranch()).toContainEqual(
			expect.objectContaining({
				type: "message",
				message: expect.objectContaining({ role: "bashExecution", command: "echo recorded" }),
			}),
		);
		const outputPath = join(resources.cwd, "session.html");
		await expect(result.session.exportToHtml(outputPath)).resolves.toBe(outputPath);
		expect(await readFile(outputPath, "utf8")).toContain("<!DOCTYPE html>");
		for (const concrete of ["modelRegistry", "backgroundTasks", "todoStore", "resourceLoader", "extensionRunner"]) {
			expect(Reflect.has(result.session, concrete)).toBe(false);
		}
	});

	it("preserves SDK context and Extension bindings across active Session transitions", async () => {
		const resources = await createResources("sdk-host-active-session-");
		const result = await createSession(resources, {
			model: MODEL,
		});
		sessions.push(result.session);
		const stableFacade = result.session;
		const initialPath = result.session.sessionFile;
		if (!initialPath) throw new Error("Expected a persisted SDK session");

		await result.session.sendCustomMessage({
			customType: "sdk-context",
			content: "host context",
			display: true,
		});
		const customEntry = result.session.getSessionBranch().find(({ type }) => type === "custom_message");
		if (!customEntry) throw new Error("Expected a custom context entry for active Session operations");
		await result.session.sendCustomMessage({
			customType: "sdk-context",
			content: "later context",
			display: true,
		});

		await expect(
			result.session.newSession({
				setup: async (sessionSetup) => {
					sessionSetup.appendMessage(userMessage("seeded setup"));
				},
			}),
		).resolves.toBe(true);
		expect(result.session).toBe(stableFacade);
		expect(result.session.messages).toEqual([expect.objectContaining({ role: "user" })]);
		await expect(result.session.switchSession(initialPath)).resolves.toBe(true);
		expect(result.session).toBe(stableFacade);
		expect(result.session.getSessionBranch()).toContainEqual(expect.objectContaining({ id: customEntry.id }));

		await expect(result.session.navigateTree(customEntry.id)).resolves.toMatchObject({
			cancelled: false,
			editorText: "host context",
		});
		result.session.abortBranchSummary();
	});

	async function createResources(prefix: string) {
		const cwd = await temporaryDirectory(`${prefix}cwd-`);
		const agentDir = await temporaryDirectory(`${prefix}agent-`);
		const authStorage = AuthStorage.inMemory();
		const modelRegistry = createCodingAgentModelRuntime(authStorage);
		const settingsManager = SettingsRuntime.create(cwd, agentDir);
		return {
			cwd,
			agentDir,
			modelRegistry,
			settingsManager,
			authStorage,
		};
	}

	function createSession(
		resources: Awaited<ReturnType<typeof createResources>>,
		options: CreateCodingAgentSessionOptions,
	) {
		return createCodingAgentSessionFromPublicOptions(
			{
				cwd: resources.cwd,
				agentDir: resources.agentDir,
				enableMcp: false,
				enableSubagents: false,
				includeAgentSkills: false,
				...options,
			},
			{
				authStorage: resources.authStorage,
				modelRegistry: resources.modelRegistry,
				settingsManager: resources.settingsManager,
			},
		);
	}

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		temporaryDirectories.push(directory);
		return directory;
	}
});

function registerTestModel(modelRegistry: CodingAgentModelRuntime): void {
	modelRegistry.registerProvider(MODEL.provider, {
		baseUrl: MODEL.baseUrl,
		apiKey: "sdk-test-key",
		api: MODEL.api,
		models: [
			{
				id: MODEL.id,
				name: MODEL.name,
				reasoning: MODEL.reasoning,
				input: [...MODEL.input],
				cost: MODEL.cost,
				contextWindow: MODEL.contextWindow,
				maxTokens: MODEL.maxTokens,
			},
			{
				id: OTHER_MODEL.id,
				name: OTHER_MODEL.name,
				reasoning: OTHER_MODEL.reasoning,
				input: [...OTHER_MODEL.input],
				cost: OTHER_MODEL.cost,
				contextWindow: OTHER_MODEL.contextWindow,
				maxTokens: OTHER_MODEL.maxTokens,
			},
		],
	});
}

function customTool(description: string): CodingAgentSessionToolDefinition {
	return {
		name: "sdk_echo",
		label: "SDK Echo",
		description,
		parameters: Type.Object({ value: Type.String() }),
		async execute(_toolCallId, params) {
			if (typeof params !== "object" || params === null || typeof Reflect.get(params, "value") !== "string") {
				throw new Error("Expected SDK echo input");
			}
			return { content: [{ type: "text", text: Reflect.get(params, "value") }], details: undefined };
		},
	};
}

function userMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 1 };
}

const MODEL: Model<Api> = {
	id: "sdk-host-model",
	name: "SDK Host Model",
	api: "openai-responses",
	provider: "sdk-host-provider",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

const OTHER_MODEL: Model<Api> = {
	...MODEL,
	id: "sdk-host-model-other",
	name: "SDK Host Model Other",
};
