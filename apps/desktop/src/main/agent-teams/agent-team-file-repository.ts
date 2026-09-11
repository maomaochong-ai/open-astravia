import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type {
	AgentProfile,
	AgentTeamDocument,
	AgentTeamExtensionRegistry,
	TeamDefinition,
	TeamMember,
} from "@vetta/agent-team";
import { DEFAULT_AGENT_TEAM_EXTENSIONS, parseAgentTeamDocument } from "@vetta/agent-team";
import { atomicWriteFileAsync, atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import { getAppLogger } from "../logger.js";
import { agentBlueprintRegistry, resolveAgentBlueprint } from "./agent-blueprint-registry.js";
import {
	AGENT_TEAM_STORAGE_LAYOUT_VERSION,
	type AgentTeamStorageIndex,
	agentDefinitionPath,
	agentTeamAgentsRoot,
	agentTeamDefinitionsRoot,
	createAgentTeamStorageKey,
	memberAssignmentFileName,
	migrateAgentTeamStorage,
	teamDefinitionPath,
} from "./agent-team-storage-layout.js";
import { backfillPluginAgentPresets } from "./plugin-agent-preset-backfill.js";
import { dropRetiredHostPresets } from "./retired-host-presets.js";

const log = getAppLogger("agent-teams");

const TEAMS_DIR = join(getVettaHomePath(), "agent-teams");
const INITIALIZED_MARKER = ".initialized";
const INDEX_FILE = "index.json";
/** 团队目录下存放成员任务书长文本的位置，一名成员一个 Markdown 文件。 */
const MEMBERS_DIR = "members";

export interface AgentTeamFileRepository {
	read(): Promise<AgentTeamDocument>;
	write(document: AgentTeamDocument): Promise<void>;
}

export interface AgentTeamFileRepositoryOptions {
	readonly root?: string;
	readonly extensions?: AgentTeamExtensionRegistry;
}

/** A directory-backed repository. JSON stores indexes; long descriptions live in Markdown files. */
export function createAgentTeamFileRepository(options: AgentTeamFileRepositoryOptions = {}): AgentTeamFileRepository {
	return new DirectoryAgentTeamRepository(
		options.root ?? TEAMS_DIR,
		options.extensions ?? DEFAULT_AGENT_TEAM_EXTENSIONS,
	);
}

class DirectoryAgentTeamRepository implements AgentTeamFileRepository {
	/**
	 * 上一次读取中读坏的 Agent 目录。写回时必须保留它们：
	 * 读不出来只说明这一份数据坏了，不代表用户删除了这个 Agent。
	 */
	private unreadableAgentIds: ReadonlySet<string> = new Set();
	private storageIndex: AgentTeamStorageIndex | undefined;

	constructor(
		private readonly root: string,
		private readonly extensions: AgentTeamExtensionRegistry,
	) {}

	async read(): Promise<AgentTeamDocument> {
		await mkdir(this.root, { recursive: true });
		const { index } = await migrateAgentTeamStorage(this.root);
		this.storageIndex = index;
		const agents = await this.readAgents(index);
		const teams: TeamDefinition[] = [];
		for (const [teamId, directory] of Object.entries(index.teams).sort((left, right) =>
			left[1].localeCompare(right[1]),
		)) {
			const root = teamDefinitionPath(this.root, directory);
			const manifest = await readJson(join(root, "team.json"));
			if (manifest.id !== teamId) throw new Error(`Agent Team directory index mismatch: ${teamId}`);
			const team = await parseTeamManifest(manifest, root);
			teams.push(team);
		}
		const document = parseAgentTeamDocument(
			{
				schemaVersion: index.schemaVersion,
				revision: index.revision,
				agents,
				teams,
			},
			this.extensions,
		);
		return await this.installPresets(document, index);
	}

	/**
	 * 把当前可用的扩展预设补进配置，并清掉宿主留下的装机残骸。
	 *
	 * 宿主不带装机资源：用户第一次打开时看到的智能体与团队全部来自这一步。放在解析之后而不是
	 * 索引层，是因为预设是现造的，走完整的 parse + write 才能保证它们和用户自建的资源满足同一
	 * 套不变量。
	 *
	 * 清理排在回填之后：被扩展接管的角色那时才盖上提供方的戳，据此才放得过它们。
	 */
	private async installPresets(document: AgentTeamDocument, index: AgentTeamStorageIndex): Promise<AgentTeamDocument> {
		const backfilled = backfillPluginAgentPresets({
			document,
			agents: agentBlueprintRegistry.listPluginAgents(),
			teams: agentBlueprintRegistry.listPluginTeams(),
		});
		const retired = index.hostPresetsRetired ? undefined : dropRetiredHostPresets(backfilled?.document ?? document);
		if (!backfilled && !retired && index.hostPresetsRetired) return document;

		this.storageIndex = { ...index, hostPresetsRetired: true };
		const next = retired ?? backfilled?.document;
		if (!next) {
			// 只需要记下「清理过了」这一笔，文档本身没变。
			await atomicWriteJSONAsync(join(this.root, INDEX_FILE), this.storageIndex);
			return document;
		}
		const parsed = parseAgentTeamDocument(next, this.extensions);
		await this.write(parsed);
		log.info("agent presets installed", {
			agents: backfilled?.installedAgentIds.length ?? 0,
			teams: backfilled?.installedTeamIds.length ?? 0,
			retiredHostPresets: retired !== undefined,
		});
		return parsed;
	}

	async write(document: AgentTeamDocument): Promise<void> {
		await mkdir(this.root, { recursive: true });
		const currentIndex = this.storageIndex ?? (await migrateAgentTeamStorage(this.root)).index;
		const agentDirectories: Record<string, string> = {};
		for (const agent of document.agents) {
			const directory = currentIndex.agents[agent.id] ?? createAgentTeamStorageKey(agent.name, agent.id);
			agentDirectories[agent.id] = directory;
			const agentRoot = agentDefinitionPath(this.root, directory);
			await atomicWriteJSONAsync(join(agentRoot, "agent.json"), serializeAgent(agent));
			await atomicWriteFileAsync(join(agentRoot, "description.md"), agent.description);
			// 只落用户的显式覆盖：把 blueprint 默认提示词写进文件等于把默认值钉死成覆盖，
			// 之后升级 blueprint 再也到不了存量用户手里。
			if (agent.systemPrompt !== undefined)
				await atomicWriteFileAsync(join(agentRoot, "system-prompt.md"), agent.systemPrompt);
			else await rm(join(agentRoot, "system-prompt.md"), { force: true });
		}
		for (const agentId of this.unreadableAgentIds) {
			const directory = currentIndex.agents[agentId];
			if (directory) agentDirectories[agentId] = directory;
		}
		await removeDeletedMappedDirectories(agentTeamAgentsRoot(this.root), currentIndex.agents, agentDirectories);

		const teamDirectories: Record<string, string> = {};
		for (const team of document.teams) {
			const directory = currentIndex.teams[team.id] ?? createAgentTeamStorageKey(team.name, team.id);
			teamDirectories[team.id] = directory;
			const teamRoot = teamDefinitionPath(this.root, directory);
			await atomicWriteJSONAsync(join(teamRoot, "team.json"), serializeTeam(team));
			await atomicWriteFileAsync(join(teamRoot, "description.md"), team.description);
			await writeMemberAssignments(teamRoot, team.members);
		}
		await removeDeletedMappedDirectories(agentTeamDefinitionsRoot(this.root), currentIndex.teams, teamDirectories);
		const nextIndex: AgentTeamStorageIndex = {
			schemaVersion: document.schemaVersion,
			revision: document.revision,
			layoutVersion: AGENT_TEAM_STORAGE_LAYOUT_VERSION,
			// 一次性开关必须原样带过去：写丢了下次启动会把用户之后自建的同 id 资源当成残骸再清一遍。
			...(currentIndex.hostPresetsRetired ? { hostPresetsRetired: true } : {}),
			teams: teamDirectories,
			agents: agentDirectories,
		};
		await atomicWriteJSONAsync(join(this.root, INDEX_FILE), nextIndex);
		await atomicWriteFileAsync(join(this.root, INITIALIZED_MARKER), "1\n");
		this.storageIndex = nextIndex;
	}

	/**
	 * 逐个目录读取，坏掉的那个跳过并记入 {@link unreadableAgentDirectories}。
	 *
	 * 这里刻意不做批量 try/catch：任何一个目录缺 `agent.json` / `description.md` 都会让整批读取
	 * 抛 ENOENT，若把它当成「一个 Agent 都没有」，随后的 write() 会按空集合清理，
	 * 把其余完好的 Agent 目录一并删掉——一次读失败会升级成永久数据丢失。
	 */
	private async readAgents(index: AgentTeamStorageIndex): Promise<AgentProfile[]> {
		const unreadable = new Set<string>();
		const agents = await Promise.all(
			Object.entries(index.agents)
				.sort((left, right) => left[1].localeCompare(right[1]))
				.map(async ([agentId, directory]) => {
					try {
						const agent = await readAgentDirectory(agentDefinitionPath(this.root, directory));
						if (agent.id !== agentId) throw new Error(`Agent directory index mismatch: ${agentId}`);
						return agent;
					} catch (error) {
						unreadable.add(agentId);
						log.error("failed to read agent profile directory", {
							directory,
							error: error instanceof Error ? error.message : String(error),
						});
						return undefined;
					}
				}),
		);
		this.unreadableAgentIds = unreadable;
		return agents.filter((agent): agent is AgentProfile => agent !== undefined);
	}
}

/** 已下线的档案字段。留在磁盘上会让 `additionalProperties: false` 的校验把整份配置判废。 */
const RETIRED_AGENT_FIELDS = ["avatarBackground"] as const;

async function readAgentDirectory(root: string): Promise<AgentProfile> {
	const value = await readJson(join(root, "agent.json"));
	for (const field of RETIRED_AGENT_FIELDS) delete value[field];
	const description = await readFile(join(root, "description.md"), "utf8");
	const systemPrompt = resolveStoredSystemPrompt(await readOptionalFile(join(root, "system-prompt.md")), value);
	return {
		...value,
		description,
		...(systemPrompt !== undefined ? { systemPrompt } : {}),
	} as AgentProfile;
}

/**
 * 判定磁盘上的 `system-prompt.md` 是不是一份**显式覆盖**。
 *
 * 空文件视为未覆盖；内容与 blueprint 默认逐字相同同样视为未覆盖——旧实现会把默认提示词
 * 物化成文件，读回来就成了显式覆盖，导致 blueprint 的后续修订永远到不了存量安装。
 * 这里顺带自愈这批数据：下一次写回时该文件会被删掉。
 */
function resolveStoredSystemPrompt(content: string | undefined, metadata: Record<string, unknown>): string | undefined {
	if (content === undefined || content.trim().length === 0) return undefined;
	const blueprintId = metadata.blueprintId;
	const fallback = typeof blueprintId === "string" ? resolveAgentBlueprint(blueprintId)?.systemPrompt : undefined;
	return fallback !== undefined && content.trimEnd() === fallback.trimEnd() ? undefined : content;
}

function serializeAgent(agent: AgentProfile): Omit<AgentProfile, "description" | "systemPrompt"> {
	const { description: _description, systemPrompt: _systemPrompt, ...metadata } = agent;
	return metadata;
}

function serializeTeam(team: TeamDefinition): Omit<TeamDefinition, "description"> {
	const { description: _description, ...metadata } = team;
	return { ...metadata, members: team.members.map(serializeMember) };
}

/** 任务书的补充指令是长文本，按 ADR-0106 的合同落到独立 Markdown，不进 team.json。 */
function serializeMember(member: TeamMember): TeamMember {
	if (!member.assignment) return member;
	const { instructions: _instructions, ...assignment } = member.assignment;
	return { ...member, assignment: Object.keys(assignment).length > 0 ? assignment : undefined };
}

async function writeMemberAssignments(teamRoot: string, members: readonly TeamMember[]): Promise<void> {
	const membersRoot = join(teamRoot, MEMBERS_DIR);
	const expected = new Set<string>();
	for (const member of members) {
		const instructions = member.assignment?.instructions;
		if (!instructions) continue;
		const file = memberAssignmentFileName(member.id, member.handle);
		expected.add(file);
		await atomicWriteFileAsync(join(membersRoot, file), instructions);
	}
	await removeStaleAssignmentFiles(membersRoot, expected);
}

/** 成员被移出团队或清空任务书后，孤儿文件必须一并消失，否则重新入团会读到上一任的交待。 */
async function removeStaleAssignmentFiles(membersRoot: string, expected: ReadonlySet<string>): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(membersRoot, { withFileTypes: true });
	} catch (error) {
		if (isMissingFile(error)) return;
		throw error;
	}
	await Promise.all(
		entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !expected.has(entry.name))
			.map((entry) => rm(join(membersRoot, entry.name), { force: true })),
	);
}

