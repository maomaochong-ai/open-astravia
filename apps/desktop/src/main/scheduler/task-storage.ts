import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { SessionExecutionMode } from "@vetta/runtime-core";
import { type ExecutionModeOverride, normalizeExecutionModeOverride } from "../execution-mode.js";

const CONFIG_DIR = getVettaHomePath();
const TASKS_FILE = join(CONFIG_DIR, "scheduled-tasks.json");
const RECORDS_DIR = join(CONFIG_DIR, "task-records");

export interface ScheduledTaskSkillRef {
	name: string;
	alias?: string;
	type: "skill" | "scene";
}

export interface ScheduledTask {
	id: string;
	name: string;
	prompt: string;
	cron: string;
	isOnce: boolean;
	enabled: boolean;
	/** Working directory used when the task executes */
	cwd: string;
	modelKey?: string;
	executionMode?: ExecutionModeOverride;
	skill?: ScheduledTaskSkillRef;
	createdAt: number;
	updatedAt: number;
	lastRunAt: number | null;
	lastRunStatus: "success" | "failed" | null;
}

export interface TaskExecutionRecord {
	id: string;
	taskId: string;
	sessionId: string;
	/** Session file path for navigating to the conversation */
	sessionPath?: string;
	/** Working directory used for this execution */
	cwd?: string;
	startedAt: number;
	completedAt: number | null;
	status: "running" | "success" | "failed" | "aborted";
	prompt: string;
	responsePreview: string;
	error?: string;
	durationMs?: number;
	executionMode?: SessionExecutionMode;
}

async function ensureDirectories(): Promise<void> {
	await mkdir(CONFIG_DIR, { recursive: true });
	await mkdir(RECORDS_DIR, { recursive: true });
}

/** 回填旧任务缺失字段，归一 executionMode。 */
function backfillTasks(tasks: ScheduledTask[]): ScheduledTask[] {
	for (const task of tasks) {
		if (!("isOnce" in task)) {
			(task as ScheduledTask).isOnce = false;
		}
		if (!("cwd" in task)) {
			(task as ScheduledTask).cwd = join(getVettaHomePath(), "workspace");
		}
		task.executionMode = normalizeExecutionModeOverride(task.executionMode, "full-access");
	}
	return tasks;
}

/**
 * 从可能带尾部垃圾的文本里截出「第一个完整的顶层 JSON 数组」。
 * 用于自愈并发写残留（如多一个 `]`）导致的损坏文件，避免任务静默丢失。
 */
function extractFirstJsonArray(s: string): string | null {
	const start = s.indexOf("[");
	if (start === -1) return null;
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (let i = start; i < s.length; i++) {
		const c = s[i];
		if (inStr) {
			if (esc) esc = false;
			else if (c === "\\") esc = true;
			else if (c === '"') inStr = false;
			continue;
		}
		if (c === '"') inStr = true;
		else if (c === "[") depth++;
		else if (c === "]") {
			depth--;
			if (depth === 0) return s.slice(start, i + 1);
		}
	}
	return null;
}

export async function loadTasks(): Promise<ScheduledTask[]> {
	let data: string;
	try {
		await ensureDirectories();
		data = await readFile(TASKS_FILE, "utf-8");
	} catch {
		// 文件不存在（首次运行）等：视为空列表。
		return [];
	}
	try {
		return backfillTasks(JSON.parse(data) as ScheduledTask[]);
	} catch {
		// 文件损坏（曾因并发写出现尾部多余 `]`）：尝试截出首个完整数组自愈，
		// 救回任务并原子重写干净文件，避免被后续写入静默覆盖丢数据。
		const recovered = extractFirstJsonArray(data);
		if (recovered) {
			try {
				const tasks = backfillTasks(JSON.parse(recovered) as ScheduledTask[]);
				await saveTasks(tasks).catch(() => {});
				return tasks;
			} catch {
				// fall through
			}
		}
		// 实在无法恢复：备份损坏文件后返回空，至少不让原始数据被覆盖。
		await rename(TASKS_FILE, `${TASKS_FILE}.corrupt-${Date.now()}`).catch(() => {});
		return [];
	}
}

// 串行化任务文件写入：多处（updateTaskLastRun / updateTaskEnabled / createTask 等）
// 可能在任务执行收尾时并发写同一文件，非原子写会互相截断导致 JSON 损坏。
let saveChain: Promise<void> = Promise.resolve();
let mutationChain: Promise<void> = Promise.resolve();

export async function saveTasks(tasks: ScheduledTask[]): Promise<void> {
	const run = async (): Promise<void> => {
		await ensureDirectories();
		const normalized = tasks.map((task) => ({
			...task,
			executionMode: normalizeExecutionModeOverride(task.executionMode, "full-access"),
		}));
		// 写临时文件后 rename：rename 在同一文件系统是原子操作，杜绝半截写入。
		const tmp = `${TASKS_FILE}.tmp-${process.pid}-${Date.now()}`;
		await writeFile(tmp, JSON.stringify(normalized, null, 2), "utf-8");
		await rename(tmp, TASKS_FILE);
	};
	saveChain = saveChain.then(run, run);
	return saveChain;
}

export async function mutateTasks<T>(mutate: (tasks: ScheduledTask[]) => T | Promise<T>): Promise<T> {
	let result!: T;
	const run = async (): Promise<void> => {
		const tasks = await loadTasks();
		result = await mutate(tasks);
		await saveTasks(tasks);
	};
	mutationChain = mutationChain.then(run, run);
	await mutationChain;
	return result;
}

