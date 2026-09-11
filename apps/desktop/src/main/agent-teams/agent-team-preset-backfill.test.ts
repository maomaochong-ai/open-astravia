import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_PRESET_GENERATION, INITIAL_AGENT_PROFILES, INITIAL_AGENT_TEAMS } from "@vetta/agent-team";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backfillAgentTeamPresets } from "./agent-team-preset-backfill.js";
import {
	type AgentTeamStorageIndex,
	createAgentTeamStorageKey,
	readAgentTeamStorageIndex,
} from "./agent-team-storage-layout.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const RESOURCE_ROOT = join(process.cwd(), "resources", "agent-teams");

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

/** 存量装机目录：整棵铺的是随包资源，但还没记过批次号，也还没收到新一批预设。 */
async function createLegacyInstallation(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-preset-backfill-"));
	temporaryDirectories.push(root);
	await cp(RESOURCE_ROOT, root, { recursive: true });
	return root;
}

/**
 * 当前批次可能是空的（上一批的内容被搬进了插件），但回填机制本身必须一直可验证。
 * 这里拿几个真实存在的预设冒充「待发批次」，随包目录里有它们，copy 路径能真的跑通。
 */
const PENDING_FIXTURE = {
	agents: INITIAL_AGENT_PROFILES.filter((agent) => agent.mentionHandle === "translator"),
	teams: INITIAL_AGENT_TEAMS.filter((team) => team.name === "Biz Strategy"),
};

const pendingFixture = () => PENDING_FIXTURE;

/** 抹掉「上一批之后新增」的那些预设，模拟回填机制上线前就已经存在的目录。 */
async function stripPendingPresets(root: string, index: AgentTeamStorageIndex): Promise<AgentTeamStorageIndex> {
	const pending = PENDING_FIXTURE;
	const agents = { ...index.agents };
	const teams = { ...index.teams };
	for (const agent of pending.agents) {
		await rm(join(root, "agents", createAgentTeamStorageKey(agent.name, agent.id)), { recursive: true, force: true });
		delete agents[agent.id];
	}
	for (const team of pending.teams) {
		await rm(join(root, "teams", createAgentTeamStorageKey(team.name, team.id)), { recursive: true, force: true });
		delete teams[team.id];
	}
	const { presetGeneration: _presetGeneration, ...rest } = index;
	return { ...rest, agents, teams };
}

describe("Agent Team preset backfill", () => {
	it("installs presets an existing installation never received and records the batch", async () => {
		const root = await createLegacyInstallation();
		const stale = await stripPendingPresets(root, await readAgentTeamStorageIndex(root));
		const pending = PENDING_FIXTURE;
		expect(pending.agents.length + pending.teams.length).toBeGreaterThan(0);

		const next = await backfillAgentTeamPresets(root, RESOURCE_ROOT, stale, pendingFixture);

		for (const agent of pending.agents) expect(next.agents[agent.id]).toBeDefined();
		for (const team of pending.teams) expect(next.teams[team.id]).toBeDefined();
		expect(next.presetGeneration).toBe(BUILTIN_PRESET_GENERATION);
		expect(next.revision).toBe(stale.revision + 1);
		expect(await readAgentTeamStorageIndex(root)).toEqual(next);
	});

	it("leaves everything the installation already carries untouched", async () => {
		const root = await createLegacyInstallation();
		const index = await readAgentTeamStorageIndex(root);

		const next = await backfillAgentTeamPresets(root, RESOURCE_ROOT, index);

		expect(next.agents).toEqual(index.agents);
		expect(next.teams).toEqual(index.teams);
		expect(next.revision).toBe(index.revision);
	});

	it("does not resurrect a preset the user deleted after that batch was recorded", async () => {
		const root = await createLegacyInstallation();
		const stripped = await stripPendingPresets(root, await readAgentTeamStorageIndex(root));
		// 批次号已经记到当前批：缺的那些是用户自己删的，不是没发过。
		const deleted: AgentTeamStorageIndex = { ...stripped, presetGeneration: BUILTIN_PRESET_GENERATION };

		const next = await backfillAgentTeamPresets(root, RESOURCE_ROOT, deleted, pendingFixture);

		expect(next).toEqual(deleted);
		for (const agent of PENDING_FIXTURE.agents) {
			expect(next.agents[agent.id]).toBeUndefined();
		}
	});

	it("skips a pending team whose member profiles are missing instead of writing a broken reference", async () => {
		const root = await createLegacyInstallation();
		const stale = await stripPendingPresets(root, await readAgentTeamStorageIndex(root));
		const pendingTeam = PENDING_FIXTURE.teams[0];
		if (!pendingTeam) throw new Error("expected a pending team fixture");
		// 用户删掉了这支团队引用的某个成员：补上团队会让整份配置在读取时校验失败。
		const referenced = pendingTeam.members[1]?.binding.agentProfileId;
		if (!referenced) throw new Error("expected a referenced member profile");
		const agents = { ...stale.agents };
		delete agents[referenced];

		const next = await backfillAgentTeamPresets(root, RESOURCE_ROOT, { ...stale, agents }, pendingFixture);

		expect(next.teams[pendingTeam.id]).toBeUndefined();
		expect(next.presetGeneration).toBe(BUILTIN_PRESET_GENERATION);
	});

	it("stamps the current batch on an installation that is already up to date", async () => {
		const root = await createLegacyInstallation();
		const { presetGeneration: _presetGeneration, ...unstamped } = await readAgentTeamStorageIndex(root);

		const next = await backfillAgentTeamPresets(root, RESOURCE_ROOT, unstamped);

		expect(next.presetGeneration).toBe(BUILTIN_PRESET_GENERATION);
		expect(next.agents).toEqual(unstamped.agents);
	});
});
