import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionExecutionMode } from "@vetta/runtime-core";
import { getAppLogger } from "../logger.js";
import { discoverBatchProjects } from "./batch-task-storage";

const log = getAppLogger("batch-state");

export type BatchTaskStatus = "pending" | "running" | "completed" | "failed" | "paused";

export interface BatchTaskState {
	taskId: string;
	status: BatchTaskStatus;
	sessionId?: string;
	sessionPath?: string;
	executionMode?: SessionExecutionMode;
	error?: string;
	startedAt?: number;
	completedAt?: number;
	lastModified: number;
}

export type ProjectTaskStates = Record<string, BatchTaskState>;

// ─── Per-project cache ───

const cachedStates = new Map<string, ProjectTaskStates>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function statesPath(projectDir: string): string {
	return join(projectDir, ".vetta", "task-states.json");
}

export async function loadProjectTaskStates(projectDir: string): Promise<ProjectTaskStates> {
	const cached = cachedStates.get(projectDir);
	if (cached) return cached;

	let states: ProjectTaskStates = {};
	try {
		const data = await readFile(statesPath(projectDir), "utf-8");
		states = JSON.parse(data) as ProjectTaskStates;
	} catch {
		// file doesn't exist yet
	}
	cachedStates.set(projectDir, states);
	return states;
}

async function saveProjectTaskStates(projectDir: string, states: ProjectTaskStates): Promise<void> {
	const dir = join(projectDir, ".vetta");
	await mkdir(dir, { recursive: true });
	await writeFile(statesPath(projectDir), JSON.stringify(states, null, 2), "utf-8");
}

function scheduleFlush(projectDir: string): void {
	if (saveTimers.has(projectDir)) return;
	const timer = setTimeout(async () => {
		saveTimers.delete(projectDir);
		const states = cachedStates.get(projectDir);
		if (states) {
			await saveProjectTaskStates(projectDir, states);
		}
	}, 50);
	saveTimers.set(projectDir, timer);
}

export async function getTaskState(projectDir: string, taskId: string): Promise<BatchTaskState | undefined> {
	const states = await loadProjectTaskStates(projectDir);
	return states[taskId];
}

export async function saveTaskState(projectDir: string, taskId: string, state: BatchTaskState): Promise<void> {
	const states = await loadProjectTaskStates(projectDir);
	states[taskId] = state;
	log.debug(`State scheduled to save: project=${projectDir}, task=${taskId}, status=${state.status}`);
	scheduleFlush(projectDir);
}

export async function deleteTaskState(projectDir: string, taskId: string): Promise<void> {
	const states = await loadProjectTaskStates(projectDir);
	delete states[taskId];
	scheduleFlush(projectDir);
}

export async function clearAllTaskStates(projectDir: string): Promise<void> {
	cachedStates.set(projectDir, {});
	scheduleFlush(projectDir);
}

export async function updateTaskState(
	projectDir: string,
	taskId: string,
	patch: Partial<BatchTaskState>,
): Promise<void> {
	const states = await loadProjectTaskStates(projectDir);
	if (states[taskId]) {
		states[taskId] = {
			...states[taskId],
			...patch,
			lastModified: Date.now(),
		};
		scheduleFlush(projectDir);
	}
}

export async function recoverRunningTasks(): Promise<void> {
	log.info(`recoverRunningTasks: checking for stale running tasks`);
	const projectDirs = await discoverBatchProjects();
	let modified = false;

	for (const projectDir of projectDirs) {
		const states = await loadProjectTaskStates(projectDir);
		let projectModified = false;

		for (const taskId of Object.keys(states)) {
			const state = states[taskId];
			if (state.status === "running") {
				log.warn(`Recovering stale task ${taskId} (project ${projectDir})`);
				state.status = "failed";
				state.error = "应用异常退出";
				state.completedAt = Date.now();
				state.lastModified = Date.now();
				projectModified = true;
				modified = true;
			}
		}

		if (projectModified) {
			await saveProjectTaskStates(projectDir, states);
		}
	}

	if (modified) {
		log.info(`Stale tasks recovered and saved`);
	} else {
		log.info(`No stale running tasks found`);
	}
}