async function parseTeamManifest(value: unknown, root: string): Promise<TeamDefinition> {
	if (!isRecord(value)) throw new Error(`Invalid Agent Team manifest: ${root}`);
	const description = await readFile(join(root, "description.md"), "utf8");
	const members = Array.isArray(value.members)
		? await Promise.all(value.members.map((member: unknown) => readMemberAssignment(member, root)))
		: value.members;
	return { ...value, description, members } as TeamDefinition;
}

async function readMemberAssignment(value: unknown, teamRoot: string): Promise<unknown> {
	if (!isRecord(value) || typeof value.id !== "string") return value;
	if (typeof value.handle !== "string") return value;
	const instructions = await readOptionalFile(
		join(teamRoot, MEMBERS_DIR, memberAssignmentFileName(value.id, value.handle)),
	);
	if (instructions === undefined || instructions.trim().length === 0) return value;
	const assignment = isRecord(value.assignment) ? value.assignment : {};
	return { ...value, assignment: { ...assignment, instructions } };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
	const value: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isRecord(value)) throw new Error(`Invalid Agent Team metadata: ${path}`);
	return value;
}

async function readOptionalFile(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		throw error;
	}
}

async function removeDeletedMappedDirectories(
	root: string,
	current: Readonly<Record<string, string>>,
	next: Readonly<Record<string, string>>,
): Promise<void> {
	await Promise.all(
		Object.entries(current)
			.filter(([id]) => next[id] === undefined)
			.map(([, directory]) => rm(join(root, directory), { recursive: true, force: true })),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}
