import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { codingAgentSessionShardPath } from "@vetta/coding-agent/bootstrap";
import { atomicWriteFileAsync, atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";

export const AGENT_TEAM_STORAGE_LAYOUT_VERSION = 2;
export const AGENT_TEAM_TEAMS_DIRECTORY = "teams";
export const AGENT_TEAM_AGENTS_DIRECTORY = "agents";
export const AGENT_TEAM_WORKSPACES_DIRECTORY = "workspaces";
export const AGENT_TEAM_SESSION_WORKSPACES_DIRECTORY = "session-workspaces";

const MIGRATION_JOURNAL = ".storage-migration-v2.json";
const ORPHANED_DIRECTORY = ".orphaned";
const PATH_FIELDS = new Set([
	"cwd",
	"path",
	"sessionPath",
	"sourceSessionPath",
	"parentSessionPath",
	"coordinationSessionPath",
	"workspacePath",
]);
const ID_KEYED_FIELDS = new Set(["memberHandles", "memberRuntime"]);
const RETIRED_STORAGE_FIELDS = new Set(["presetId", "presetVersion"]);

/**
 * Retired product-owned ids. They are migration input only: after layout v2 is
 * committed, default resources are indistinguishable from user-created data.
 */
const LEGACY_ID_MAPPINGS: Readonly<Record<string, string>> = Object.freeze({
	"builtin:agent:master": "be72a2d2-5463-4d20-9ac2-3fd78e9fbb2e",
	"builtin:agent:researcher": "2fef0dcb-7798-4060-8694-f34b74696d0a",
	"builtin:agent:architect": "934d1f05-1093-4d56-94a1-00642d7eaab6",
	"builtin:agent:executor": "d9e51357-04b8-481d-af80-a08e1a362322",
	"builtin:agent:auditor": "2680428f-7e1e-46e4-9d54-7a841ac3cbd5",
	"builtin:agent:optimizer": "c0a9ab1e-059f-40dd-91d7-92a6f1e8d52c",
	"builtin:agent:synthesizer": "6d8baef0-b15d-43a1-8f25-826eae651779",
	"builtin:agent:translator": "f162c69d-fc73-443d-af31-b53a1563f43c",
	"builtin:agent:leader": "b8b9af05-a996-414b-b31e-60f71d2d6827",
	"builtin:agent:builder": "8a8df807-904e-46d6-b76d-4add4c5a53cd",
	"builtin:agent:reviewer": "737b16d1-6999-4e50-bb13-36d468317beb",
	"builtin:team:dev": "2f631500-0d58-4458-a595-9e403affa08e",
	"builtin:team:research": "9c975a15-1a00-4b1d-b646-0c1d76c43e3c",
	"builtin:team:growth": "742016f1-0f8b-4d9f-a86b-6863ed6cb58a",
	"builtin:team:strategy": "6efa6897-3e38-499c-92b4-ceeb5725b069",
	"builtin:team:vetta": "7d8383c0-c0da-47cc-8952-bb28e6d3af54",
	"builtin:member:dev:master": "5331fb94-0f3a-45c5-9ba1-32048a5067d3",
	"builtin:member:dev:architect": "062e9186-ca1a-42d7-9d1d-66731b8ce17b",
	"builtin:member:dev:executor": "09221fe5-ce98-4555-a294-6d78e29b87b4",
	"builtin:member:dev:auditor": "9c121f61-5f75-4b88-b5fd-188e2924c096",
	"builtin:member:research:master": "f3b04ffa-ec1e-441f-94c9-e0c1d50210d8",
	"builtin:member:research:researcher": "c0f153d9-ff73-405e-adf9-cd1526093428",
	"builtin:member:research:auditor": "51f36c41-e927-4930-a741-b54db407b87c",
	"builtin:member:research:synthesizer": "a05ff816-6ee4-4434-b887-128589d582fc",
	"builtin:member:growth:master": "c46df2f5-b71e-483b-ab55-850a04810e1a",
	"builtin:member:growth:researcher": "264190c7-44b6-4d2d-9699-10f28112da0f",
	"builtin:member:growth:executor": "4408eb6d-5d20-46ba-b2df-8ca7e2b90cc1",
	"builtin:member:growth:optimizer": "0f6eda99-c856-4996-860d-7e30e17f97eb",
	"builtin:member:strategy:master": "9f6f1b32-300f-4f2a-a55a-f0062bfe73e1",
	"builtin:member:strategy:architect": "0ee37840-141e-404e-88a4-39e41f56b265",
	"builtin:member:strategy:auditor": "556cb9e4-52d4-4372-8ff9-cce2525af1e8",
	"builtin:member:strategy:synthesizer": "e7b8321b-f70b-4d67-a832-6a5d95ff8320",
	"builtin:member:leader": "022bf00c-ac5e-49b2-a80c-c33b7aed3f74",
	"builtin:member:researcher": "2f28484c-8780-4858-b584-fd150bf85ecc",
	"builtin:member:builder": "5bb24c51-3094-483d-acd3-9c29aece09ee",
	"builtin:member:reviewer": "bd6838e2-1b1f-4452-8e95-7f2652f67c16",
});

const LEGACY_REFERENCE_MAPPINGS: Readonly<Record<string, string>> = Object.freeze({
	...LEGACY_ID_MAPPINGS,
	...Object.fromEntries(
		Object.entries(LEGACY_ID_MAPPINGS)
			.filter(([id]) => id.startsWith("builtin:team:"))
			.map(([id, replacement]) => [`agent-team:${id}`, `agent-team:${replacement}`]),
	),
});

const LEGACY_EMBEDDED_ID_MAPPINGS = Object.entries(LEGACY_ID_MAPPINGS).sort(
	([left], [right]) => right.length - left.length,
);

const LEGACY_TEAM_NAMES: Readonly<Record<string, string>> = Object.freeze({
	"builtin:team:dev": "Dev Team",
	"builtin:team:research": "Deep Research",
	"builtin:team:growth": "Growth & Content",
	"builtin:team:strategy": "Biz Strategy",
	"builtin:team:vetta": "Vetta Team",
});

export interface AgentTeamStorageIndex {
	readonly schemaVersion: 1;
	readonly revision: number;
	readonly layoutVersion: typeof AGENT_TEAM_STORAGE_LAYOUT_VERSION;
	/**
	 * 已经收到的内置预设批次。缺失表示这份目录建于回填机制上线之前，按基线批次处理。
	 *
	 * 它同时是「用户删掉的预设不再复活」的依据：批次一旦记下，那批里的东西删了就不会再补。
	 */
	readonly presetGeneration?: number;
	/**
	 * 已经铺过的插件预设 key。与 {@link AgentTeamStorageIndex.presetGeneration} 同理：
	 * 记下才能区分「还没铺过」和「铺过但被用户删了」，后者不该在下次启动复活。
	 */
	readonly installedPluginPresets?: readonly string[];
	readonly teams: Readonly<Record<string, string>>;
	readonly agents: Readonly<Record<string, string>>;
}

interface StorageMove {
	readonly source: string;
	readonly target: string;
}

interface PathMapping {
	readonly source: string;
	readonly target: string;
}

interface AgentTeamStorageMigrationJournal {
	readonly layoutVersion: typeof AGENT_TEAM_STORAGE_LAYOUT_VERSION;
	readonly index: AgentTeamStorageIndex;
	readonly moves: readonly StorageMove[];
	readonly pathMappings: readonly PathMapping[];
	readonly idMappings: Readonly<Record<string, string>>;
}

interface LegacyResource {
	readonly id: string;
	readonly name: string;
	readonly directory: string;
}

interface LegacyWorkspace {
	readonly id: string;
	readonly name: string;
	readonly directory: string;
	readonly scheme: "base64url" | "percent" | "team-directory";
}

export interface AgentTeamStorageMigrationResult {
	readonly migrated: boolean;
	readonly index: AgentTeamStorageIndex;
}

/**
 * Build a stable, readable and cross-platform directory key.
 *
 * The display-name portion is only selected once. The immutable id digest keeps
 * equal names distinct without exposing UUID-shaped directories to users.
 */
export function createAgentTeamStorageKey(name: string, id: string): string {
	const words = name
		.normalize("NFKC")
		.match(/[\p{L}\p{N}]+/gu)
		?.join("-")
		.toLocaleLowerCase("en-US");
	const slug = truncateCodePoints(words || "resource", 48).replace(/[. ]+$/u, "") || "resource";
	const digest = createHash("sha256").update(id, "utf8").digest("hex").slice(0, 10);
	return `${slug}--${digest}`;
}

export function memberAssignmentFileName(memberId: string, handle: string): string {
	return `${createAgentTeamStorageKey(handle, memberId)}.md`;
}

export function agentTeamDefinitionsRoot(root: string): string {
	return join(root, AGENT_TEAM_TEAMS_DIRECTORY);
}

export function agentTeamAgentsRoot(root: string): string {
	return join(root, AGENT_TEAM_AGENTS_DIRECTORY);
}

export function agentTeamWorkspacesRoot(root: string): string {
	return join(root, AGENT_TEAM_WORKSPACES_DIRECTORY);
}

export function agentTeamSessionWorkspacesRoot(root: string): string {
	return join(root, AGENT_TEAM_SESSION_WORKSPACES_DIRECTORY);
}

export function teamDefinitionPath(root: string, directory: string): string {
	return join(agentTeamDefinitionsRoot(root), assertStorageDirectory(directory));
}

export function agentDefinitionPath(root: string, directory: string): string {
	return join(agentTeamAgentsRoot(root), assertStorageDirectory(directory));
}

export function teamWorkspacePath(root: string, directory: string): string {
	return join(agentTeamWorkspacesRoot(root), assertStorageDirectory(directory));
}

export function teamSessionWorkspacePath(root: string, teamDirectory: string, workspaceDirectory: string): string {
	return join(
		agentTeamSessionWorkspacesRoot(root),
		assertStorageDirectory(teamDirectory),
		assertStorageDirectory(workspaceDirectory),
	);
}

export async function readAgentTeamStorageIndex(root: string): Promise<AgentTeamStorageIndex> {
	const value: unknown = JSON.parse(await readFile(join(root, "index.json"), "utf8"));
	if (!isRecord(value) || value.layoutVersion !== AGENT_TEAM_STORAGE_LAYOUT_VERSION) {
		throw new Error("Agent Team storage has not been migrated to layout version 2");
	}
	if (value.schemaVersion !== 1 || !isNonNegativeInteger(value.revision)) {
		throw new Error("Invalid Agent Team storage index metadata");
	}
	const teams = parseDirectoryMap(value.teams, "team");
	const agents = parseDirectoryMap(value.agents, "agent");
	return {
		schemaVersion: 1,
		revision: value.revision,
		layoutVersion: AGENT_TEAM_STORAGE_LAYOUT_VERSION,
		...(isNonNegativeInteger(value.presetGeneration) ? { presetGeneration: value.presetGeneration } : {}),
		...(isStringArray(value.installedPluginPresets) ? { installedPluginPresets: value.installedPluginPresets } : {}),
		teams,
		agents,
	};
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function migrateAgentTeamStorage(root: string): Promise<AgentTeamStorageMigrationResult> {
	await mkdir(root, { recursive: true });
	try {
		return { migrated: false, index: await readAgentTeamStorageIndex(root) };
	} catch (error) {
		if (!isLayoutVersionError(error) && nodeErrorCode(error) !== "ENOENT") throw error;
	}

	const journalPath = join(root, MIGRATION_JOURNAL);
	const journal = existsSync(journalPath)
		? parseMigrationJournal(JSON.parse(await readFile(journalPath, "utf8")))
		: await createMigrationJournal(root);
	if (!existsSync(journalPath)) await atomicWriteJSONAsync(journalPath, journal);

	await preflightMoves(journal.moves);
	for (const move of journal.moves) await moveDirectory(move);
	await rewritePersistedReferences(root, journal.pathMappings, journal.idMappings);
	await atomicWriteJSONAsync(join(root, "index.json"), journal.index);
	await rm(journalPath, { force: true });
	return { migrated: true, index: journal.index };
}

async function createMigrationJournal(root: string): Promise<AgentTeamStorageMigrationJournal> {
	const legacyIndex = await readLegacyIndex(root);
	const teams = await readLegacyTeams(root);
	const agents = await readLegacyAgents(root);
	const teamDirectories = allocateDirectories(teams);
	const agentDirectories = allocateDirectories(agents);
	const moves: StorageMove[] = [];
	const pathMappings: PathMapping[] = [];

	const workspaces = await readLegacyWorkspaces(root, teams);
	const primaryWorkspaceByTeam = new Map<string, LegacyWorkspace>();
	for (const workspace of workspaces) {
		const current = primaryWorkspaceByTeam.get(workspace.id);
		if (!current || workspacePriority(workspace) > workspacePriority(current)) {
			primaryWorkspaceByTeam.set(workspace.id, workspace);
		}
	}

	for (const workspace of workspaces) {
		const teamDirectory = teamDirectories[workspace.id];
		const primary = primaryWorkspaceByTeam.get(workspace.id);
		const isPrimary = teamDirectory !== undefined && primary?.directory === workspace.directory;
		const orphanKey = `${createAgentTeamStorageKey(workspace.name, workspace.id)}--${workspace.scheme}`;
		const target = isPrimary
			? teamWorkspacePath(root, teamDirectory)
			: join(root, ORPHANED_DIRECTORY, AGENT_TEAM_WORKSPACES_DIRECTORY, orphanKey);
		const source = join(workspace.directory, "workspace");
		moves.push({ source, target });
		pathMappings.push({ source, target });

		const sourceShard = codingAgentSessionShardPath(source, join(dirname(root), "agent"));
		const targetShard = codingAgentSessionShardPath(target, join(dirname(root), "agent"));
		moves.push({ source: sourceShard, target: targetShard });
		pathMappings.push({ source: sourceShard, target: targetShard });
	}

	for (const team of teams) {
		const target = teamDefinitionPath(root, teamDirectories[team.id]);
		moves.push({ source: team.directory, target });
		const manifest = await readOptionalJson(join(team.directory, "team.json"));
		if (!manifest || !Array.isArray(manifest.members)) continue;
		for (const member of manifest.members) {
			if (!isRecord(member) || typeof member.id !== "string" || typeof member.handle !== "string") continue;
			const migratedMemberId = migrateLegacyId(member.id);
			moves.push({
				source: join(target, "members", `${legacySafeName(member.id)}.md`),
				target: join(target, "members", memberAssignmentFileName(migratedMemberId, member.handle)),
			});
		}
	}
	for (const agent of agents) {
		moves.push({ source: agent.directory, target: agentDefinitionPath(root, agentDirectories[agent.id]) });
	}

	return {
		layoutVersion: AGENT_TEAM_STORAGE_LAYOUT_VERSION,
		index: {
			...legacyIndex,
			layoutVersion: AGENT_TEAM_STORAGE_LAYOUT_VERSION,
			teams: teamDirectories,
			agents: agentDirectories,
		},
		moves: distinctMoves(moves),
		pathMappings: distinctMappings(pathMappings),
		idMappings: LEGACY_REFERENCE_MAPPINGS,
	};
}

async function readLegacyIndex(root: string): Promise<Pick<AgentTeamStorageIndex, "schemaVersion" | "revision">> {
	try {
		const value: unknown = JSON.parse(await readFile(join(root, "index.json"), "utf8"));
		if (!isRecord(value)) throw new Error("Invalid legacy Agent Team index");
		return {
			schemaVersion: 1,
			revision: isNonNegativeInteger(value.revision) ? value.revision : 1,
		};
	} catch (error) {
		if (nodeErrorCode(error) === "ENOENT") return { schemaVersion: 1, revision: 1 };
		throw error;
	}
}

async function readLegacyTeams(root: string): Promise<LegacyResource[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const resources: LegacyResource[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || isReservedRootDirectory(entry.name)) continue;
		const directory = join(root, entry.name);
		const manifest = await readOptionalJson(join(directory, "team.json"));
		if (!manifest) continue;
		resources.push(parseLegacyResource(manifest, directory, "team"));
	}
	return resources;
}

async function readLegacyAgents(root: string): Promise<LegacyResource[]> {
	const agentsRoot = agentTeamAgentsRoot(root);
	let entries: Dirent[];
	try {
		entries = await readdir(agentsRoot, { withFileTypes: true });
	} catch (error) {
		if (nodeErrorCode(error) === "ENOENT") return [];
		throw error;
	}
	const resources: LegacyResource[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const directory = join(agentsRoot, entry.name);
		const manifest = await readOptionalJson(join(directory, "agent.json"));
		if (!manifest) continue;
		resources.push(parseLegacyResource(manifest, directory, "agent"));
	}
	return resources;
}

async function readLegacyWorkspaces(root: string, teams: readonly LegacyResource[]): Promise<LegacyWorkspace[]> {
	const teamByDirectory = new Map(teams.map((team) => [normalizePath(team.directory), team]));
	const teamNameById = new Map(teams.map((team) => [team.id, team.name]));
	const entries = await readdir(root, { withFileTypes: true });
	const workspaces: LegacyWorkspace[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || isReservedRootDirectory(entry.name)) continue;
		const directory = join(root, entry.name);
		if (!existsSync(join(directory, "workspace"))) continue;
		const team = teamByDirectory.get(normalizePath(directory));
		if (team) {
			workspaces.push({ id: team.id, name: team.name, directory, scheme: "team-directory" });
			continue;
		}
		const decoded = decodeLegacyWorkspaceDirectory(entry.name);
		if (!decoded) throw new Error(`Unknown legacy Agent Team workspace directory: ${entry.name}`);
		const migratedId = migrateLegacyId(decoded.id);
		workspaces.push({
			id: migratedId,
			name: teamNameById.get(migratedId) ?? LEGACY_TEAM_NAMES[decoded.id] ?? "Orphaned Team",
			directory,
			scheme: decoded.scheme,
		});
	}
	return workspaces;
}

