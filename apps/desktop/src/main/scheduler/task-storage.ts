import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { AutomationSessionLink, ScheduledTask, TaskExecutionRecord } from "../../shared/automation.js";
import { type LegacyMigrationContext, type LegacyScheduledTask, migrateLegacyTask } from "./automation-migration.js";

export type { ScheduledTask, TaskExecutionRecord } from "../../shared/automation.js";

const CONFIG_DIR = getVettaHomePath();
const TASKS_FILE = join(CONFIG_DIR, "automations.json");
const LEGACY_TASKS_FILE = join(CONFIG_DIR, "scheduled-tasks.json");
const LEGACY_BACKUP_FILE = `${LEGACY_TASKS_FILE}.v1.bak`;
const RECORDS_DIR = join(CONFIG_DIR, "task-records");
const SCHEDULER_STATE_FILE = join(CONFIG_DIR, "automation-scheduler-state.json");

const STORE_VERSION = 2;

interface AutomationStoreFile {
	version: number;
	tasks: ScheduledTask[];
}

let migrationContextProvider: (() => Promise<LegacyMigrationContext>) | undefined;

/** 迁移需要项目列表与对话 cwd，由启动流程注入，避免存储层反向依赖配置模块。 */
export function setLegacyMigrationContextProvider(provider: () => Promise<LegacyMigrationContext>): void {
	migrationContextProvider = provider;
}

async function ensureDirectories(): Promise<void> {
	await mkdir(CONFIG_DIR, { recursive: true });
	await mkdir(RECORDS_DIR, { recursive: true });
}

async function writeAtomic(path: string, content: string): Promise<void> {
	// 写临时文件后 rename：rename 在同一文件系统是原子操作，杜绝半截写入。
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	await writeFile(tmp, content, "utf-8");
	await rename(tmp, path);
}

/**
 * 旧 scheduled-tasks.json 只迁移一次：转换后写入新文件，原文件改名为 .v1.bak。
 * 新文件已存在时绝不再读旧文件，避免把用户删掉的任务从备份里复活。
 */
async function migrateLegacyStore(): Promise<ScheduledTask[] | undefined> {
	if (!existsSync(LEGACY_TASKS_FILE)) return undefined;
	let legacy: LegacyScheduledTask[];
	try {
		legacy = JSON.parse(await readFile(LEGACY_TASKS_FILE, "utf-8")) as LegacyScheduledTask[];
		if (!Array.isArray(legacy)) return undefined;
	} catch {
		return undefined;
	}
	const context = (await migrationContextProvider?.()) ?? {
		conversationCwd: join(CONFIG_DIR, "conversation"),
		isKnownProject: () => false,
		now: Date.now(),
	};
	const tasks = legacy.map((task) => migrateLegacyTask(task, context));
	await writeAtomic(TASKS_FILE, JSON.stringify({ version: STORE_VERSION, tasks }, null, 2));
	await rename(LEGACY_TASKS_FILE, LEGACY_BACKUP_FILE).catch(() => {});
	return tasks;
}

let migrationPromise: Promise<void> | undefined;

/** 进程内只尝试一次迁移；迁移上下文须在首次读取前注入。 */
function ensureMigrated(): Promise<void> {
	migrationPromise ??= (async () => {
		if (!existsSync(TASKS_FILE)) await migrateLegacyStore();
	})().catch(() => {});
	return migrationPromise;
}

export async function loadTasks(): Promise<ScheduledTask[]> {
	await ensureDirectories().catch(() => {});
	await ensureMigrated();
	let data: string;
	try {
		data = await readFile(TASKS_FILE, "utf-8");
	} catch {
		return [];
	}
	try {
		const parsed = JSON.parse(data) as AutomationStoreFile;
		return Array.isArray(parsed.tasks) ? parsed.tasks : [];
	} catch {
		// 实在无法解析：备份损坏文件后返回空，至少不让原始数据被后续写入覆盖。
		await rename(TASKS_FILE, `${TASKS_FILE}.corrupt-${Date.now()}`).catch(() => {});
		return [];
	}
}

// 串行化任务文件写入：执行收尾、编辑、暂停等可能并发改同一文件。
let mutationChain: Promise<void> = Promise.resolve();

