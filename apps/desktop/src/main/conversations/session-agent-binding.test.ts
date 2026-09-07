import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProfile, AgentTeamDocument } from "@vetta/agent-team";
import { afterEach, describe, expect, it } from "vitest";
import {
	readSessionAgentBinding,
	recordSessionAgentBinding,
	resolveAgentBindingStorePath,
} from "./session-agent-binding-store.js";
import { resolveSessionAgentProfile } from "./session-agent-profile.js";

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-agent-binding-"));
	temporaryRoots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
	return {
		id: "agent-1",
		revision: 1,
		name: "Reviewer",
		description: "reviews code",
		mentionHandle: "reviewer",
		blueprintId: "blueprint-1",
		systemPrompt: "You review code.",
		abilities: { selectionMode: "custom", skills: ["review"], mcpServers: ["docs"], plugins: [] },
		scope: { kind: "library" },
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function createDocument(agents: readonly AgentProfile[]): AgentTeamDocument {
	return { schemaVersion: 1, revision: 1, agents, teams: [] } as AgentTeamDocument;
}

describe("session agent binding store", () => {
	it("keeps the binding beside the session file and reads it back", async () => {
		const root = await createTemporaryRoot();
		const sessionPath = join(root, "session-a.jsonl");
		await recordSessionAgentBinding(sessionPath, "agent-1");
		expect(resolveAgentBindingStorePath(sessionPath)).toBe(join(root, "agent-bindings.json"));
		expect(await readSessionAgentBinding(sessionPath)).toBe("agent-1");
	});

	it("never rewrites an existing binding", async () => {
		const root = await createTemporaryRoot();
		const sessionPath = join(root, "session-a.jsonl");
		await recordSessionAgentBinding(sessionPath, "agent-1");
		await recordSessionAgentBinding(sessionPath, "agent-2");
		// 会话属于哪个 Agent 是会话身份，中途不可改；想换只能新建会话。
		expect(await readSessionAgentBinding(sessionPath)).toBe("agent-1");
	});

	it("isolates sessions sharing one directory and reports unbound ones as undefined", async () => {
		const root = await createTemporaryRoot();
		await recordSessionAgentBinding(join(root, "session-a.jsonl"), "agent-1");
		expect(await readSessionAgentBinding(join(root, "session-b.jsonl"))).toBeUndefined();
	});

	it("treats a missing store as no binding", async () => {
		const root = await createTemporaryRoot();
		expect(await readSessionAgentBinding(join(root, "session-a.jsonl"))).toBeUndefined();
	});
});

describe("session agent profile resolution", () => {
	it("turns a custom ability selection into a configuration override and a prompt addon", async () => {
		const resolved = await resolveSessionAgentProfile({
			agentProfileId: "agent-1",
			readDocument: async () => createDocument([createProfile()]),
		});
		expect(resolved?.agentProfileId).toBe("agent-1");
		expect(resolved?.systemPromptVolatileAddon).toBe("You review code.");
		expect(resolved?.agentConfiguration).toEqual({
			template: null,
			overrides: { skills: ["review"], mcpServers: ["docs"], plugins: [] },
		});
	});

	it("leaves the override empty for `all`, so capabilities installed later stay inherited", async () => {
		const resolved = await resolveSessionAgentProfile({
			agentProfileId: "agent-1",
			readDocument: async () =>
				createDocument([
					createProfile({ abilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] } }),
				]),
		});
		expect(resolved?.agentConfiguration.overrides).toEqual({});
	});

	it("resolves nothing when the profile is gone", async () => {
		const resolved = await resolveSessionAgentProfile({
			agentProfileId: "deleted",
			readDocument: async () => createDocument([createProfile()]),
		});
		expect(resolved).toBeUndefined();
	});
});
