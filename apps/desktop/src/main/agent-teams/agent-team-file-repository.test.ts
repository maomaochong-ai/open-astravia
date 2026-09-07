import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_AGENT_BLUEPRINTS, createAgentTeamFixture } from "@vetta/agent-team";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentTeamFileRepository, resolveAgentTeamResourceRoot } from "./agent-team-file-repository.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

async function createRepository(): Promise<{
	readonly repository: ReturnType<typeof createAgentTeamFileRepository>;
	readonly root: string;
}> {
	const root = await mkdtemp(join(tmpdir(), "vetta-agent-teams-"));
	temporaryDirectories.push(root);
	return { repository: createAgentTeamFileRepository({ root }), root };
}

describe("Agent Team file repository", () => {
	it("uses packaged resources only when the app is packaged", () => {
		expect(
			resolveAgentTeamResourceRoot({
				isPackaged: true,
				resourcesPath: "C:/electron/resources",
				moduleDirectory: "C:/app/dist/main",
				currentWorkingDirectory: "C:/app",
			}),
		).toBe(join("C:/electron/resources", "agent-teams"));

		expect(
			resolveAgentTeamResourceRoot({
				isPackaged: false,
				resourcesPath: "C:/electron/resources",
				moduleDirectory: "C:/app/dist/main",
				currentWorkingDirectory: "C:/app",
			}),
		).toBe(join("C:/app", "resources", "agent-teams"));
	});

	it("writes metadata and long descriptions as separate files and reloads them", async () => {
		const { repository, root } = await createRepository();
		const document = createAgentTeamFixture();

		await repository.write(document);
		const loaded = await repository.read();

		expect(loaded).toMatchObject({ teams: document.teams });
		expect(loaded.agents.map(({ systemPrompt: _prompt, presetId: _presetId, ...agent }) => agent)).toEqual(
			expect.arrayContaining(
				document.agents.map(({ systemPrompt: _prompt, presetId: _presetId, ...agent }) => agent),
			),
		);
		expect(loaded.agents).toHaveLength(document.agents.length);
		expect(loaded.revision).toBe(document.revision);
		const firstAgent = document.agents[0];
		if (!firstAgent) throw new Error("Expected an initial agent");
		const metadata = JSON.parse(
			await readFile(
				join(root, "agents", encodeURIComponent(firstAgent.id).replace(/%/g, "_"), "agent.json"),
				"utf8",
			),
		) as Record<string, unknown>;
		expect(metadata).not.toHaveProperty("description");
		expect(metadata).not.toHaveProperty("systemPrompt");
		expect(metadata).not.toHaveProperty("presetId");
		expect(
			await readFile(
				join(root, "agents", encodeURIComponent(firstAgent.id).replace(/%/g, "_"), "description.md"),
				"utf8",
			),
		).toBe(document.agents[0]?.description);
		// 没有显式覆盖就不落 system-prompt.md，人格继续跟随 blueprint。
		expect(await readdir(join(root, "agents", encodeURIComponent(firstAgent.id).replace(/%/g, "_")))).not.toContain(
			"system-prompt.md",
		);
	});

	it("drops a stored prompt that merely repeats the blueprint default", async () => {
		const { repository, root } = await createRepository();
		const document = createAgentTeamFixture();
		const firstAgent = document.agents[0];
		if (!firstAgent) throw new Error("Expected an initial agent");
		const blueprint = BUILTIN_AGENT_BLUEPRINTS.find((candidate) => candidate.id === firstAgent.blueprintId);
		if (!blueprint) throw new Error("Expected the preset blueprint");

		await repository.write(document);
		const agentRoot = join(root, "agents", encodeURIComponent(firstAgent.id).replace(/%/g, "_"));
		// 旧实现把 blueprint 默认提示词物化成了文件，读回来会变成显式覆盖并冻结后续修订。
		await writeFile(join(agentRoot, "system-prompt.md"), `${blueprint.systemPrompt}\n`, "utf8");

		const loaded = await repository.read();
		expect(loaded.agents.find((agent) => agent.id === firstAgent.id)?.systemPrompt).toBeUndefined();

		await repository.write(loaded);
		expect(await readdir(agentRoot)).not.toContain("system-prompt.md");
	});

	it("treats an emptied prompt file as no override", async () => {
		const { repository, root } = await createRepository();
		const document = createAgentTeamFixture();
		const firstAgent = document.agents[0];
		if (!firstAgent) throw new Error("Expected an initial agent");

		await repository.write(document);
		const agentRoot = join(root, "agents", encodeURIComponent(firstAgent.id).replace(/%/g, "_"));
		await writeFile(join(agentRoot, "system-prompt.md"), "   \n", "utf8");

		const loaded = await repository.read();
		expect(loaded.agents.find((agent) => agent.id === firstAgent.id)?.systemPrompt).toBeUndefined();
	});

	it("loads a user-edited system prompt from its content file", async () => {
		const { repository, root } = await createRepository();
		const document = createAgentTeamFixture();
		const firstAgent = document.agents[0];
		if (!firstAgent) throw new Error("Expected an initial agent");

		await repository.write(document);
		const promptPath = join(root, "agents", encodeURIComponent(firstAgent.id).replace(/%/g, "_"), "system-prompt.md");
		await writeFile(promptPath, "Custom long system prompt\n", "utf8");

		const loaded = await repository.read();
		expect(loaded.agents.find((agent) => agent.id === firstAgent.id)?.systemPrompt).toBe(
			"Custom long system prompt\n",
		);
	});

	it("keeps library agents when the last team is deleted", async () => {
		const { repository } = await createRepository();
		const document = createAgentTeamFixture();

		await repository.write({ ...document, teams: [] });

		const loaded = await repository.read();
		expect(loaded.agents).toHaveLength(document.agents.length);
		expect(loaded.teams).toHaveLength(0);
		expect(loaded.revision).toBe(document.revision);
	});

	it("skips an unreadable agent directory instead of reporting an empty library", async () => {
		const { repository, root } = await createRepository();
		const document = createAgentTeamFixture();
		await repository.write(document);
		// 半个目录：写入中途崩溃、同步工具残留或用户手工新建都会长这样。
		await mkdir(join(root, "agents", "half-written"), { recursive: true });
		await writeFile(join(root, "agents", "half-written", "agent.json"), "{}", "utf8");

		const loaded = await repository.read();

		expect(loaded.agents).toHaveLength(document.agents.length);
	});

	it("keeps an unreadable agent directory when writing back", async () => {
		const { repository, root } = await createRepository();
		const document = createAgentTeamFixture();
		await repository.write(document);
		await mkdir(join(root, "agents", "half-written"), { recursive: true });
		await writeFile(join(root, "agents", "half-written", "agent.json"), "{}", "utf8");

		// 读不出来只说明这份数据坏了，不代表用户删掉了这个 Agent：清理必须放过它。
		await repository.write(await repository.read());

		expect(await readdir(join(root, "agents"))).toContain("half-written");
	});

	it("preserves extension-owned directories beside team resources", async () => {
		const { repository, root } = await createRepository();
		await mkdir(join(root, "assets"), { recursive: true });
		await writeFile(join(root, "assets", "README.md"), "owned by an extension", "utf8");

		await repository.write(createAgentTeamFixture());

		expect(await readFile(join(root, "assets", "README.md"), "utf8")).toBe("owned by an extension");
	});

	it("ignores legacy team workspace directories while initializing definitions", async () => {
		const { repository, root } = await createRepository();
		await mkdir(join(root, "legacy-team-workspace", "workspace"), { recursive: true });

		const loaded = await repository.read();

		expect(loaded.teams).toHaveLength(1);
		expect(await readFile(join(root, "index.json"), "utf8")).toContain('"revision"');
		expect(await readdir(join(root, "legacy-team-workspace", "workspace"))).toEqual([]);
	});
});
