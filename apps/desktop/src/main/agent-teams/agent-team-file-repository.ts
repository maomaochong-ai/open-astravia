import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { AgentProfile, AgentTeamDocument, AgentTeamExtensionRegistry, TeamDefinition } from "@vetta/agent-team";
import { DEFAULT_AGENT_TEAM_EXTENSIONS, findAgentBlueprint, parseAgentTeamDocument } from "@vetta/agent-team";
import { atomicWriteFileAsync, atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";

const TEAMS_DIR = join(getVettaHomePath(), "agent-teams");
const INITIALIZED_MARKER = ".initialized";
const INDEX_FILE = "index.json";

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
			const systemPrompt = agent.systemPrompt ?? findAgentBlueprint(agent.blueprintId)?.systemPrompt;
			await atomicWriteJSONAsync(join(agentRoot, "agent.json"), serializeAgent(agent));
			await atomicWriteFileAsync(join(agentRoot, "description.md"), agent.description);
			if (systemPrompt !== undefined) await atomicWriteFileAsync(join(agentRoot, "system-prompt.md"), systemPrompt);
			else await rm(join(agentRoot, "system-prompt.md"), { force: true });
		}
		await removeStaleDirectories(join(this.root, "agents"), expectedAgentDirectories);

		const expectedTeamDirectories = new Set<string>();
		for (const team of document.teams) {
			const directory = safeName(team.id);
			expectedTeamDirectories.add(directory);
			const teamRoot = join(this.root, directory);
			await atomicWriteJSONAsync(join(teamRoot, "team.json"), serializeTeam(team));
			await atomicWriteFileAsync(join(teamRoot, "description.md"), team.description);
		}
		await removeStaleTeamDirectories(this.root, expectedTeamDirectories);
		await atomicWriteJSONAsync(join(this.root, INDEX_FILE), {
			schemaVersion: document.schemaVersion,
			revision: document.revision,
		});
		await atomicWriteFileAsync(join(this.root, INITIALIZED_MARKER), "1\n");
	}

	private async readIndex(): Promise<{ schemaVersion: 1; revision: number }> {
		try {
			const value = await readJson(join(this.root, INDEX_FILE));
			return {
				schemaVersion: 1,
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

	private async readAgents(): Promise<AgentProfile[]> {
		const agentsRoot = join(this.root, "agents");
		try {
			const entries = await readdir(agentsRoot, { withFileTypes: true });
			return await Promise.all(
				entries
					.filter((entry) => entry.isDirectory())
					.sort((left, right) => left.name.localeCompare(right.name))
					.map(async (entry) => {
						const value = await readJson(join(agentsRoot, entry.name, "agent.json"));
						const description = await readFile(join(agentsRoot, entry.name, "description.md"), "utf8");
						const systemPrompt = await readOptionalFile(join(agentsRoot, entry.name, "system-prompt.md"));
						return {
							...value,
							description,
							...(systemPrompt !== undefined ? { systemPrompt } : {}),
						} as AgentProfile;
					}),
			);
		} catch (error) {
			if (isMissingFile(error)) return [];
			throw error;
		}
	}
}

function serializeAgent(agent: AgentProfile): Omit<AgentProfile, "description" | "systemPrompt" | "presetId"> {
	const { description: _description, systemPrompt: _systemPrompt, presetId: _presetId, ...metadata } = agent;
	return metadata;
}

function serializeTeam(team: TeamDefinition): Omit<TeamDefinition, "description"> {
	const { description: _description, ...metadata } = team;
	return metadata;
}

async function parseTeamManifest(value: unknown, root: string): Promise<TeamDefinition> {
	if (!isRecord(value)) throw new Error(`Invalid Agent Team manifest: ${root}`);
	const description = await readFile(join(root, "description.md"), "utf8");
	return { ...value, description } as TeamDefinition;
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

async function removeStaleDirectories(root: string, expected: Set<string>, keep = new Set<string>()): Promise<void> {
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