function decodeLegacyWorkspaceDirectory(
	name: string,
): { readonly id: string; readonly scheme: "base64url" | "percent" } | undefined {
	if (name.includes("%")) {
		try {
			return { id: decodeURIComponent(name), scheme: "percent" };
		} catch {
			return undefined;
		}
	}
	try {
		const id = Buffer.from(name, "base64url").toString("utf8");
		if (id.length > 0 && Buffer.from(id, "utf8").toString("base64url") === name) {
			return { id, scheme: "base64url" };
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function allocateDirectories(resources: readonly LegacyResource[]): Record<string, string> {
	const result: Record<string, string> = {};
	const ids = new Set<string>();
	const directories = new Set<string>();
	for (const resource of resources) {
		if (ids.has(resource.id)) throw new Error(`Duplicate Agent Team resource id during migration: ${resource.id}`);
		ids.add(resource.id);
		const directory = createAgentTeamStorageKey(resource.name, resource.id);
		const normalized = directory.toLocaleLowerCase("en-US");
		if (directories.has(normalized)) throw new Error(`Duplicate Agent Team storage directory: ${directory}`);
		directories.add(normalized);
		result[resource.id] = directory;
	}
	return result;
}

async function preflightMoves(moves: readonly StorageMove[]): Promise<void> {
	const targets = new Set<string>();
	for (const move of moves) {
		const source = resolve(move.source);
		const target = resolve(move.target);
		if (source === target) continue;
		const normalizedTarget = normalizePath(target);
		if (targets.has(normalizedTarget)) throw new Error(`Duplicate Agent Team migration target: ${target}`);
		targets.add(normalizedTarget);
		if (existsSync(source) && existsSync(target)) {
			throw new Error(`Agent Team migration target already exists: ${target}`);
		}
	}
}

async function moveDirectory(move: StorageMove): Promise<void> {
	const source = resolve(move.source);
	const target = resolve(move.target);
	if (source === target || !existsSync(source)) return;
	if (existsSync(target)) throw new Error(`Agent Team migration target already exists: ${target}`);
	await mkdir(dirname(target), { recursive: true });
	await rename(source, target);
	await removeEmptyParents(dirname(source), dirname(dirname(source)));
}

async function removeEmptyParents(start: string, boundary: string): Promise<void> {
	let current = resolve(start);
	const stop = resolve(boundary);
	while (current !== stop && isWithin(stop, current)) {
		try {
			if ((await readdir(current)).length > 0) return;
			await rmdir(current);
		} catch (error) {
			if (nodeErrorCode(error) !== "ENOENT") return;
		}
		current = dirname(current);
	}
}

async function rewritePersistedReferences(
	root: string,
	pathMappings: readonly PathMapping[],
	idMappings: Readonly<Record<string, string>>,
): Promise<void> {
	if (pathMappings.length === 0 && Object.keys(idMappings).length === 0) return;
	const vettaHome = dirname(root);
	const candidates = [
		agentTeamDefinitionsRoot(root),
		agentTeamAgentsRoot(root),
		agentTeamWorkspacesRoot(root),
		join(root, ORPHANED_DIRECTORY),
		...pathMappings.map((mapping) => mapping.target),
		join(vettaHome, "desktop-app", "agent-teams", "sessions"),
		join(vettaHome, "conversation-ownership.v1.json"),
	];
	for (const candidate of new Set(candidates)) await rewriteReferences(candidate, pathMappings, idMappings);
}

async function rewriteReferences(
	path: string,
	pathMappings: readonly PathMapping[],
	idMappings: Readonly<Record<string, string>>,
): Promise<void> {
	if (!existsSync(path)) return;
	const entries = await readdirIfDirectory(path);
	if (entries) {
		for (const entry of entries) await rewriteReferences(join(path, entry.name), pathMappings, idMappings);
		return;
	}
	if (!path.endsWith(".json") && !path.endsWith(".jsonl")) return;
	const source = await readFile(path, "utf8");
	const trailingNewline = source.endsWith("\n");
	const lines = path.endsWith(".jsonl") ? source.split(/\r?\n/u).filter((line) => line.length > 0) : [source];
	let changed = false;
	const rewritten = lines.map((line) => {
		const value: unknown = JSON.parse(line);
		const result = rewriteStructuredValue(value, pathMappings, idMappings);
		changed ||= result.changed;
		return JSON.stringify(result.value);
	});
	if (!changed) return;
	await atomicWriteFileAsync(path, `${rewritten.join("\n")}${trailingNewline ? "\n" : ""}`);
}

function rewriteStructuredValue(
	value: unknown,
	pathMappings: readonly PathMapping[],
	idMappings: Readonly<Record<string, string>>,
	field?: string,
): { readonly value: unknown; readonly changed: boolean } {
	if (typeof value === "string") {
		const migratedId = idMappings[value] ?? migrateLegacyReference(value);
		if (migratedId !== value && field !== undefined && isIdentityReferenceField(field)) {
			return { value: migratedId, changed: true };
		}
		if (!field || !PATH_FIELDS.has(field)) return { value, changed: false };
		const rewritten = rewritePath(value, pathMappings);
		return { value: rewritten, changed: rewritten !== value };
	}
	if (Array.isArray(value)) {
		let changed = false;
		const items = value.map((item) => {
			const result = rewriteStructuredValue(item, pathMappings, idMappings, field);
			changed ||= result.changed;
			return result.value;
		});
		return { value: changed ? items : value, changed };
	}
	if (!isRecord(value)) return { value, changed: false };
	let changed = false;
	const result: Record<string, unknown> = {};
	const migrateKeys = field !== undefined && ID_KEYED_FIELDS.has(field);
	for (const [key, item] of Object.entries(value)) {
		if (RETIRED_STORAGE_FIELDS.has(key)) {
			changed = true;
			continue;
		}
		const migratedKey = migrateKeys ? (idMappings[key] ?? migrateLegacyReference(key)) : key;
		if (Object.hasOwn(result, migratedKey)) {
			throw new Error(`Duplicate Agent Team reference after migration: ${migratedKey}`);
		}
		const rewritten = rewriteStructuredValue(item, pathMappings, idMappings, key);
		changed ||= migratedKey !== key || rewritten.changed;
		result[migratedKey] = rewritten.value;
	}
	return { value: changed ? result : value, changed };
}

function rewritePath(value: string, mappings: readonly PathMapping[]): string {
	for (const mapping of mappings) {
		if (samePath(value, mapping.source)) return mapping.target;
		const suffix = relative(mapping.source, value);
		if (suffix.length > 0 && suffix !== ".." && !suffix.startsWith(`..${sep}`)) {
			return join(mapping.target, suffix);
		}
	}
	return value;
}

async function readdirIfDirectory(path: string): Promise<readonly Dirent[] | undefined> {
	try {
		return await readdir(path, { withFileTypes: true });
	} catch (error) {
		if (nodeErrorCode(error) === "ENOTDIR") return undefined;
		if (nodeErrorCode(error) === "ENOENT") return [];
		throw error;
	}
}

function parseMigrationJournal(value: unknown): AgentTeamStorageMigrationJournal {
	if (!isRecord(value) || value.layoutVersion !== AGENT_TEAM_STORAGE_LAYOUT_VERSION) {
		throw new Error("Invalid Agent Team storage migration journal");
	}
	const index = parseStorageIndexValue(value.index);
	const moves = parsePairs(value.moves, "move").map(({ source, target }) => ({ source, target }));
	const pathMappings = parsePairs(value.pathMappings, "path mapping").map(({ source, target }) => ({
		source,
		target,
	}));
	const idMappings = parseStringMap(value.idMappings, "id mapping");
	return { layoutVersion: AGENT_TEAM_STORAGE_LAYOUT_VERSION, index, moves, pathMappings, idMappings };
}

function parseStorageIndexValue(value: unknown): AgentTeamStorageIndex {
	if (!isRecord(value) || value.layoutVersion !== AGENT_TEAM_STORAGE_LAYOUT_VERSION) {
		throw new Error("Invalid Agent Team storage migration index");
	}
	if (value.schemaVersion !== 1 || !isNonNegativeInteger(value.revision)) {
		throw new Error("Invalid Agent Team storage migration metadata");
	}
	return {
		schemaVersion: 1,
		revision: value.revision,
		layoutVersion: AGENT_TEAM_STORAGE_LAYOUT_VERSION,
		teams: parseDirectoryMap(value.teams, "team"),
		agents: parseDirectoryMap(value.agents, "agent"),
	};
}

function parsePairs(value: unknown, label: string): Array<{ readonly source: string; readonly target: string }> {
	if (!Array.isArray(value)) throw new Error(`Invalid Agent Team storage migration ${label} list`);
	return value.map((item) => {
		if (!isRecord(item) || typeof item.source !== "string" || typeof item.target !== "string") {
			throw new Error(`Invalid Agent Team storage migration ${label}`);
		}
		return { source: item.source, target: item.target };
	});
}

function parseDirectoryMap(value: unknown, label: string): Record<string, string> {
	if (!isRecord(value)) throw new Error(`Invalid Agent Team ${label} directory map`);
	const result: Record<string, string> = {};
	const directories = new Set<string>();
	for (const [id, directory] of Object.entries(value)) {
		if (id.length === 0 || typeof directory !== "string") throw new Error(`Invalid Agent Team ${label} directory`);
		assertStorageDirectory(directory);
		const normalized = directory.toLocaleLowerCase("en-US");
		if (directories.has(normalized)) throw new Error(`Duplicate Agent Team ${label} directory: ${directory}`);
		directories.add(normalized);
		result[id] = directory;
	}
	return result;
}

function parseStringMap(value: unknown, label: string): Record<string, string> {
	if (!isRecord(value)) throw new Error(`Invalid Agent Team storage migration ${label}`);
	const result: Record<string, string> = {};
	for (const [key, replacement] of Object.entries(value)) {
		if (key.length === 0 || typeof replacement !== "string" || replacement.length === 0) {
			throw new Error(`Invalid Agent Team storage migration ${label}`);
		}
		result[key] = replacement;
	}
	return result;
}

function parseLegacyResource(value: Record<string, unknown>, directory: string, label: string): LegacyResource {
	if (typeof value.id !== "string" || typeof value.name !== "string") {
		throw new Error(`Invalid legacy Agent Team ${label} resource: ${directory}`);
	}
	return { id: migrateLegacyId(value.id), name: value.name, directory };
}

function migrateLegacyId(id: string): string {
	const replacement = LEGACY_ID_MAPPINGS[id];
	if (replacement !== undefined) return replacement;
	if (!/^builtin:(?:agent|team|member):/u.test(id)) return id;
	const digest = createHash("sha256").update(`open-vetta:retired-agent-team-id:${id}`, "utf8").digest("hex");
	const variant = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function migrateLegacyReference(value: string): string {
	const exact = migrateLegacyId(value);
	if (exact !== value) return exact;
	let migrated = value;
	for (const [legacyId, replacement] of LEGACY_EMBEDDED_ID_MAPPINGS) {
		migrated = migrated.replaceAll(legacyId, replacement);
	}
	if (migrated !== value) return migrated;
	const teamPrefix = "agent-team:";
	if (/^agent-team:builtin:team:[^:]+$/u.test(value)) {
		return `${teamPrefix}${migrateLegacyId(value.slice(teamPrefix.length))}`;
	}
	return value;
}

function isIdentityReferenceField(field: string): boolean {
	return field === "id" || field === "copiedFrom" || field.endsWith("Id") || field.endsWith("Ids");
}

async function readOptionalJson(path: string): Promise<Record<string, unknown> | undefined> {
	try {
		const value: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isRecord(value)) throw new Error(`Invalid Agent Team resource manifest: ${path}`);
		return value;
	} catch (error) {
		if (nodeErrorCode(error) === "ENOENT") return undefined;
		throw error;
	}
}

function assertStorageDirectory(directory: string): string {
	if (
		directory.length === 0 ||
		directory === "." ||
		directory === ".." ||
		directory.includes("/") ||
		directory.includes("\\") ||
		directory.endsWith(".") ||
		directory.endsWith(" ")
	) {
		throw new Error(`Invalid Agent Team storage directory: ${directory}`);
	}
	return directory;
}

function distinctMoves(moves: readonly StorageMove[]): StorageMove[] {
	const seen = new Set<string>();
	return moves.filter((move) => {
		const key = `${normalizePath(move.source)}\0${normalizePath(move.target)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function distinctMappings(mappings: readonly PathMapping[]): PathMapping[] {
	const seen = new Set<string>();
	return mappings.filter((mapping) => {
		const key = normalizePath(mapping.source);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function workspacePriority(workspace: LegacyWorkspace): number {
	if (workspace.scheme === "base64url") return 3;
	if (workspace.scheme === "team-directory") return 2;
	return 1;
}

function legacySafeName(value: string): string {
	return encodeURIComponent(value).replace(/%/gu, "_");
}

function isReservedRootDirectory(name: string): boolean {
	return [
		AGENT_TEAM_TEAMS_DIRECTORY,
		AGENT_TEAM_AGENTS_DIRECTORY,
		AGENT_TEAM_WORKSPACES_DIRECTORY,
		AGENT_TEAM_SESSION_WORKSPACES_DIRECTORY,
		ORPHANED_DIRECTORY,
	].includes(name);
}

function truncateCodePoints(value: string, maximum: number): string {
	return [...value].slice(0, maximum).join("");
}

function normalizePath(path: string): string {
	const normalized = resolve(path);
	return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function samePath(left: string, right: string): boolean {
	return normalizePath(left) === normalizePath(right);
}

function isWithin(root: string, candidate: string): boolean {
	const path = relative(root, candidate);
	return path.length === 0 || (path !== ".." && !path.startsWith(`..${sep}`));
}

function isLayoutVersionError(error: unknown): boolean {
	return error instanceof Error && error.message === "Agent Team storage has not been migrated to layout version 2";
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodeErrorCode(error: unknown): string | undefined {
	return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}
