import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeHost } from "@vetta/runtime-core";
import { recordBatchProjectCreated } from "../app-monitor/app-monitor-service.js";
import type { ExecutionModeOverride } from "../execution-mode.js";
import { readDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import {
	abortTask as abortTaskExecutor,
	emitBatchTaskEvent,
	enqueueResumeTask,
	enqueueRunTask,
	getQueuedTaskIds,
	isTaskQueued,
	isTaskRunning,
	removeFromPending,
} from "./batch-task-executor.js";
import { clearAllTaskStates, deleteTaskState, recoverRunningTasks } from "./batch-task-state.js";
import {
	type BatchProject,
	type BatchSkillRef,
	type BatchTask,
	createProject as createProjectStorage,
	deleteProject as deleteProjectStorage,
	getProject as getProjectStorage,
	loadProjects,
	removeTaskFromProject,
	resetProjectFiles,
	resetTaskFiles,
	updateProject as updateProjectStorage,
} from "./batch-task-storage.js";

export interface CreateBatchProjectInput {
	name: string;
	prompt: string;
	modelKey?: string;
	folders: string[];
	concurrency: number;
	executionMode?: ExecutionModeOverride;
	artifactPatterns?: string[];
	notifyEnabled?: boolean;
	timeoutMinutes?: number;
	skill?: BatchSkillRef;
}

export type UpdateBatchProjectInput = Partial<{
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
}>;

export interface BatchTaskCommandResult {
	status: "accepted" | "noop";
	projectId: string;
	affectedTaskIds: string[];
	queuedTaskIds: string[];
}

export class BatchTaskServiceError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly details?: Record<string, string | string[]>,
	) {
		super(message);
		this.name = "BatchTaskServiceError";
	}
}

const CREATE_PROJECT_KEYS = new Set([
	"name",
	"prompt",
	"modelKey",
	"folders",
	"concurrency",
	"executionMode",
	"artifactPatterns",
	"notifyEnabled",
	"timeoutMinutes",
	"skill",
]);
const UPDATE_PROJECT_KEYS = new Set([
	"name",
	"prompt",
	"modelKey",
	"concurrency",
	"executionMode",
	"artifactPatterns",
	"notifyEnabled",
	"timeoutMinutes",
	"newFolders",
	"skill",
]);

function isNonBlankString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isNonBlankStringArray(value: unknown, allowEmpty: boolean): value is string[] {
	return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(isNonBlankString);
}

function isExecutionMode(value: unknown): value is ExecutionModeOverride {
	return value === "inherit" || value === "sandbox" || value === "full-access";
}

function isBatchSkill(value: unknown): value is BatchSkillRef {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
	const skill = value as Record<string, unknown>;
	return (
		isNonBlankString(skill.name) &&
		(skill.alias === undefined || isNonBlankString(skill.alias)) &&
		(skill.type === "skill" || skill.type === "scene") &&
		Object.keys(skill).every((key) => key === "name" || key === "alias" || key === "type")
	);
}

function assertCreateProjectInput(value: unknown): asserts value is CreateBatchProjectInput {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw new BatchTaskServiceError("BATCH_PROJECT_INVALID_INPUT", "Batch project input must be an object.");
	}
	const input = value as Record<string, unknown>;
	const valid =
		Object.keys(input).every((key) => CREATE_PROJECT_KEYS.has(key)) &&
		isNonBlankString(input.name) &&
		typeof input.prompt === "string" &&
		isNonBlankStringArray(input.folders, false) &&
		Number.isInteger(input.concurrency) &&
		Number(input.concurrency) >= 1 &&
		Number(input.concurrency) <= 64 &&
		(input.modelKey === undefined || isNonBlankString(input.modelKey)) &&
		(input.executionMode === undefined || isExecutionMode(input.executionMode)) &&
		(input.artifactPatterns === undefined || isNonBlankStringArray(input.artifactPatterns, true)) &&
		(input.notifyEnabled === undefined || typeof input.notifyEnabled === "boolean") &&
		(input.timeoutMinutes === undefined ||
			(Number.isInteger(input.timeoutMinutes) &&
				Number(input.timeoutMinutes) >= 1 &&
				Number(input.timeoutMinutes) <= 10_080)) &&
		(input.skill === undefined || isBatchSkill(input.skill));
	if (!valid) {
		throw new BatchTaskServiceError("BATCH_PROJECT_INVALID_INPUT", "Invalid batch project create input.");
	}
}

