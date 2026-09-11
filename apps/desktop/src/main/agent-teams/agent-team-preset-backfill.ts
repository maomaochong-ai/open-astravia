import { existsSync } from "node:fs";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TeamDefinition } from "@vetta/agent-team";
import {
	BASELINE_PRESET_GENERATION,
	BUILTIN_PRESET_GENERATION,
	builtinPresetsIntroducedAfter,
} from "@vetta/agent-team";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import { getAppLogger } from "../logger.js";
import {
	AGENT_TEAM_STORAGE_LAYOUT_VERSION,
	type AgentTeamStorageIndex,
	agentDefinitionPath,
	teamDefinitionPath,
} from "./agent-team-storage-layout.js";

const log = getAppLogger("agent-teams");

const INDEX_FILE = "index.json";

/**
 * 把装机目录补齐到当前的内置预设批次。
 *
 * 初始资源只在目录首次创建时整棵铺下去，之后再新增预设就到不了存量用户手里。这里按批次号
 * 做增量：只补「批次号大于目录已记录批次」的那些，已经存在的、用户改过的、用户删过的一律不碰。
 *
 * 判定刻意不看「目录里缺哪个 id」——那样分不清「还没发过」和「发过但被用户删了」，
 * 后者每次启动都会被复活一遍。批次号一旦落盘，那一批就再也不补。
 */
export async function backfillAgentTeamPresets(
	root: string,
	resourceRoot: string,
	index: AgentTeamStorageIndex,
	/** 覆盖待发批次，仅测试用——当前批次可能为空，机制本身仍要能被验证。 */
	pendingOverride?: (generation: number) => ReturnType<typeof builtinPresetsIntroducedAfter>,
): Promise<AgentTeamStorageIndex> {
	const installed = index.presetGeneration ?? BASELINE_PRESET_GENERATION;
	if (installed >= BUILTIN_PRESET_GENERATION) return index;

	const directories = await readResourceDirectories(resourceRoot);
	if (!directories) {
		log.warn("preset backfill skipped: initial resources are unavailable", { resourceRoot });
		return index;
	}

	const pending = (pendingOverride ?? builtinPresetsIntroducedAfter)(installed);
	const agents = { ...index.agents };
	const teams = { ...index.teams };
	let installedCount = 0;

	for (const agent of pending.agents) {
		if (agents[agent.id]) continue;
		const directory = directories.agents[agent.id];
		if (!directory || !(await installResource(resourceRoot, root, agentDefinitionPath, directory))) {
			logMissingResource("agent", agent.id, agent.name);
			continue;
		}
		agents[agent.id] = directory;
		installedCount += 1;
	}

	for (const team of pending.teams) {
		if (teams[team.id]) continue;
		const missing = missingMemberProfiles(team, agents);
		if (missing.length > 0) {
			// 团队引用不到的成员会让整份配置在 assertTeamInvariants 处读废，宁可不发这支团队。
			log.warn("preset backfill skipped a team whose member profiles are absent", {
				teamId: team.id,
				teamName: team.name,
				missing,
			});
			continue;
		}
		const directory = directories.teams[team.id];
		if (!directory || !(await installResource(resourceRoot, root, teamDefinitionPath, directory))) {
			logMissingResource("team", team.id, team.name);
			continue;
		}
		teams[team.id] = directory;
		installedCount += 1;
	}

	const next: AgentTeamStorageIndex = {
		schemaVersion: index.schemaVersion,
		revision: installedCount > 0 ? index.revision + 1 : index.revision,
		layoutVersion: AGENT_TEAM_STORAGE_LAYOUT_VERSION,
		presetGeneration: BUILTIN_PRESET_GENERATION,
		teams,
		agents,
	};
	await atomicWriteJSONAsync(join(root, INDEX_FILE), next);
	log.info("preset backfill completed", {
		from: installed,
		to: BUILTIN_PRESET_GENERATION,
		installed: installedCount,
	});
	return next;
}

interface ResourceDirectories {
	readonly agents: Readonly<Record<string, string>>;
	readonly teams: Readonly<Record<string, string>>;
}

/** 目录名由 `createAgentTeamStorageKey` 定死，但仍以随包发布的索引为准，避免两处规则漂移。 */
async function readResourceDirectories(resourceRoot: string): Promise<ResourceDirectories | undefined> {
	try {
		const value: unknown = JSON.parse(await readFile(join(resourceRoot, INDEX_FILE), "utf8"));
		if (typeof value !== "object" || value === null) return undefined;
		const { agents, teams } = value as Partial<ResourceDirectories>;
		if (typeof agents !== "object" || agents === null || typeof teams !== "object" || teams === null)
			return undefined;
		return { agents, teams };
	} catch {
		return undefined;
	}
}

async function installResource(
	resourceRoot: string,
	root: string,
	resolve: (base: string, directory: string) => string,
	directory: string,
): Promise<boolean> {
	const source = resolve(resourceRoot, directory);
	const target = resolve(root, directory);
	if (!existsSync(source) || existsSync(target)) return false;
	try {
		await cp(source, target, { recursive: true, errorOnExist: true, force: false });
		return true;
	} catch (error) {
		log.error("failed to install a preset resource directory", {
			source,
			target,
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

function missingMemberProfiles(team: TeamDefinition, agents: Readonly<Record<string, string>>): readonly string[] {
	return team.members
		.map((member) => member.binding.agentProfileId)
		.filter((agentProfileId) => !agents[agentProfileId]);
}

function logMissingResource(kind: "agent" | "team", id: string, name: string): void {
	log.warn("preset backfill could not find the shipped resource directory", { kind, id, name });
}
