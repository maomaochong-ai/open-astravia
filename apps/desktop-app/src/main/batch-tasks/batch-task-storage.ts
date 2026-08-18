import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SessionExecutionMode } from "@vetta/runtime-core";
import { type ExecutionModeOverride, normalizeExecutionModeOverride } from "../execution-mode.js";
import { type DesktopConfig, type ProjectEntry, readDesktopConfig, writeDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { type BatchTaskState, type BatchTaskStatus, loadProjectTaskStates } from "./batch-task-state";

export type { BatchTaskStatus } from "./batch-task-state";

// ─── meta.json structures ───

interface BatchItemMeta {
	id: string;
	name: string;
	sourcePath: string;
	createdAt: number;
}

export interface BatchSkillRef {
	name: string;
	alias?: string;
	type: "skill" | "scene";
}

interface BatchProjectMeta {
	type: "batch";
	prompt: string;
	modelKey?: string;
	concurrency: number;
	executionMode?: ExecutionModeOverride;
	artifactPatterns?: string[];
	/** When true, broadcast a webhook message after each subtask finalizes and once when the project as a whole finishes. */
	notifyEnabled?: boolean;
	/** Per-task hard timeout in minutes. Used by executor's scheduleTimeout. Defaults to 60. */
	timeoutMinutes?: number;
	skill?: BatchSkillRef;
	items: BatchItemMeta[];
	createdAt: number;
	updatedAt: number;
}

// ─── Exported types ───

export interface BatchTask {
	id: string;
	name: string;
	cwd: string;
	sourcePath: string;
	status: BatchTaskStatus;
	sessionId?: string;
	sessionPath?: string;
	executionMode?: SessionExecutionMode;
	error?: string;
	createdAt: number;
	updatedAt: number;
}

export interface BatchProject {
	id: string;
	name: string;
	prompt: string;
	modelKey?: string;
	concurrency: number;
	executionMode?: ExecutionModeOverride;
	artifactPatterns?: string[];
	notifyEnabled?: boolean;
	timeoutMinutes?: number;
	skill?: BatchSkillRef;
	tasks: BatchTask[];
	createdAt: number;
	updatedAt: number;
}

export const DEFAULT_BATCH_TIMEOUT_MINUTES = 60;

const log = getAppLogger("batch-storage");

// ─── Internal helpers ───

function metaPath(projectDir: string): string {
	return join(projectDir, ".vetta", "meta.json");
}

async function readProjectMeta(projectDir: string): Promise<BatchProjectMeta | null> {
	try {
		const raw = await readFile(metaPath(projectDir), "utf-8");
		const parsed = JSON.parse(raw) as BatchProjectMeta & { pausedAt?: number };
		if (parsed.type !== "batch") return null;
		// 历史 meta 可能残留 pausedAt（已废弃的项目级暂停标志）。直接剥离，
		// 避免回写时再持久化进新 meta。
		if ("pausedAt" in parsed) {
			delete parsed.pausedAt;
		}
		return parsed;
	} catch {
		return null;
	}
}

async function writeProjectMeta(projectDir: string, meta: BatchProjectMeta): Promise<void> {
	const dir = join(projectDir, ".vetta");
	await mkdir(dir, { recursive: true });
	await writeFile(metaPath(projectDir), JSON.stringify(meta, null, 2), "utf-8");
}

async function uniqueItemName(projectDir: string, baseName: string): Promise<string> {
	let name = baseName;
	let counter = 2;
	const existing = new Set<string>();
	try {
		const entries = await readdir(projectDir);
		for (const e of entries) existing.add(e);
	} catch {
		// directory may not exist yet
	}
	while (existing.has(name)) {
		name = `${baseName}-${counter}`;
		counter++;
	}
	return name;
}

function assembleProject(
	projectDir: string,
	meta: BatchProjectMeta,
	states: Record<string, BatchTaskState>,
): BatchProject {
	const tasks: BatchTask[] = meta.items.map((item) => {
		const state: BatchTaskState | undefined = states[item.id];
		return {
			id: item.id,
			name: item.name,
			cwd: join(projectDir, item.name),
			sourcePath: item.sourcePath,
			status: state?.status ?? "pending",
			sessionId: state?.sessionId,
			sessionPath: state?.sessionPath,
			executionMode: state?.executionMode,
			error: state?.error,
			createdAt: item.createdAt,
			updatedAt: state?.lastModified ?? item.createdAt,
		};
	});

	return {
		id: projectDir,
		name: basename(projectDir),
		prompt: meta.prompt,
		modelKey: meta.modelKey,
		concurrency: meta.concurrency,
		executionMode: normalizeExecutionModeOverride(meta.executionMode, "full-access"),
		artifactPatterns: meta.artifactPatterns,
		notifyEnabled: meta.notifyEnabled ?? false,
		timeoutMinutes: meta.timeoutMinutes ?? DEFAULT_BATCH_TIMEOUT_MINUTES,
		skill: meta.skill,
		tasks,
		createdAt: meta.createdAt,
		updatedAt: meta.updatedAt,
	};
}

// ─── Config registration ───
//
// Source of truth for sidebar visibility is `desktop-config.json:projects`.
// Each batch project is also registered there as `{ path, name }`. Workspace
// directory is no longer the registration boundary — it is only used as a
// migration source: any unregistered batch project found under it is
// auto-imported on next discovery (idempotent), so older installs and
// hand-edited workspaces keep working.

async function registerProjectInConfig(projectPath: string, name: string): Promise<void> {
	const config = await readDesktopConfig();
	if (config.projects.some((p) => p.path === projectPath)) return;
	if (config.archivedProjects.some((p) => p.path === projectPath)) return;
	await writeDesktopConfig({
		...config,
		projects: [...config.projects, { path: projectPath, name }],
	});
}

async function unregisterProjectFromConfig(projectPath: string): Promise<void> {
	const config = await readDesktopConfig();
	const projects = config.projects.filter((p) => p.path !== projectPath);
	const archivedProjects = config.archivedProjects.filter((p) => p.path !== projectPath);
	if (projects.length === config.projects.length && archivedProjects.length === config.archivedProjects.length) {
		return;
	}
	await writeDesktopConfig({ ...config, projects, archivedProjects });
}

/**
 * Backfill desktop-config.json with any batch project whose `.vetta/meta.json`
 * exists under `workspacePath` but isn't registered yet (active or archived).
 * Idempotent: safe to call on every discover.
 */
async function autoRegisterLooseBatchProjects(config: DesktopConfig): Promise<DesktopConfig> {
	const entries = await readdir(config.workspacePath, { withFileTypes: true }).catch(() => null);
	if (!entries) return config; // workspace dir doesn't exist yet

	const known = new Set<string>();
	for (const p of config.projects) known.add(p.path);
	for (const p of config.archivedProjects) known.add(p.path);

	const additions: ProjectEntry[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const projectDir = join(config.workspacePath, entry.name);
		if (known.has(projectDir)) continue;
		const meta = await readProjectMeta(projectDir);
		if (meta?.type !== "batch") continue;
		additions.push({ path: projectDir, name: entry.name });
	}
	if (additions.length === 0) return config;

	log.info(`auto-registering ${additions.length} loose batch project(s) into config`);
	const next: DesktopConfig = {
		...config,
		projects: [...config.projects, ...additions],
	};
	await writeDesktopConfig(next);
	return next;
}

// ─── Public API ───

export async function discoverBatchProjects(): Promise<string[]> {
	let config = await readDesktopConfig();
	config = await autoRegisterLooseBatchProjects(config);
	const result: string[] = [];
	for (const entry of config.projects) {
		const meta = await readProjectMeta(entry.path);
		if (meta?.type === "batch") result.push(entry.path);
	}
	return result;
}

export async function loadProjects(): Promise<BatchProject[]> {
	try {
		const projectDirs = await discoverBatchProjects();
		const projects: BatchProject[] = [];
		for (const projectDir of projectDirs) {
			const meta = await readProjectMeta(projectDir);
			if (!meta) continue;
			if (!meta.concurrency) meta.concurrency = 1;
			const states = await loadProjectTaskStates(projectDir);
			projects.push(assembleProject(projectDir, meta, states));
		}
		return projects;
	} catch (error) {
		log.error(`loadProjects failed: ${error instanceof Error ? error.message : String(error)}`);
		return [];
	}
}

export async function createProject(
	name: string,
	prompt: string,
	modelKey: string | undefined,
	folders: string[],
	concurrency: number,
	executionMode?: ExecutionModeOverride,
	artifactPatterns?: string[],
	notifyEnabled?: boolean,
	timeoutMinutes?: number,
	skill?: BatchSkillRef,
): Promise<BatchProject> {
	const config = await readDesktopConfig();
	const projectDir = join(config.workspacePath, name);
	await mkdir(projectDir, { recursive: true });

	const now = Date.now();
	const items: BatchItemMeta[] = [];

	for (const sourcePath of folders) {
		const baseName = basename(sourcePath);
		const itemName = await uniqueItemName(projectDir, baseName);
		const itemDir = join(projectDir, itemName);
		await mkdir(itemDir, { recursive: true });
		items.push({
			id: `batch-task-${now}-${items.length}-${Math.random().toString(36).slice(2, 11)}`,
			name: itemName,
			sourcePath,
			createdAt: now,
		});
	}

	const meta: BatchProjectMeta = {
		type: "batch",
		prompt,
		modelKey,
		concurrency,
		executionMode: normalizeExecutionModeOverride(executionMode, "full-access"),
		artifactPatterns: artifactPatterns && artifactPatterns.length > 0 ? artifactPatterns : undefined,
		notifyEnabled: notifyEnabled || undefined,
		timeoutMinutes:
			timeoutMinutes && timeoutMinutes > 0 && timeoutMinutes !== DEFAULT_BATCH_TIMEOUT_MINUTES
				? timeoutMinutes
				: undefined,
		skill,
		items,
		createdAt: now,
		updatedAt: now,
	};

	await writeProjectMeta(projectDir, meta);
	// Ensure sessions directory exists
	await mkdir(join(projectDir, ".vetta", "sessions"), { recursive: true });

	// Register in desktop-config so the sidebar picks it up. Best-effort: if
	// the config write fails, the next discoverBatchProjects call will
	// auto-register it via autoRegisterLooseBatchProjects.
	try {
		await registerProjectInConfig(projectDir, name);
	} catch (error) {
		log.warn(
			`createProject: failed to register ${projectDir} in config (will auto-recover): ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	log.info(`createProject: ${projectDir}(${name}), tasks=${items.length}, concurrency=${concurrency}`);

	return assembleProject(projectDir, meta, {});
}

export async function updateProject(
	projectDir: string,
	data: Partial<{
		name: string;
		prompt: string;
		modelKey: string;
		concurrency: number;
		executionMode: ExecutionModeOverride;
		artifactPatterns: string[];
		notifyEnabled: boolean;
		timeoutMinutes: number;
		newFolders: string[];
		skill: BatchSkillRef | null;
	}>,
): Promise<void> {
	const meta = await readProjectMeta(projectDir);
	if (!meta) return;

	if (data.prompt !== undefined) meta.prompt = data.prompt;
	if (data.modelKey !== undefined) meta.modelKey = data.modelKey;
	if (data.concurrency !== undefined) meta.concurrency = data.concurrency;
	if (data.executionMode !== undefined) meta.executionMode = normalizeExecutionModeOverride(data.executionMode);
	if (data.artifactPatterns !== undefined) {
		meta.artifactPatterns = data.artifactPatterns.length > 0 ? data.artifactPatterns : undefined;
	}
	if (data.notifyEnabled !== undefined) {
		meta.notifyEnabled = data.notifyEnabled || undefined;
	}
	if (data.timeoutMinutes !== undefined) {
		meta.timeoutMinutes =
			data.timeoutMinutes > 0 && data.timeoutMinutes !== DEFAULT_BATCH_TIMEOUT_MINUTES
				? data.timeoutMinutes
				: undefined;
	}
	if (data.skill !== undefined) {
		meta.skill = data.skill ?? undefined;
	}

	if (data.newFolders) {
		const now = Date.now();
		const existingSources = new Set(meta.items.map((item) => item.sourcePath));
		for (const sourcePath of data.newFolders) {
			if (existingSources.has(sourcePath)) continue;
			const baseName = basename(sourcePath);
			const itemName = await uniqueItemName(projectDir, baseName);
			const itemDir = join(projectDir, itemName);
			await mkdir(itemDir, { recursive: true });
			meta.items.push({
				id: `batch-task-${now}-${meta.items.length}-${Math.random().toString(36).slice(2, 11)}`,
				name: itemName,
				sourcePath,
				createdAt: now,
			});
		}
	}

	meta.updatedAt = Date.now();
	await writeProjectMeta(projectDir, meta);
}

export async function deleteProject(projectDir: string): Promise<void> {
	log.info(`deleteProject: ${projectDir}`);
	// Unregister first so the sidebar drops it even if disk removal fails
	// (e.g. external file lock). On a partial failure, the user can retry.
	try {
		await unregisterProjectFromConfig(projectDir);
	} catch (error) {
		log.warn(
			`deleteProject: failed to unregister ${projectDir} from config: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	await rm(projectDir, { recursive: true, force: true });
}

export async function getProject(projectDir: string): Promise<BatchProject | undefined> {
	const meta = await readProjectMeta(projectDir);
	if (!meta) return undefined;
	if (!meta.concurrency) meta.concurrency = 1;
	const states = await loadProjectTaskStates(projectDir);
	return assembleProject(projectDir, meta, states);
}

export async function addTaskToProject(projectDir: string, sourcePath: string): Promise<BatchTask | undefined> {
	const meta = await readProjectMeta(projectDir);
	if (!meta) return undefined;

	const now = Date.now();
	const baseName = basename(sourcePath);
	const itemName = await uniqueItemName(projectDir, baseName);
	const itemDir = join(projectDir, itemName);
	await mkdir(itemDir, { recursive: true });

	const item: BatchItemMeta = {
		id: `batch-task-${now}-${Math.random().toString(36).slice(2, 11)}`,
		name: itemName,
		sourcePath,
		createdAt: now,
	};
	meta.items.push(item);
	meta.updatedAt = now;
	await writeProjectMeta(projectDir, meta);

	return {
		id: item.id,
		name: item.name,
		cwd: itemDir,
		sourcePath: item.sourcePath,
		status: "pending",
		createdAt: now,
		updatedAt: now,
	};
}

export async function removeTaskFromProject(projectDir: string, taskId: string): Promise<void> {
	const meta = await readProjectMeta(projectDir);
	if (!meta) return;

	const item = meta.items.find((i) => i.id === taskId);
	if (item) {
		// Remove item subdirectory
		const itemDir = join(projectDir, item.name);
		await rm(itemDir, { recursive: true, force: true }).catch(() => {});
	}

	meta.items = meta.items.filter((i) => i.id !== taskId);
	meta.updatedAt = Date.now();
	await writeProjectMeta(projectDir, meta);
}

export async function resetTaskFiles(projectDir: string, taskId: string): Promise<void> {
	const meta = await readProjectMeta(projectDir);
	if (!meta) return;
	const item = meta.items.find((i) => i.id === taskId);
	if (!item) return;
	const itemDir = join(projectDir, item.name);
	await rm(itemDir, { recursive: true, force: true });
	await mkdir(itemDir, { recursive: true });
}

export async function resetProjectFiles(projectDir: string): Promise<void> {
	const meta = await readProjectMeta(projectDir);
	if (!meta) return;

	// Delete everything in projectDir except .vetta/meta.json
	const entries = await readdir(projectDir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(projectDir, entry.name);
		if (entry.name === ".vetta") {
			// Inside .vetta, delete everything except meta.json
			const vettaEntries = await readdir(fullPath);
			for (const ve of vettaEntries) {
				if (ve === "meta.json") continue;
				await rm(join(fullPath, ve), { recursive: true, force: true });
			}
		} else {
			await rm(fullPath, { recursive: true, force: true });
		}
	}

	// Rebuild empty item directories and sessions directory
	for (const item of meta.items) {
		await mkdir(join(projectDir, item.name), { recursive: true });
	}
	await mkdir(join(projectDir, ".vetta", "sessions"), { recursive: true });
}

export function generateTaskId(): string {
	return `batch-task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
