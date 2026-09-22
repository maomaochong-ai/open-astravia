import { existsSync } from "node:fs";
import type { RuntimeHost } from "@vetta/runtime-core";
import {
	type AutomationSessionLink,
	type AutomationTaskCreateRequest,
	type AutomationTaskInput,
	type AutomationTaskPatch,
	type AutomationTaskUpdateRequest,
	isAutomationModel,
	isAutomationNotification,
	isAutomationRunTarget,
	isAutomationSchedule,
	type ScheduledTask,
	type TaskExecutionRecord,
} from "../../shared/automation.js";
import { recordAutomationTaskCreated } from "../app-monitor/app-monitor-service.js";
import { isValidSchedule } from "./cron.js";
import { AutomationAlreadyRunningError, abortTask, executeTask, isTaskRunning } from "./task-executor.js";
import {
	deleteRecordsBySessionPaths,
	deleteTaskRecords,
	generateId,
	loadAutomationSessionLinks,
	loadRecords,
	loadTasks,
	mutateTasks,
} from "./task-storage.js";

export type { AutomationTaskInput as CreateScheduledTaskInput, AutomationTaskPatch as UpdateScheduledTaskInput };

export interface SchedulerCommandResult {
	status: "accepted" | "noop";
	taskId: string;
}

export interface SchedulerServiceDependencies {
	getRuntime: () => RuntimeHost;
	/** 按任务当前配置同步调度作业（启用则排程，停用则撤下）。 */
	syncTask: (task: ScheduledTask) => void;
	unscheduleTask: (taskId: string) => void;
	/** 判断项目是否仍在侧边栏（含归档）；「对话」恒为 true。 */
	isKnownProject: (cwd: string) => Promise<boolean>;
	sameProjectPath: (first: string, second: string) => boolean;
	/** 默认「对话」的 cwd：外部输入省略项目时落在这里。 */
	conversationCwd: string;
}

export class SchedulerServiceError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly details?: Record<string, string | string[]>,
	) {
		super(message);
		this.name = "SchedulerServiceError";
	}
}

const INPUT_KEYS = new Set(["name", "prompt", "schedule", "runTarget", "model", "notification", "enabled"]);

function isNonBlankString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function invalid(message: string): SchedulerServiceError {
	return new SchedulerServiceError("SCHEDULER_TASK_INVALID_INPUT", message);
}

function assertFieldShapes(input: Record<string, unknown>): void {
	if (!Object.keys(input).every((key) => INPUT_KEYS.has(key))) throw invalid("Unknown scheduled task field.");
	if (input.name !== undefined && !isNonBlankString(input.name)) throw invalid("Task name must not be blank.");
	if (input.prompt !== undefined && !isNonBlankString(input.prompt)) throw invalid("Task prompt must not be blank.");
	if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw invalid("enabled must be a boolean.");
	if (input.schedule !== undefined) {
		if (!isAutomationSchedule(input.schedule) || !isValidSchedule(input.schedule)) {
			throw new SchedulerServiceError("SCHEDULER_SCHEDULE_INVALID", "Invalid automation schedule.");
		}
	}
	if (input.runTarget !== undefined && !isAutomationRunTarget(input.runTarget)) throw invalid("Invalid run target.");
	if (input.model !== undefined && input.model !== null && !isAutomationModel(input.model)) {
		throw invalid("Invalid model selection.");
	}
	if (
		input.notification !== undefined &&
		input.notification !== null &&
		!isAutomationNotification(input.notification)
	) {
		throw invalid("Invalid notification settings.");
	}
}

function assertCreateInput(value: unknown): asserts value is AutomationTaskInput {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw invalid("Scheduled task input must be an object.");
	}
	const input = value as Record<string, unknown>;
	assertFieldShapes(input);
	if (
		input.name === undefined ||
		input.prompt === undefined ||
		input.schedule === undefined ||
		input.runTarget === undefined ||
		input.enabled === undefined
	) {
		throw invalid("Missing required scheduled task fields.");
	}
}

function assertPatchInput(value: unknown): asserts value is AutomationTaskPatch {
	if (value == null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) {
		throw invalid("Scheduled task update must be a non-empty object.");
	}
	assertFieldShapes(value as Record<string, unknown>);
}

/** 应用补丁：null 清除可选字段；目标（运行会话 / 项目）变化后清掉因目标失效产生的暂停原因。 */
function applyPatch(task: ScheduledTask, patch: AutomationTaskPatch, now: number): ScheduledTask {
	const { model, notification, ...rest } = patch;
	const next: ScheduledTask = { ...task, ...rest, updatedAt: now };
	const withOptional: ScheduledTask = {
		...next,
		...(model === null ? { model: undefined } : model !== undefined ? { model } : {}),
		...(notification === null ? { notification: undefined } : notification !== undefined ? { notification } : {}),
	};
	const cleaned = JSON.parse(JSON.stringify(withOptional)) as ScheduledTask;
	if (patch.runTarget !== undefined || (patch.enabled === true && cleaned.suspendedReason)) {
		const { suspendedReason: _cleared, ...unsuspended } = cleaned;
		return unsuspended;
	}
	return cleaned;
}

