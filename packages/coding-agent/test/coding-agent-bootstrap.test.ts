import type { Model } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/auth/index.js";
import { createCodingAgentBootstrap, resolveCodingAgentInitialModel } from "../src/bootstrap/coding-agent-bootstrap.js";
import { createExtensionRuntime } from "../src/extensions/index.js";
import { createCodingAgentModelRuntime } from "../src/models/index.js";
import type { SessionResourceRuntime } from "../src/resources/index.js";
import { createInMemorySettingsRuntime } from "../src/settings/index.js";

const plainModel: Model<"openai-responses"> = {
	id: "plain-model",
	name: "Plain Model",
	provider: "test",
	api: "openai-responses",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};

describe("Coding Agent bootstrap", () => {
	it("initializes rules from host-owned state and resource implementations", async () => {
		const settingsManager = createInMemorySettingsRuntime();
		const authStorage = AuthStorage.inMemory();
		const modelRegistry = createCodingAgentModelRuntime(authStorage, {
			modelsJsonPath: "unused",
			configFileSource: { exists: () => false, read: () => "" },
			builtInModels: [plainModel],
		});
		const resourceLoader = emptyResourceRuntime();
		const createResourceRuntime = vi.fn(() => resourceLoader);

		const bootstrap = await createCodingAgentBootstrap({
			args: ["--mode", "rpc", "--scenario", "im-claw", "--model", "test/plain-model", "--thinking", "xhigh"],
			cwd: "/workspace",
			agentDir: "/state",
			settingsManager,
			authStorage,
			modelRegistry,
			createResourceRuntime,
		});
		const initial = await resolveCodingAgentInitialModel(bootstrap);

		expect(createResourceRuntime).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: "/workspace", agentDir: "/state", settings: settingsManager }),
		);
		expect(bootstrap).toMatchObject({
			cwd: "/workspace",
			agentDir: "/state",
			parsed: {
				mode: "rpc",
				scenario: "im-claw",
				model: "test/plain-model",
				thinking: "xhigh",
			},
		});
		expect(resourceLoader.reload).toHaveBeenCalledOnce();
		expect(bootstrap.extensionRequirements).toEqual({
			extensionCount: 0,
			bootstrapContributions: { providers: [], flags: [] },
			registrations: [],
			requiredRuntimeCapabilities: [],
		});
		expect(initial).toMatchObject({
			model: { provider: "test", id: "plain-model" },
			thinkingLevel: "off",
			error: undefined,
		});
	});
});

function emptyResourceRuntime(): SessionResourceRuntime {
	const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	return {
		getExtensions: () => extensions,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		getPathMetadata: () => new Map(),
		extendResources: async () => undefined,
		setAdditionalSkillPaths: async () => undefined,
		setRuntimeSkillPaths: async () => undefined,
		setAdditionalExtensionPaths: () => undefined,
		reloadSkills: async () => undefined,
		reload: vi.fn(async () => undefined),
		refreshSkillsIfChanged: async () => false,
		refreshContextResourcesIfChanged: async () => false,
	};
}