function assertUpdateProjectInput(value: unknown): asserts value is UpdateBatchProjectInput {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw new BatchTaskServiceError("BATCH_PROJECT_INVALID_INPUT", "Batch project update must be an object.");
	}
	const input = value as Record<string, unknown>;
	const valid =
		Object.keys(input).length > 0 &&
		Object.keys(input).every((key) => UPDATE_PROJECT_KEYS.has(key)) &&
		(input.name === undefined || isNonBlankString(input.name)) &&
		(input.prompt === undefined || typeof input.prompt === "string") &&
		(input.modelKey === undefined || isNonBlankString(input.modelKey)) &&
		(input.concurrency === undefined ||
			(Number.isInteger(input.concurrency) && Number(input.concurrency) >= 1 && Number(input.concurrency) <= 64)) &&
		(input.executionMode === undefined || isExecutionMode(input.executionMode)) &&
		(input.artifactPatterns === undefined || isNonBlankStringArray(input.artifactPatterns, true)) &&
		(input.notifyEnabled === undefined || typeof input.notifyEnabled === "boolean") &&
		(input.timeoutMinutes === undefined ||
			(Number.isInteger(input.timeoutMinutes) &&
				Number(input.timeoutMinutes) >= 1 &&
				Number(input.timeoutMinutes) <= 10_080)) &&
		(input.newFolders === undefined || isNonBlankStringArray(input.newFolders, true)) &&
		(input.skill === undefined || input.skill === null || isBatchSkill(input.skill));
	if (!valid) {
		throw new BatchTaskServiceError("BATCH_PROJECT_INVALID_INPUT", "Invalid batch project update input.");
	}
}

const log = getAppLogger("batch-service");

export class BatchTaskService {
	constructor(private readonly getRuntime: () => RuntimeHost) {}