async function saveTasks(tasks: readonly ScheduledTask[]): Promise<void> {
	await ensureDirectories();
	await writeAtomic(TASKS_FILE, JSON.stringify({ version: STORE_VERSION, tasks }, null, 2));
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

export async function updateTask(
	taskId: string,
	update: (task: ScheduledTask) => ScheduledTask,
): Promise<ScheduledTask | undefined> {
	return await mutateTasks((tasks) => {
		const index = tasks.findIndex((candidate) => candidate.id === taskId);
		if (index < 0) return undefined;
		tasks[index] = update(tasks[index]);
		return tasks[index];
	});
}

export async function updateTaskLastRun(taskId: string, status: "success" | "failed"): Promise<void> {
	await updateTask(taskId, (task) => ({ ...task, lastRunAt: Date.now(), lastRunStatus: status }));
}

// ── 执行记录：每条一个 jsonl，首行是元数据 ──────────────────────────────

interface StoredRecord {
	readonly record: TaskExecutionRecord;
	readonly file: string;
}

function getTaskRecordsDir(taskId: string): string {
	return join(RECORDS_DIR, taskId);
}

function getRecordFilePath(record: Pick<TaskExecutionRecord, "taskId" | "id">): string {
	return join(getTaskRecordsDir(record.taskId), `${record.id}.jsonl`);
}

async function loadStoredRecords(taskId: string): Promise<StoredRecord[]> {
	const taskDir = getTaskRecordsDir(taskId);
	if (!existsSync(taskDir)) return [];
	const stored: StoredRecord[] = [];
	try {
		for (const file of await readdir(taskDir)) {
			if (!file.endsWith(".jsonl")) continue;
			const filePath = join(taskDir, file);
			try {
				const firstLine = (await readFile(filePath, "utf-8")).split("\n", 1)[0];
				if (firstLine) stored.push({ record: JSON.parse(firstLine) as TaskExecutionRecord, file: filePath });
			} catch {
				// skip malformed files
			}
		}
	} catch {
		return [];
	}
	return stored.sort((a, b) => b.record.startedAt - a.record.startedAt);
}

export async function loadRecords(taskId: string): Promise<TaskExecutionRecord[]> {
	return (await loadStoredRecords(taskId)).map(({ record }) => record);
}

/** 新建或覆盖一条记录（按 record.id 定位文件）。 */
export async function writeRecord(record: TaskExecutionRecord): Promise<void> {
	await mkdir(getTaskRecordsDir(record.taskId), { recursive: true });
	await writeAtomic(getRecordFilePath(record), `${JSON.stringify(record)}\n`);
}

export async function deleteTaskRecords(taskId: string): Promise<void> {
	await rm(getTaskRecordsDir(taskId), { recursive: true, force: true });
}

async function listRecordTaskIds(): Promise<string[]> {
	if (!existsSync(RECORDS_DIR)) return [];
	try {
		return (await readdir(RECORDS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
	} catch {
		return [];
	}
}

/**
 * 按 sessionPath 删除对应的执行记录（会话被删除时调用），
 * 保证执行历史里不残留指向已删除会话的条目。返回受影响的 taskId 列表。
 */
export async function deleteRecordsBySessionPaths(isDeleted: (sessionPath: string) => boolean): Promise<string[]> {
	const affected = new Set<string>();
	for (const taskId of await listRecordTaskIds()) {
		for (const { record, file } of await loadStoredRecords(taskId)) {
			if (record.sessionPath && isDeleted(record.sessionPath)) {
				await rm(file, { force: true });
				affected.add(taskId);
			}
		}
	}
	return [...affected];
}

/**
 * 会话与自动化的归属：执行记录里的会话，加上 same-session 绑定的会话。
 * 任务已删除的记录目录不再计入，那些会话回到普通会话的样子。
 */
export async function loadAutomationSessionLinks(tasks: readonly ScheduledTask[]): Promise<AutomationSessionLink[]> {
	const links = new Map<string, AutomationSessionLink>();
	for (const task of tasks) {
		const base = { taskId: task.id, taskName: task.name };
		// 「每次新建会话」产生过的会话一直归入会话组，即便任务后来改成了同一个会话。
		for (const record of await loadRecords(task.id)) {
			if (record.sessionPath && (record.mode ?? "new-session") === "new-session" && !links.has(record.sessionPath)) {
				links.set(record.sessionPath, { ...base, sessionPath: record.sessionPath, mode: "new-session" });
			}
		}
		// 只有当前绑定的会话带标记；换绑或改策略后，旧绑定会话回到普通会话。
		if (task.runTarget.mode === "same-session" && task.runTarget.sessionPath) {
			links.set(task.runTarget.sessionPath, {
				...base,
				sessionPath: task.runTarget.sessionPath,
				mode: "same-session",
			});
		}
	}
	return [...links.values()];
}

export function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ── 调度器存活心跳：用于推算应用未运行期间错过的触发 ────────────────────

export interface SchedulerState {
	readonly aliveAt: number;
}

export async function readSchedulerState(): Promise<SchedulerState | undefined> {
	try {
		const state = JSON.parse(await readFile(SCHEDULER_STATE_FILE, "utf-8")) as SchedulerState;
		return typeof state.aliveAt === "number" ? state : undefined;
	} catch {
		return undefined;
	}
}

export async function writeSchedulerState(state: SchedulerState): Promise<void> {
	await ensureDirectories();
	await writeAtomic(SCHEDULER_STATE_FILE, JSON.stringify(state));
}
