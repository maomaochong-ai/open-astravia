import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type {
	AgentProfile,
	AgentTeamDocument,
	AgentTeamExtensionRegistry,
	TeamDefinition,
	TeamMember,
} from "@vetta/agent-team";
import { DEFAULT_AGENT_TEAM_EXTENSIONS, findAgentBlueprint, parseAgentTeamDocument } from "@vetta/agent-team";
import { atomicWriteFileAsync, atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("agent-teams");

const TEAMS_DIR = join(getVettaHomePath(), "agent-teams");
const INITIALIZED_MARKER = ".initialized";
const INDEX_FILE = "index.json";
/** 团队目录下存放成员任务书长文本的位置，一名成员一个 Markdown 文件。 */
const MEMBERS_DIR = "members";

export interface AgentTeamResourceRootOptions {
	readonly isPackaged: boolean;
	readonly resourcesPath?: string;
	readonly moduleDirectory: string;
	readonly currentWorkingDirectory: string;
}

/** Resolve the initial resources for both packaged Electron and bundled development builds. */
export function resolveAgentTeamResourceRoot(options: AgentTeamResourceRootOptions): string {
	if (options.isPackaged && options.resourcesPath) return join(options.resourcesPath, "agent-teams");

	const candidates = [
		join(options.currentWorkingDirectory, "resources", "agent-teams"),
		// Vite bundles the main process into dist/main, while tests load this source file directly.
		join(options.moduleDirectory, "../../resources/agent-teams"),
		join(options.moduleDirectory, "../../../resources/agent-teams"),
	];
	return candidates.find((candidate) => existsSync(join(candidate, INDEX_FILE))) ?? candidates[0];
}

const INITIAL_TEAM_RESOURCE_ROOT = resolveAgentTeamResourceRoot({
	isPackaged: process.defaultApp !== true && typeof process.resourcesPath === "string",
	resourcesPath: process.resourcesPath,
	moduleDirectory: import.meta.dirname,
	currentWorkingDirectory: process.cwd(),
});

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
	private unreadableAgentDirectories: ReadonlySet<string> = new Set();

	constructor(
		private readonly root: string,
		private readonly extensions: AgentTeamExtensionRegistry,
	) {}

	async read(): Promise<AgentTeamDocument> {
		await mkdir(this.root, { recursive: true });
		const entries = await readdir(this.root, { withFileTypes: true });
		const teamDirectories = await this.findTeamDirectories(entries);
		if (teamDirectories.length === 0) {
			if (entries.some((entry) => entry.name === INITIALIZED_MARKER)) {
				const metadata = await this.readIndex();
				return parseAgentTeamDocument({ ...metadata, agents: await this.readAgents(), teams: [] }, this.extensions);
			}
			if (await this.installInitialFiles()) return this.read();
			throw new Error(`Initial Agent Team files are missing: ${INITIAL_TEAM_RESOURCE_ROOT}`);
		}

		const agents = await this.readAgents();
		const teams: TeamDefinition[] = [];
		for (const directory of teamDirectories.sort((left, right) => left.name.localeCompare(right.name))) {
			const manifest = await readJson(join(this.root, directory.name, "team.json"));
			const team = await parseTeamManifest(manifest, join(this.root, directory.name));
			teams.push(team);
		}
		const metadata = await this.readIndex();
		return parseAgentTeamDocument({ ...metadata, agents, teams }, this.extensions);
	}

	private async findTeamDirectories(entries: readonly Dirent[]): Promise<Dirent[]> {
		const directories = entries.filter((entry) => entry.isDirectory() && entry.name !== "agents");
		const results = await Promise.all(
			directories.map(async (entry) => {
				try {
					await readFile(join(this.root, entry.name, "team.json"));
					return entry;
				} catch (error) {
					if (isMissingFile(error)) return undefined;
					throw error;
				}
			}),
		);
		return results.filter((entry): entry is Dirent => entry !== undefined);
	}

	async write(document: AgentTeamDocument): Promise<void> {
		await mkdir(join(this.root, "agents"), { recursive: true });
		const expectedAgentDirectories = new Set<string>();
		for (const agent of document.agents) {
			const directory = safeName(agent.id);
			expectedAgentDirectories.add(directory);
			const agentRoot = join(this.root, "agents", directory);
			await atomicWriteJSONAsync(join(agentRoot, "agent.json"), serializeAgent(agent));
			await atomicWriteFileAsync(join(agentRoot, "description.md"), agent.description);
			// 只落用户的显式覆盖：把 blueprint 默认提示词写进文件等于把默认值钉死成覆盖，
			// 之后升级 blueprint 再也到不了存量用户手里。
			if (agent.systemPrompt !== undefined)
				await atomicWriteFileAsync(join(agentRoot, "system-prompt.md"), agent.systemPrompt);
			else await rm(join(agentRoot, "system-prompt.md"), { force: true });
		}
		await removeStaleDirectories(
			join(this.root, "agents"),
			expectedAgentDirectories,
			this.unreadableAgentDirectories,
		);

		const expectedTeamDirectories = new Set<string>();
		for (const team of document.teams) {
			const directory = safeName(team.id);
			expectedTeamDirectories.add(directory);
			const teamRoot = join(this.root, directory);
			await atomicWriteJSONAsync(join(teamRoot, "team.json"), serializeTeam(team));
			await atomicWriteFileAsync(join(teamRoot, "description.md"), team.description);
			await writeMemberAssignments(teamRoot, team.members);
		}
		await removeStaleTeamDirectories(this.root, expectedTeamDirectories);
		await atomicWriteJSONAsync(join(this.root, INDEX_FILE), {
			schemaVersion: document.schemaVersion,
			// 预设版本必须落盘，否则每次启动都会重跑一次预设迁移。
			...(document.presetVersion !== undefined ? { presetVersion: document.presetVersion } : {}),
			revision: document.revision,
		});
		await atomicWriteFileAsync(join(this.root, INITIALIZED_MARKER), "1\n");
	}

	private async readIndex(): Promise<{ schemaVersion: 1; presetVersion?: number; revision: number }> {
		try {
			const value = await readJson(join(this.root, INDEX_FILE));
			const presetVersion = value.presetVersion;
			return {
				schemaVersion: 1,
				...(typeof presetVersion === "number" && Number.isInteger(presetVersion) && presetVersion >= 1
					? { presetVersion }
					: {}),
				revision: typeof value.revision === "number" && Number.isInteger(value.revision) ? value.revision : 1,
			};
		} catch (error) {
			if (isMissingFile(error)) return { schemaVersion: 1, revision: 1 };
			throw error;
		}
	}

	private async installInitialFiles(): Promise<boolean> {
		try {
			await readFile(join(INITIAL_TEAM_RESOURCE_ROOT, INDEX_FILE), "utf8");
		} catch (error) {
			if (isMissingFile(error)) return false;
			throw error;
		}
		await cp(INITIAL_TEAM_RESOURCE_ROOT, this.root, { recursive: true, errorOnExist: false, force: false });
		await atomicWriteFileAsync(join(this.root, INITIALIZED_MARKER), "1\n");
		return true;
	}

	/**
	 * 逐个目录读取，坏掉的那个跳过并记入 {@link unreadableAgentDirectories}。
	 *
	 * 这里刻意不做批量 try/catch：任何一个目录缺 `agent.json` / `description.md` 都会让整批读取
	 * 抛 ENOENT，若把它当成「一个 Agent 都没有」，随后的 write() 会按空集合清理，
	 * 把其余完好的 Agent 目录一并删掉——一次读失败会升级成永久数据丢失。
	 */
	private async readAgents(): Promise<AgentProfile[]> {
		const agentsRoot = join(this.root, "agents");
		let entries: Dirent[];
		try {
			entries = await readdir(agentsRoot, { withFileTypes: true });
		} catch (error) {
			if (isMissingFile(error)) return [];
			throw error;
		}

		const unreadable = new Set<string>();
		const agents = await Promise.all(
			entries
				.filter((entry) => entry.isDirectory())
				.sort((left, right) => left.name.localeCompare(right.name))
				.map(async (entry) => {
					try {
						return await readAgentDirectory(join(agentsRoot, entry.name));
					} catch (error) {
						unreadable.add(entry.name);
						log.error("failed to read agent profile directory", {
							directory: entry.name,
							error: error instanceof Error ? error.message : String(error),
						});
						return undefined;
					}
				}),
		);
		this.unreadableAgentDirectories = unreadable;
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
	const fallback = typeof blueprintId === "string" ? findAgentBlueprint(blueprintId)?.systemPrompt : undefined;
	return fallback !== undefined && content.trimEnd() === fallback.trimEnd() ? undefined : content;
}

function serializeAgent(agent: AgentProfile): Omit<AgentProfile, "description" | "systemPrompt" | "presetId"> {
	const { description: _description, systemPrompt: _systemPrompt, presetId: _presetId, ...metadata } = agent;
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
		const file = `${safeName(member.id)}.md`;
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
	const instructions = await readOptionalFile(join(teamRoot, MEMBERS_DIR, `${safeName(value.id)}.md`));
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

async function removeStaleDirectories(
	root: string,
	expected: ReadonlySet<string>,
	keep: ReadonlySet<string> = new Set(),
): Promise<void> {
	const entries = await readdir(root, { withFileTypes: true });
	await Promise.all(
		entries
			.filter((entry) => entry.isDirectory() && !expected.has(entry.name) && !keep.has(entry.name))
			.map((entry) => rm(join(root, entry.name), { recursive: true, force: true })),
	);
}

async function removeStaleTeamDirectories(root: string, expected: Set<string>): Promise<void> {
	const entries = await readdir(root, { withFileTypes: true });
	await Promise.all(
		entries
			.filter((entry) => entry.isDirectory() && entry.name !== "agents" && !expected.has(entry.name))
			.map(async (entry) => {
				try {
					await readFile(join(root, entry.name, "team.json"));
					await rm(join(root, entry.name), { recursive: true, force: true });
				} catch (error) {
					if (!isMissingFile(error)) throw error;
				}
			}),
	);
}

function safeName(value: string): string {
	return encodeURIComponent(value).replace(/%/g, "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}