	async initialize(): Promise<void> {
		try {
			await recoverRunningTasks();
		} catch (error) {
			log.error(`Failed to recover running tasks: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async listProjects(): Promise<BatchProject[]> {
		return await loadProjects();
	}

	async getProject(projectId: string): Promise<BatchProject> {
		return await this.requireProject(projectId);
	}

	async createProject(data: CreateBatchProjectInput): Promise<BatchProject> {
		assertCreateProjectInput(data);
		const name = data.name.trim();
		if (name.length === 0 || name === "." || name === ".." || /[\\/]/.test(name)) {
			throw new BatchTaskServiceError("BATCH_PROJECT_INVALID_NAME", "批量项目名称不能包含路径分隔符。", {
				name: data.name,
			});
		}
		if (data.folders.length === 0) {
			throw new BatchTaskServiceError("BATCH_PROJECT_FOLDERS_REQUIRED", "创建批量项目至少需要一个源目录。");
		}

		const config = await readDesktopConfig();
		const projectDir = join(config.workspacePath, name);
		const existing = await stat(projectDir).catch(() => undefined);
		if (existing) {
			throw new BatchTaskServiceError("BATCH_PROJECT_ALREADY_EXISTS", "同名项目目录已经存在。", {
				projectId: projectDir,
			});
		}
		await this.assertDirectories(data.folders);

		const project = await createProjectStorage(
			name,
			data.prompt,
			data.modelKey,
			data.folders,
			data.concurrency,
			data.executionMode,
			data.artifactPatterns,
			data.notifyEnabled,
			data.timeoutMinutes,
			data.skill,
		);
		recordBatchProjectCreated();
		return project;
	}

	async updateProject(projectId: string, data: UpdateBatchProjectInput): Promise<BatchProject> {
		assertUpdateProjectInput(data);
		await this.requireProject(projectId);
		if (data.newFolders) {
			await this.assertDirectories(data.newFolders);
		}
		await updateProjectStorage(projectId, data);
		return await this.requireProject(projectId);
	}

	async deleteProject(projectId: string): Promise<BatchTaskCommandResult> {
		const project = await this.requireProject(projectId);
		const activeTaskIds = project.tasks
			.filter((task) => isTaskRunning(task.id) || isTaskQueued(task.id))
			.map((task) => task.id);
		if (activeTaskIds.length > 0) {
			throw new BatchTaskServiceError("BATCH_PROJECT_ACTIVE", "项目仍有运行中或排队中的任务，请先停止项目。", {
				projectId,
				taskIds: activeTaskIds,
			});
		}
		await deleteProjectStorage(projectId);
		return this.result(
			projectId,
			project.tasks.map((task) => task.id),
		);
	}

	async runTask(projectId: string, taskId: string): Promise<BatchTaskCommandResult> {
		const { project, task } = await this.requireTask(projectId, taskId);
		if (task.status !== "pending" || task.sessionId || isTaskQueued(taskId) || isTaskRunning(taskId)) {
			throw new BatchTaskServiceError("BATCH_TASK_NOT_RUNNABLE", "只有未执行的任务可以直接执行。", {
				projectId,
				taskIds: [taskId],
			});
		}
		enqueueRunTask(project, task, this.getRuntime());
		return this.result(projectId, [taskId]);
	}

	async retryTask(projectId: string, taskId: string): Promise<BatchTaskCommandResult> {
		const { project, task } = await this.requireTask(projectId, taskId);
		if (isTaskRunning(taskId) || isTaskQueued(taskId)) {
			throw new BatchTaskServiceError("BATCH_TASK_ACTIVE", "运行中或排队中的任务不能重试。", {
				projectId,
				taskIds: [taskId],
			});
		}
		const runtime = this.getRuntime();
		await this.cleanTaskFilesAndState(projectId, task, runtime);
		enqueueRunTask(project, task, runtime);
		return this.result(projectId, [taskId]);
	}

	async stopTask(projectId: string, taskId: string): Promise<BatchTaskCommandResult> {
		const { task } = await this.requireTask(projectId, taskId);
		if (!isTaskRunning(taskId) && !isTaskQueued(taskId) && task.status !== "paused") {
			throw new BatchTaskServiceError("BATCH_TASK_NOT_STOPPABLE", "只有运行中、排队中或已暂停的任务可以停止。", {
				projectId,
				taskIds: [taskId],
			});
		}
		await this.cleanTaskFilesAndState(projectId, task, this.getRuntime());
		emitBatchTaskEvent({ type: "task.reset", projectId, taskId });
		return this.result(projectId, [taskId]);
	}

	async deleteTask(projectId: string, taskId: string): Promise<BatchTaskCommandResult> {
		await this.requireTask(projectId, taskId);
		if (isTaskRunning(taskId)) {
			throw new BatchTaskServiceError("BATCH_TASK_RUNNING", "运行中的任务不能删除，请先停止任务。", {
				projectId,
				taskIds: [taskId],
			});
		}
		removeFromPending(projectId, taskId);
		await removeTaskFromProject(projectId, taskId);
		await deleteTaskState(projectId, taskId);
		return this.result(projectId, [taskId]);
	}

	async deleteAllTasks(projectId: string): Promise<BatchTaskCommandResult> {
		const project = await this.requireProject(projectId);
		const targets = project.tasks.filter((task) => !isTaskRunning(task.id));
		for (const task of targets) {
			removeFromPending(projectId, task.id);
			await removeTaskFromProject(projectId, task.id);
			await deleteTaskState(projectId, task.id);
		}
		return this.result(
			projectId,
			targets.map((task) => task.id),
		);
	}

	async startProject(projectId: string): Promise<BatchTaskCommandResult> {
		const project = await this.requireProject(projectId);
		const pendingTasks = project.tasks.filter((task) => task.status === "pending" && !task.sessionId);
		const pausedTasks = project.tasks.filter((task) => task.status === "paused");
		const runtime = this.getRuntime();
		for (const task of pendingTasks) {
			enqueueRunTask(project, task, runtime);
		}
		for (const task of pausedTasks) {
			enqueueResumeTask(project, task, runtime);
		}
		return this.result(
			projectId,
			[...pendingTasks, ...pausedTasks].map((task) => task.id),
		);
	}

	async stopProject(projectId: string): Promise<BatchTaskCommandResult> {
		const project = await this.requireProject(projectId);
		const targets = project.tasks.filter((task) => task.status !== "completed");
		const runtime = this.getRuntime();
		await Promise.all(
			targets.map(async (task) => {
				await this.cleanTaskFilesAndState(projectId, task, runtime);
				emitBatchTaskEvent({ type: "task.reset", projectId, taskId: task.id });
			}),
		);
		return this.result(
			projectId,
			targets.map((task) => task.id),
		);
	}

	async resetProject(projectId: string): Promise<BatchTaskCommandResult> {
		const project = await this.requireProject(projectId);
		const runtime = this.getRuntime();
		for (const task of project.tasks) {
			if (isTaskRunning(task.id) || isTaskQueued(task.id)) {
				await abortTaskExecutor(projectId, task.id, runtime);
			}
		}
		for (const task of project.tasks) {
			await this.deleteSessionIfPresent(task, runtime);
		}
		await clearAllTaskStates(projectId);
		await resetProjectFiles(projectId);

		const refreshedProject = await this.requireProject(projectId);
		for (const task of refreshedProject.tasks) {
			enqueueRunTask(refreshedProject, task, runtime);
		}
		return this.result(
			projectId,
			refreshedProject.tasks.map((task) => task.id),
		);
	}

	async resetFailedTasks(projectId: string, taskIds: string[]): Promise<BatchTaskCommandResult> {
		const project = await this.requireProject(projectId);
		const idSet = new Set(taskIds);
		const targets = project.tasks.filter((task) => idSet.has(task.id) && task.status === "failed");
		const runtime = this.getRuntime();
		const queueActive = project.tasks.some((task) => isTaskRunning(task.id) || isTaskQueued(task.id));

		await Promise.all(
			targets.map(async (task) => {
				await this.cleanTaskFilesAndState(projectId, task, runtime);
				emitBatchTaskEvent({ type: "task.reset", projectId, taskId: task.id });
			}),
		);

		if (queueActive && targets.length > 0) {
			const refreshed = await this.requireProject(projectId);
			for (const task of refreshed.tasks) {
				if (idSet.has(task.id)) enqueueRunTask(refreshed, task, runtime);
			}
		}
		return this.result(
			projectId,
			targets.map((task) => task.id),
		);
	}

	async resumeTask(projectId: string, taskId: string, text?: string): Promise<BatchTaskCommandResult> {
		const { project, task } = await this.requireTask(projectId, taskId);
		if (task.status !== "paused") {
			throw new BatchTaskServiceError("BATCH_TASK_NOT_PAUSED", "只有已暂停的任务可以继续。", {
				projectId,
				taskIds: [taskId],
			});
		}
		const resumeText = text?.trim() ? text : undefined;
		enqueueResumeTask(project, task, this.getRuntime(), resumeText ?? "继续");
		return this.result(projectId, [taskId]);
	}

	async deleteTaskSession(projectId: string, taskId: string): Promise<BatchTaskCommandResult> {
		const { task } = await this.requireTask(projectId, taskId);
		if (isTaskRunning(taskId) || isTaskQueued(taskId)) {
			throw new BatchTaskServiceError("BATCH_TASK_ACTIVE", "运行中或排队中的任务不能删除会话。", {
				projectId,
				taskIds: [taskId],
			});
		}
		if (!task.sessionPath) {
			return this.result(projectId, []);
		}
		await this.getRuntime().deleteSession(task.sessionPath);
		return this.result(projectId, [taskId]);
	}

	async deleteSessionByPath(sessionPath: string): Promise<void> {
		const projects = await loadProjects();
		const match = projects
			.flatMap((project) => project.tasks.map((task) => ({ project, task })))
			.find(({ task }) => task.sessionPath === sessionPath);
		if (!match) {
			throw new BatchTaskServiceError("BATCH_SESSION_NOT_FOUND", "该会话不属于已注册的批量任务。", { sessionPath });
		}
		if (isTaskRunning(match.task.id) || isTaskQueued(match.task.id)) {
			throw new BatchTaskServiceError("BATCH_TASK_ACTIVE", "运行中或排队中的任务不能删除会话。", {
				projectId: match.project.id,
				taskIds: [match.task.id],
			});
		}
		await this.getRuntime().deleteSession(sessionPath);
	}

	private async requireProject(projectId: string): Promise<BatchProject> {
		const project = await getProjectStorage(projectId);
		if (!project) {
			throw new BatchTaskServiceError("BATCH_PROJECT_NOT_FOUND", "批量项目不存在。", { projectId });
		}
		return project;
	}

	private async requireTask(projectId: string, taskId: string): Promise<{ project: BatchProject; task: BatchTask }> {
		const project = await this.requireProject(projectId);
		const task = project.tasks.find((candidate) => candidate.id === taskId);
		if (!task) {
			throw new BatchTaskServiceError("BATCH_TASK_NOT_FOUND", "批量任务不存在。", {
				projectId,
				taskIds: [taskId],
			});
		}
		return { project, task };
	}

	private async assertDirectories(paths: string[]): Promise<void> {
		const invalid: string[] = [];
		for (const folderPath of paths) {
			const info = await stat(folderPath).catch(() => undefined);
			if (!info?.isDirectory()) invalid.push(folderPath);
		}
		if (invalid.length > 0) {
			throw new BatchTaskServiceError("BATCH_SOURCE_DIRECTORY_INVALID", "部分源目录不存在或不是目录。", {
				paths: invalid,
			});
		}
	}

	private async cleanTaskFilesAndState(projectId: string, task: BatchTask, runtime: RuntimeHost): Promise<void> {
		if (isTaskRunning(task.id) || isTaskQueued(task.id)) {
			await abortTaskExecutor(projectId, task.id, runtime);
		}
		await this.deleteSessionIfPresent(task, runtime);
		await deleteTaskState(projectId, task.id);
		await resetTaskFiles(projectId, task.id);
	}

	private async deleteSessionIfPresent(task: BatchTask, runtime: RuntimeHost): Promise<void> {
		if (!task.sessionPath) return;
		try {
			await runtime.deleteSession(task.sessionPath);
		} catch {
			// Session may already be gone.
		}
	}

	private result(projectId: string, affectedTaskIds: string[]): BatchTaskCommandResult {
		return {
			status: affectedTaskIds.length > 0 ? "accepted" : "noop",
			projectId,
			affectedTaskIds,
			queuedTaskIds: getQueuedTaskIds(projectId),
		};
	}
}

let desktopBatchTaskService: BatchTaskService | undefined;

export function initializeDesktopBatchTaskService(getRuntime: () => RuntimeHost): BatchTaskService {
	if (desktopBatchTaskService) throw new Error("Desktop batch task service is already initialized");
	desktopBatchTaskService = new BatchTaskService(getRuntime);
	return desktopBatchTaskService;
}

export function getDesktopBatchTaskService(): BatchTaskService {
	if (!desktopBatchTaskService) throw new Error("Desktop batch task service is not initialized");
	return desktopBatchTaskService;
}