/** 省略或留空的 projectCwd 补成默认「对话」，其余字段原样交给结构校验。 */
function withDefaultProject<T extends { runTarget?: unknown }>(input: T, conversationCwd: string): T {
	if (!input || typeof input !== "object" || !input.runTarget || typeof input.runTarget !== "object") return input;
	const target = input.runTarget as Record<string, unknown>;
	if (typeof target.projectCwd === "string" && target.projectCwd.trim().length > 0) return input;
	return { ...input, runTarget: { ...target, projectCwd: conversationCwd } };
}

export class SchedulerService {
	private readonly changeHandlers = new Set<() => void>();

	constructor(private readonly dependencies: SchedulerServiceDependencies) {}

	onTasksChanged(handler: () => void): () => void {
		this.changeHandlers.add(handler);
		return () => {
			this.changeHandlers.delete(handler);
		};
	}

	async listTasks(): Promise<ScheduledTask[]> {
		return await loadTasks();
	}

	async getTask(taskId: string): Promise<ScheduledTask> {
		return await this.requireTask(taskId);
	}

	async getHistory(taskId: string): Promise<TaskExecutionRecord[]> {
		await this.requireTask(taskId);
		return await loadRecords(taskId);
	}

	async listSessionLinks(): Promise<AutomationSessionLink[]> {
		return await loadAutomationSessionLinks(await loadTasks());
	}

	async createTask(request: AutomationTaskCreateRequest): Promise<ScheduledTask> {
		const data = withDefaultProject(request, this.dependencies.conversationCwd) as unknown;
		assertCreateInput(data);
		await this.assertTargetUsable(data);
		const now = Date.now();
		const task = applyPatch(
			{
				...data,
				id: generateId(),
				createdAt: now,
				updatedAt: now,
				lastRunAt: null,
				lastRunStatus: null,
			},
			{},
			now,
		);
		await mutateTasks((tasks) => {
			tasks.push(task);
		});
		this.dependencies.syncTask(task);
		this.emitTasksChanged();
		recordAutomationTaskCreated();
		return task;
	}

	async updateTask(taskId: string, request: AutomationTaskUpdateRequest): Promise<ScheduledTask> {
		const patch = withDefaultProject(request, this.dependencies.conversationCwd) as unknown;
		assertPatchInput(patch);
		const current = await this.requireTask(taskId);
		const now = Date.now();
		const preview = applyPatch(current, patch, now);
		await this.assertTargetUsable(preview);
		const task = await mutateTasks((tasks) => {
			const index = tasks.findIndex((candidate) => candidate.id === taskId);
			if (index < 0) {
				throw new SchedulerServiceError("SCHEDULER_TASK_NOT_FOUND", "定时任务不存在。", { taskId });
			}
			tasks[index] = applyPatch(tasks[index], patch, now);
			return tasks[index];
		});
		this.dependencies.syncTask(task);
		this.emitTasksChanged();
		return task;
	}

	async deleteTask(taskId: string): Promise<SchedulerCommandResult> {
		if (isTaskRunning(taskId)) {
			throw new SchedulerServiceError("SCHEDULER_TASK_RUNNING", "运行中的定时任务不能删除，请先中止。", {
				taskId,
			});
		}
		await mutateTasks((tasks) => {
			const index = tasks.findIndex((candidate) => candidate.id === taskId);
			if (index < 0) {
				throw new SchedulerServiceError("SCHEDULER_TASK_NOT_FOUND", "定时任务不存在。", { taskId });
			}
			tasks.splice(index, 1);
		});
		this.dependencies.unscheduleTask(taskId);
		await deleteTaskRecords(taskId);
		this.emitTasksChanged();
		return { status: "accepted", taskId };
	}

	async setEnabled(taskId: string, enabled: boolean): Promise<ScheduledTask> {
		return await this.updateTask(taskId, { enabled });
	}

	async toggleTask(taskId: string): Promise<ScheduledTask> {
		const task = await this.requireTask(taskId);
		return await this.updateTask(taskId, { enabled: !task.enabled });
	}

