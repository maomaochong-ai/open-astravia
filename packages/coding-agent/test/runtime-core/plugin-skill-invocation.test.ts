import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import type { AgentPluginRuntimeConfig } from "@vetta/runtime-core";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CodingAgentRuntimeComposition,
	createCodingAgentRuntimeComposition,
} from "../../src/composition/index.js";
import { createCodingAgentSessionResourceRuntime } from "../../src/host/coding-agent-resource-runtime.js";
import type { CodingAgentRuntimeModelSource } from "../../src/public-api/host-services.js";
import { SettingsRuntime } from "../../src/settings/index.js";

const temporaryRoots: string[] = [];
const compositions: CodingAgentRuntimeComposition[] = [];

afterEach(async () => {
	for (const composition of compositions.splice(0).reverse()) await composition.dispose();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("plugin Skill invocation", () => {
	it("keeps plugin Skills invokable across session creation and runtime reconfiguration", async () => {
		const workspace = await temporaryRoot("coding-agent-plugin-skill-workspace-");
		const conversationDir = await temporaryRoot("coding-agent-plugin-skill-conversations-");
		const agentDir = join(workspace, "agent");
		const baseSkill = join(workspace, "base-skill");
		const remotionSkill = join(workspace, "remotion-video");
		const chartSkill = join(workspace, "chart-video");
		await Promise.all([
			writeSkill(baseSkill, "base-skill", "Use the base workflow."),
			writeSkill(remotionSkill, "remotion-video", "Use the Remotion workflow."),
			writeSkill(chartSkill, "chart-video", "Use the chart workflow."),
		]);
		const settings = SettingsRuntime.inMemory();
		const resourceSource = createCodingAgentSessionResourceRuntime({
			cwd: workspace,
			agentDir,
			settings,
			additionalSkillPaths: [baseSkill],
			includeAgentSkills: false,
		});
		await resourceSource.reload();
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			cwd: workspace,
			agentDir,
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			promptResourceSource: resourceSource,
			promptSettingsSource: settings,
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "plugin-skill-session",
			cwd: workspace,
			includeAgentSkills: false,
			agentPlugins: pluginSkills("remotion-renderer", remotionSkill),
		});
		const core = session.createCoreAssembly();
		const invokeSkill = core.toolController?.readAvailableTools().get("invoke_skill");
		if (!invokeSkill) throw new Error("Expected invoke_skill tool");

		expect(await invoke(invokeSkill, "remotion-video")).toContain("Use the Remotion workflow.");
		expect(await invoke(invokeSkill, "base-skill")).toContain("Use the base workflow.");

		const hostAssembly = session.createRuntimeHostAssemblyCandidate();
		await hostAssembly.configurationController?.reconfigureAgentPlugins(pluginSkills("chart-renderer", chartSkill));

		expect(await invoke(invokeSkill, "remotion-video")).toContain('Skill "remotion-video" not found');
		expect(await invoke(invokeSkill, "chart-video")).toContain("Use the chart workflow.");
		expect(await invoke(invokeSkill, "base-skill")).toContain("Use the base workflow.");
		await session.dispose();
	});
});

async function writeSkill(directory: string, name: string, body: string): Promise<void> {
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${name} workflow\n---\n${body}\n`,
		"utf8",
	);
}

function pluginSkills(pluginId: string, path: string): AgentPluginRuntimeConfig {
	return { skillPathContributions: [{ pluginId, paths: [path] }] };
}

async function invoke(tool: RuntimeToolDefinition, name: string): Promise<string> {
	const result = await tool.execute({
		sessionId: "plugin-skill-session",
		turnId: "turn",
		toolCallId: `invoke-${name}`,
		input: { name },
		signal: new AbortController().signal,
	});
	const text = result.content.find((content) => content.type === "text");
	return text?.type === "text" ? text.text : "";
}

async function temporaryRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	temporaryRoots.push(root);
	return root;
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