function getTaskRecordsDir(taskId: string): string {
	return join(RECORDS_DIR, taskId);
}

function getRecordFilePath(taskId: string, sessionId: string): string {
	return join(RECORDS_DIR, taskId, `${sessionId}.jsonl`);
}

export async function loadRecords(taskId: string): Promise<TaskExecutionRecord[]> {
	const taskDir = getTaskRecordsDir(taskId);
	if (!existsSync(taskDir)) {
		return [];
	}

	const records: TaskExecutionRecord[] = [];

	try {
		const files = await readdir(taskDir);
		for (const file of files) {
			if (!file.endsWith(".jsonl")) continue;
			const filePath = join(taskDir, file);
			try {
				const content = await readFile(filePath, "utf-8");
				const lines = content.trim().split("\n").filter(Boolean);
				if (lines.length > 0) {
					const record = JSON.parse(lines[0]) as TaskExecutionRecord;
					records.push(record);
				}
			} catch {
				// skip malformed files
			}
		}
	} catch {
		return [];
	}

	records.sort((a, b) => b.startedAt - a.startedAt);
	return records;
}

export async function createRecord(record: TaskExecutionRecord): Promise<void> {
	const taskDir = getTaskRecordsDir(record.taskId);
	await mkdir(taskDir, { recursive: true });
	const filePath = getRecordFilePath(record.taskId, record.sessionId);
	const metadataLine = JSON.stringify(record);
	await writeFile(filePath, `${metadataLine}\n`, "utf-8");
}

export async function updateRecordMetadata(record: TaskExecutionRecord): Promise<void> {
	const filePath = getRecordFilePath(record.taskId, record.sessionId);
	if (!existsSync(filePath)) {
		return;
	}

	try {
		const content = await readFile(filePath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		if (lines.length === 0) return;

		lines[0] = JSON.stringify(record);
		await writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");
	} catch {
		// ignore
	}
}

export async function deleteTaskRecords(taskId: string): Promise<void> {
	const taskDir = getTaskRecordsDir(taskId);
	if (!existsSync(taskDir)) {
		return;
	}
	await rm(taskDir, { recursive: true, force: true });
}

/**
 * 扫描所有任务的执行记录，收集其 sessionPath。
 * 渲染端据此识别「哪些 session 来自定时任务」并挂专属图标。
 */
export async function loadAllScheduledSessionPaths(): Promise<string[]> {
	if (!existsSync(RECORDS_DIR)) return [];
	const paths = new Set<string>();
	try {
		const taskDirs = await readdir(RECORDS_DIR, { withFileTypes: true });
		for (const d of taskDirs) {
			if (!d.isDirectory()) continue;
			const recs = await loadRecords(d.name);
			for (const r of recs) {
				if (r.sessionPath) paths.add(r.sessionPath);
			}
		}
	} catch {
		// ignore
	}
	return [...paths];
}

/**
 * 按 sessionPath 删除对应的执行记录文件（侧栏删除定时 session 时调用，
 * 保证「自动化」执行历史里不再残留该条记录）。返回受影响的 taskId 列表。
 */
export async function deleteRecordsBySessionPath(sessionPath: string): Promise<string[]> {
	if (!existsSync(RECORDS_DIR)) return [];
	const affected = new Set<string>();
	try {
		const taskDirs = await readdir(RECORDS_DIR, { withFileTypes: true });
		for (const d of taskDirs) {
			if (!d.isDirectory()) continue;
			const recs = await loadRecords(d.name);
			for (const r of recs) {
				if (r.sessionPath === sessionPath) {
					await rm(getRecordFilePath(d.name, r.sessionId), { force: true });
					affected.add(d.name);
				}
			}
		}
	} catch {
		// ignore
	}
	return [...affected];
}

export function loadRecordsSync(taskId: string): TaskExecutionRecord[] {
	const taskDir = getTaskRecordsDir(taskId);
	if (!existsSync(taskDir)) {
		return [];
	}

	const records: TaskExecutionRecord[] = [];

	try {
		const files = readdirSync(taskDir);
		for (const file of files) {
			if (!file.endsWith(".jsonl")) continue;
			const filePath = join(taskDir, file);
			try {
				const content = readFileSync(filePath, "utf-8");
				const lines = content.trim().split("\n").filter(Boolean);
				if (lines.length > 0) {
					const record = JSON.parse(lines[0]) as TaskExecutionRecord;
					records.push(record);
				}
			} catch {
				// skip malformed files
			}
		}
	} catch {
		return [];
	}

	records.sort((a, b) => b.startedAt - a.startedAt);
	return records;
}

export function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export async function updateTaskLastRun(taskId: string, status: "success" | "failed"): Promise<void> {
	await mutateTasks((tasks) => {
		const task = tasks.find((candidate) => candidate.id === taskId);
		if (!task) return;
		task.lastRunAt = Date.now();
		task.lastRunStatus = status;
		task.updatedAt = Date.now();
	});
}

export async function updateTaskEnabled(taskId: string, enabled: boolean): Promise<void> {
	await mutateTasks((tasks) => {
		const task = tasks.find((candidate) => candidate.id === taskId);
		if (!task) return;
		task.enabled = enabled;
		task.updatedAt = Date.now();
	});
}
