import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CodingAgentSdkResourceSourceAdapter,
	projectCodingAgentSkillInfo,
} from "../../src/host/coding-agent-sdk-resource-source-adapter.js";
import { CodingAgentSdkSessionCapabilityHost } from "../../src/host/sdk-session/session-capability-host.js";
import {
	type CodingAgentExtensionSourceSnapshot,
	type CodingAgentSkillSourceSnapshot,
	createCodingAgentSession,
} from "../../src/public-api/sdk.js";
import { readSkillContent } from "../../src/resources/skills/index.js";

describe("Coding Agent SDK dynamic resources", () => {
	const temporaryDirectories: string[] = [];
	const sessions: Array<{ close(): Promise<void> }> = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(
			temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("adapts inline Skill content and declarative policy without a resource loader callback", async () => {
		let snapshot: CodingAgentSkillSourceSnapshot = {
			revision: 1,
			skills: [skill("dynamic-browser", "Dynamic instructions")],
			policy: { include: { nameContains: ["browser"] } },
		};
		let invalidate: (() => void) | undefined;
		const adapter = await CodingAgentSdkResourceSourceAdapter.create({
			cwd: "C:\\workspace",
			resources: { skills: [skill("ignored-static", "Ignored")] },
			skillSources: [
				{
					id: "dynamic",
					read: () => snapshot,
					subscribe: (listener) => {
						invalidate = listener;
						return () => {
							invalidate = undefined;
						};
					},
				},
			],
		});

		const initial = adapter.transformSkills({ skills: [], diagnostics: [] }).skills;
		expect(initial.map(projectCodingAgentSkillInfo)).toEqual([
			expect.objectContaining({ name: "dynamic-browser", source: "sdk:dynamic", type: "skill" }),
		]);
		expect(readSkillContent(initial[0]!)).toBe("Dynamic instructions");

		snapshot = {
			revision: 2,
			skills: [skill("dynamic-search", "Updated instructions")],
			policy: { include: { nameContains: ["search"] } },
		};
		invalidate?.();
		await expect(adapter.refreshInvalidated()).resolves.toEqual({
			skillsChanged: true,
			extensionsChanged: false,
		});
		expect(adapter.transformSkills({ skills: [], diagnostics: [] }).skills.map(({ name }) => name)).toEqual([
			"dynamic-search",
		]);
		await adapter.dispose();
	});

	it("keeps invalidated Skill and Extension sources stable until an explicit refresh boundary", async () => {
		const cwd = await temporaryDirectory("sdk-dynamic-resources-cwd-");
		const agentDir = await temporaryDirectory("sdk-dynamic-resources-agent-");
		const firstExtension = join(cwd, "first-extension.ts");
		const secondExtension = join(cwd, "second-extension.ts");
		await writeFile(
			firstExtension,
			'export default function (api) { api.on("agent_start", async () => {}); }',
			"utf8",
		);
		await writeFile(
			secondExtension,
			'export default function (api) { api.on("agent_end", async () => {}); }',
			"utf8",
		);

		let skillSnapshot: CodingAgentSkillSourceSnapshot = {
			revision: "skill-1",
			skills: [skill("first-skill", "First")],
		};
		let extensionSnapshot: CodingAgentExtensionSourceSnapshot = {
			revision: "extension-1",
			paths: [firstExtension],
		};
		let invalidateSkill: (() => void) | undefined;
		let invalidateExtension: (() => void) | undefined;
		const unsubscribeSkill = vi.fn();
		const unsubscribeExtension = vi.fn();
		const disposeSkill = vi.fn(async () => {});
		const disposeExtension = vi.fn(async () => {});

		const result = await createCodingAgentSession({
			cwd,
			agentDir,
			storage: { kind: "memory", sessionId: "dynamic-resources" },
			model: MODEL,
			activeTools: [],
			enableMcp: false,
			enableSubagents: false,
			includeAgentSkills: false,
			skillSources: [
				{
					id: "skills",
					read: () => skillSnapshot,
					subscribe: (listener) => {
						invalidateSkill = listener;
						return unsubscribeSkill;
					},
					dispose: disposeSkill,
				},
			],
			extensionSources: [
				{
					id: "extensions",
					read: () => extensionSnapshot,
					subscribe: (listener) => {
						invalidateExtension = listener;
						return unsubscribeExtension;
					},
					dispose: disposeExtension,
				},
			],
		});
		sessions.push(result.session);

		expect(result.session.getSkills().map(({ name }) => name)).toContain("first-skill");
		expect(result.session.hasExtensionHandlers("agent_start")).toBe(true);
		expect(result.session.hasExtensionHandlers("agent_end")).toBe(false);

		skillSnapshot = { revision: "skill-2", skills: [skill("second-skill", "Second")] };
		extensionSnapshot = { revision: "extension-2", paths: [secondExtension] };
		invalidateSkill?.();
		invalidateExtension?.();

		expect(result.session.getSkills().map(({ name }) => name)).toContain("first-skill");
		expect(result.session.hasExtensionHandlers("agent_start")).toBe(true);

		await result.session.reload();
		expect(result.session.getSkills().map(({ name }) => name)).toContain("second-skill");
		expect(result.session.getSkills().map(({ name }) => name)).not.toContain("first-skill");
		expect(result.session.hasExtensionHandlers("agent_start")).toBe(false);
		expect(result.session.hasExtensionHandlers("agent_end")).toBe(true);

		await result.session.close();
		expect(unsubscribeSkill).toHaveBeenCalledOnce();
		expect(unsubscribeExtension).toHaveBeenCalledOnce();
		expect(disposeSkill).toHaveBeenCalledOnce();
		expect(disposeExtension).toHaveBeenCalledOnce();
	});

	it("refreshes invalidated sources only before a new Turn, not while queueing input", async () => {
		const beforePrompt = vi.fn(async () => {});
		const prompt = vi.fn(async () => ({ status: "completed" as const }));
		const host = new CodingAgentSdkSessionCapabilityHost({
			readSession: () => ({ prompt }) as unknown as GreenfieldRuntimeSession,
			beforePrompt,
		});

		await host.prompt({ text: "new turn" });
		await host.prompt({ text: "queued", streamingBehavior: "steer" });

		expect(beforePrompt).toHaveBeenCalledOnce();
		expect(prompt).toHaveBeenCalledTimes(2);
	});

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		temporaryDirectories.push(directory);
		return directory;
	}
});

function skill(name: string, content: string) {
	return { name, description: `${name} description`, content };
}

const MODEL: Model<Api> = {
	id: "dynamic-resource-model",
	name: "Dynamic Resource Model",
	api: "openai-responses",
	provider: "dynamic-resource-provider",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
