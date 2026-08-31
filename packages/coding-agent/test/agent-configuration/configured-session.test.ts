import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import { RuntimeAgentRuntime } from "@vetta/runtime-core";
import type { RuntimeSnapshotLease, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { resolveModelCallFrame } from "@vetta/runtime-core/kernel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AGENT_CONFIGURATION_READ,
	AGENT_CONFIGURATION_UPDATE,
} from "../../src/agent-configuration/session-configuration-contract.js";
import { publishCodingAgentExecutionRuntimeDefinition } from "../../src/composition/index.js";
import type { Skill } from "../../src/resources/skills/index.js";
import type { CodingAgentPromptResourceSource } from "../../src/runtime-contracts/prompt-runtime.js";
import { createCodingAgentRuntimeComposition } from "../fixtures/conversation-persistence.js";
import { createFileSettingsRuntime } from "../fixtures/file-settings-runtime.js";

describe("configured conversation execution contract", () => {
	let directory: string;
	let runtime: RuntimeAgentRuntime;
	let composition: Awaited<ReturnType<typeof createCodingAgentRuntimeComposition>>;
	const leases: RuntimeSnapshotLease[] = [];
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "configured-agent-"));
		await writeFile(join(directory, ".git"), "");
		runtime = new RuntimeAgentRuntime();
		publishCodingAgentExecutionRuntimeDefinition(runtime);
		const skills = [skill("alpha"), skill("beta")];
		const resourceSource: CodingAgentPromptResourceSource = {
			getSkills: () => ({ skills, diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => undefined,
			getAppendSystemPrompt: () => [],
			refreshSkillsIfChanged: async () => false,
			refreshContextResourcesIfChanged: async () => false,
			setRuntimeSkillPaths: async () => {},
		};
		composition = await createCodingAgentRuntimeComposition({
			cwd: directory,
			agentDir: join(directory, "agent"),
			conversationDir: join(directory, "conversations"),
			hookConfigLayers: [],
			enableSubagents: false,
			agentRuntime: { runtime },
			initialModel: MODEL,
			initialThinkingLevel: "off",
			activation: { mode: "explicit", toolNames: ["read", "write", "invoke_skill"] },
			modelRegistry: {
				refresh() {},
				getAvailable: () => [MODEL, { ...MODEL, id: "second" }],
				find: (_provider, id) => (id === "second" ? { ...MODEL, id } : MODEL),
				getApiKey: async () => "test-key",
				setServerToken() {},
				loadRemoteModels: async () => undefined,
			},
			resolveSystemPromptOptions: () => ({ customPrompt: "host base", skills }),
			createPromptRuntimeSources: async () => ({
				resourceSource,
				settingsSource: createFileSettingsRuntime(directory, join(directory, "agent")),
			}),
			mcpSource: {
				refresh: async () => ({
					tools: [
						{ tool: tool("mcp-one"), fingerprint: "one", serverName: "one" },
						{ tool: tool("mcp-two"), fingerprint: "two", serverName: "two" },
					],
				}),
			},
		});
	});
	afterEach(async () => {
		for (const lease of leases.splice(0)) await lease.release();
		await composition?.dispose();
		await runtime?.close();
		if (directory) await rm(directory, { recursive: true, force: true });
	});

	it("keeps old Turn Prompt, tools, Skills and model while the next Turn atomically adopts the session override", async () => {
		const session = await composition.createSession({ sessionId: "session", includeAgentSkills: false });
		const old = await acquire("old");
		await session.invokeExtension(AGENT_CONFIGURATION_UPDATE, {
			expectedRevision: 0,
			selection: {
				template: null,
				overrides: {
					appendSystemPrompt: "new instructions",
					tools: ["read", "invoke_skill"],
					skills: ["alpha"],
					mcpServers: [],
					modelKey: "test/second",
				},
			},
		});
		expect(await session.invokeExtension(AGENT_CONFIGURATION_READ, undefined)).toMatchObject({
			effectiveRevision: 0,
			pending: true,
		});
		const next = await acquire("next");
		const oldFrame = await frame(old, "old");
		const nextFrame = await frame(next, "next");
		expect(oldFrame.instructions.map(({ content }) => content).join("\n")).not.toContain("new instructions");
		expect(nextFrame.instructions.map(({ content }) => content).join("\n")).toContain("new instructions");
		expect(oldFrame.tools.has("write")).toBe(true);
		expect(nextFrame.tools.has("write")).toBe(false);
		expect(nextFrame.tools.has("read")).toBe(true);
		expect(old.modelBinding?.model.id).toBe("first");
		expect(next.modelBinding?.model.id).toBe("second");
		const invoke = nextFrame.tools.get("invoke_skill");
		expect(invoke).toBeDefined();
		const denied = await invoke!.execute({
			sessionId: "session",
			turnId: "next",
			toolCallId: "denied",
			input: { name: "beta" },
			signal: new AbortController().signal,
		});
		expect(JSON.stringify(denied)).not.toContain("beta-body");
		expect(await session.invokeExtension(AGENT_CONFIGURATION_READ, undefined)).toMatchObject({
			effectiveRevision: 1,
			pending: false,
		});
	});

	it("restores the saved configuration with a fresh instance and blocks unavailable resources before execution", async () => {
		const session = await composition.createSession({ sessionId: "session" });
		const identity = composition.readSessionAgentIdentity("session");
		await session.invokeExtension(AGENT_CONFIGURATION_UPDATE, {
			expectedRevision: 0,
			selection: { template: null, overrides: { tools: [] } },
		});
		await session.dispose();
		const resumed = await composition.resumeSession({ sessionId: "session" });
		expect(composition.readSessionAgentIdentity("session")?.instanceId).not.toBe(identity?.instanceId);
		expect((await frame(await acquire("resumed"), "resumed")).tools.size).toBe(0);
		await resumed.invokeExtension(AGENT_CONFIGURATION_UPDATE, {
			expectedRevision: 1,
			selection: { template: null, overrides: { skills: ["not-installed"] } },
		});
		await expect(acquire("invalid")).rejects.toThrow("AGENT_CONFIGURATION_RESOURCE_UNAVAILABLE");
		expect(await resumed.invokeExtension(AGENT_CONFIGURATION_READ, undefined)).toMatchObject({
			effectiveRevision: 1,
			pending: true,
			failure: { revision: 2 },
		});
	});

	it("keeps the explicit request model above the configured model", async () => {
		await composition.createSession({
			sessionId: "session",
			agentConfiguration: {
				template: null,
				overrides: { modelKey: "test/second" },
			},
		});
		const lease = await runtime.requireSession("session").acquire({
			sessionId: "session",
			operationId: "explicit",
			reason: "turn",
			signal: new AbortController().signal,
			request: { payload: { text: "hello" }, displayText: "hello", model: { key: "test/first" } },
		});
		leases.push(lease);
		expect(lease.modelBinding?.model.id).toBe("first");
	});

	it("rejects a disabled explicit Skill reference using the bound request preparer", async () => {
		await composition.createSession({
			sessionId: "session",
			agentConfiguration: { template: null, overrides: { skills: [] } },
		});
		const lease = await acquire("restricted");
		await expect(
			lease.snapshot.inputRequestPreparer!.prepare(
				{ payload: { text: "hello", promptRef: { kind: "skill", name: "beta" } }, displayText: "hello" },
				{ sessionId: "session", turnId: "restricted", queueing: false, signal: new AbortController().signal },
			),
		).rejects.toThrow("AGENT_CONFIGURATION_RESOURCE_UNAVAILABLE");
	});

	async function acquire(operationId: string) {
		const lease = await runtime
			.requireSession("session")
			.acquire({ sessionId: "session", operationId, reason: "turn", signal: new AbortController().signal });
		leases.push(lease);
		return lease;
	}
});

function frame(lease: RuntimeSnapshotLease, turnId: string) {
	return resolveModelCallFrame(lease.snapshot, {
		sessionId: "session",
		turnId,
		signal: new AbortController().signal,
		modelBinding: lease.modelBinding,
	});
}
function tool(name: string): RuntimeToolDefinition {
	return { name, label: name, description: name, inputSchema: {}, execute: async () => ({ content: [] }) };
}
function skill(name: string): Skill {
	return {
		name,
		description: name,
		filePath: `/virtual/${name}/SKILL.md`,
		baseDir: `/virtual/${name}`,
		source: "test",
		type: "skill",
		disableModelInvocation: false,
		content: `---\nname: ${name}\ndescription: ${name}\n---\n${name}-body`,
		sceneTasks: [],
	};
}
const MODEL: Model<Api> = {
	id: "first",
	name: "First",
	provider: "test",
	api: "openai-responses",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8000,
	maxTokens: 1000,
};