	/** 「立即运行」：遵守同一时刻只跑一次，也会按配置发通知。 */
	async runNow(taskId: string): Promise<SchedulerCommandResult> {
		const task = await this.requireTask(taskId);
		if (isTaskRunning(taskId)) {
			throw new SchedulerServiceError("SCHEDULER_TASK_RUNNING", "定时任务已在运行。", { taskId });
		}
		void executeTask(task, this.dependencies.getRuntime(), {
			trigger: "manual",
			onTaskChanged: (changed) => this.dependencies.syncTask(changed),
		}).catch((error) => {
			if (!(error instanceof AutomationAlreadyRunningError)) throw error;
		});
		return { status: "accepted", taskId };
	}

	async abort(taskId: string): Promise<SchedulerCommandResult> {
		await this.requireTask(taskId);
		const aborted = await abortTask(taskId);
		return { status: aborted ? "accepted" : "noop", taskId };
	}

	/**
	 * 会话被删除：清掉指向它们的执行记录；绑定到它们的自动化暂停并标明原因，
	 * 绝不悄悄换一个新会话顶上（ADR-0127）。
	 */
	async handleSessionsDeleted(isDeleted: (sessionPath: string) => boolean): Promise<void> {
		const suspended = await mutateTasks((tasks) => {
			const changed: ScheduledTask[] = [];
			tasks.forEach((task, index) => {
				if (task.runTarget.mode !== "same-session" || !task.runTarget.sessionPath) return;
				if (!isDeleted(task.runTarget.sessionPath)) return;
				tasks[index] = { ...task, enabled: false, suspendedReason: "session-deleted", updatedAt: Date.now() };
				changed.push(tasks[index]);
			});
			return changed;
		});
		for (const task of suspended) this.dependencies.syncTask(task);
		const affected = await deleteRecordsBySessionPaths(isDeleted);
		if (suspended.length > 0 || affected.length > 0) this.emitTasksChanged();
	}

	/** 项目从侧边栏移除：以它为目标的自动化暂停并标明原因。 */
	async handleProjectRemoved(projectCwd: string): Promise<void> {
		const suspended = await mutateTasks((tasks) => {
			const changed: ScheduledTask[] = [];
			tasks.forEach((task, index) => {
				if (!this.dependencies.sameProjectPath(task.runTarget.projectCwd, projectCwd)) return;
				tasks[index] = { ...task, enabled: false, suspendedReason: "project-removed", updatedAt: Date.now() };
				changed.push(tasks[index]);
			});
			return changed;
		});
		for (const task of suspended) this.dependencies.syncTask(task);
		if (suspended.length > 0) this.emitTasksChanged();
	}

	private async requireTask(taskId: string): Promise<ScheduledTask> {
		const task = (await loadTasks()).find((candidate) => candidate.id === taskId);
		if (!task) {
			throw new SchedulerServiceError("SCHEDULER_TASK_NOT_FOUND", "定时任务不存在。", { taskId });
		}
		return task;
	}

	/** 启用的自动化必须有可用的目标与仍在未来的一次性时刻。 */
	private async assertTargetUsable(task: Pick<ScheduledTask, "runTarget" | "schedule" | "enabled">): Promise<void> {
		if (!(await this.dependencies.isKnownProject(task.runTarget.projectCwd))) {
			throw new SchedulerServiceError("SCHEDULER_PROJECT_INVALID", "目标项目不存在。", {
				projectCwd: task.runTarget.projectCwd,
			});
		}
		if (task.enabled && task.runTarget.mode === "same-session" && task.runTarget.sessionPath) {
			if (!existsSync(task.runTarget.sessionPath)) {
				throw new SchedulerServiceError("SCHEDULER_SESSION_INVALID", "绑定的会话不存在。", {
					sessionPath: task.runTarget.sessionPath,
				});
			}
		}
		if (task.enabled && task.schedule.kind === "once" && task.schedule.at <= Date.now()) {
			throw new SchedulerServiceError("SCHEDULER_SCHEDULE_PAST", "一次性任务的执行时间已过去。");
		}
	}

	private emitTasksChanged(): void {
		for (const handler of this.changeHandlers) handler();
	}
}

let desktopSchedulerService: SchedulerService | undefined;

export function initializeDesktopSchedulerService(dependencies: SchedulerServiceDependencies): SchedulerService {
	if (desktopSchedulerService) throw new Error("Desktop scheduler service is already initialized");
	desktopSchedulerService = new SchedulerService(dependencies);
	return desktopSchedulerService;
}

export function getDesktopSchedulerService(): SchedulerService {
	if (!desktopSchedulerService) throw new Error("Desktop scheduler service is not initialized");
	return desktopSchedulerService;
}

/** 其他模块（会话删除、项目移除）在服务可能尚未初始化时调用，未初始化即忽略。 */
export function getDesktopSchedulerServiceIfReady(): SchedulerService | undefined {
	return desktopSchedulerService;
}
