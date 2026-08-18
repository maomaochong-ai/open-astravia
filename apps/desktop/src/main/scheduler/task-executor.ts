import type { RuntimeHost, SessionEvent } from "@vetta/runtime-core";
import { formatScheduleSessionName } from "../../shared/scheduled-session.js";
import { monitorRuntimeSession, recordAutomationRunStarted } from "../app-monitor/app-monitor-service.js";
import { resolveExecutionMode } from "../execution-mode.js";
import { DEFAULT_CONVERSATION_CWD, DEFAULT_CONVERSATION_SESSION_DIR, readDesktopConfig } from "../ipc/fs.js";
import { emitTaskEvent, emitTaskStreamEvent } from "../ipc/scheduler.js";
import { ensureConversationSubCwd } from "../ipc/session.js";
import { assertSandboxAvailableForMode } from "../sandbox/capability.js";
import type { ScheduledTask, TaskExecutionRecord } from "./task-storage";
import { createRecord, generateId, updateRecordMetadata, updateTaskLastRun } from "./task-storage";

interface ExecutingTask {
	sessionId: string;
	runtime: RuntimeHost;
	unsubscribe: () => void;
}

const executingTasks = new Map<string, ExecutingTask>();
const activeExecutions = new Set<Promise<void>>();
let acceptingExecutions = true;
let shutdownPromise: Promise<void> | undefined;

export interface ExecuteTaskOptions {
	onOneTimeCompleted?: (task: ScheduledTask) => Promise<void> | void;
}

export function executeTask(
	task: ScheduledTask,
	runtime: RuntimeHost,
	options: ExecuteTaskOptions = {},
): Promise<void> {
	if (!acceptingExecutions) {
		return Promise.reject(new Error("Scheduler task executor is shutting down"));
	}
	const execution = executeTaskInner(task, runtime, options);
	activeExecutions.add(execution);
	void execution.then(
		() => activeExecutions.delete(execution),
		() => activeExecutions.delete(execution),
	);
	return execution;
}

async function executeTaskInner(task: ScheduledTask, runtime: RuntimeHost, options: ExecuteTaskOptions): Promise<void> {
	if (isTaskRunning(task.id)) {
		throw new Error(`Scheduled task is already running: ${task.id}`);
	}

	const recordId = generateId();
	let sessionId = "";

	const record: TaskExecutionRecord = {
		id: recordId,
		taskId: task.id,
		sessionId: "",
		cwd: task.cwd,
		startedAt: Date.now(),
		completedAt: null,
		status: "running",
		prompt: task.prompt,
		responsePreview: "",
		executionMode: undefined,
	};

	try {
		const config = await readDesktopConfig();
		const executionMode = resolveExecutionMode(task.executionMode, config.defaultExecutionMode);
		await assertSandboxAvailableForMode(executionMode, async () => executionMode);
		record.executionMode = executionMode;

		// 定时任务属于「对话」列表中的一种会话类型：session 文件统一写入默认
		// 对话 sessionDir，刷新侧边栏后仍留在「对话」列表；运行 cwd 仍使用任务
		// 自己的工作目录，避免改变任务执行语义。
		const runCwd = (await ensureConversationSubCwd(task.cwd)) ?? task.cwd;
		record.cwd = runCwd;
		const result = await runtime.createSession({
			cwd: runCwd,
			scenario: "automation",
			// 显式固化为 work：不传则执行时没有 mode 提示词、事后打开会话时 UI 又按
			// work 回退渲染，执行与展示割裂（同 batch-task-executor）。
			agentMode: "work",
			executionMode,
			sessionDir: DEFAULT_CONVERSATION_SESSION_DIR,
		});
		sessionId = result.sessionId;
		record.sessionId = sessionId;
		monitorRuntimeSession(runtime, sessionId, "automation");
		recordAutomationRunStarted();

		// 会话名 = 任务名 · 执行时间；前缀一个不可见标记，渲染端据此挂定时图标
		// 并统一剥离标记展示（不再用可见的 "[定时]" 文字占位）。
		const sessionName = formatScheduleSessionName(task.name, record.startedAt);
		await runtime.renameSessionById(sessionId, sessionName);

		// Get session path for navigation
		record.sessionPath = runtime.getSessionPath(sessionId);

		await createRecord(record);

		emitTaskEvent({
			type: "task.started",
			taskId: task.id,
			recordId,
			sessionId,
			sessionPath: record.sessionPath ?? "",
			cwd: DEFAULT_CONVERSATION_CWD,
			sessionName,
			firstMessage: task.prompt.slice(0, 80),
		});

		let responseText = "";
		let unsubscribed = false;
		let unsubscribe: () => void = () => {};
		const safeUnsubscribe = (): void => {
			if (unsubscribed) return;
			unsubscribed = true;
			unsubscribe();
		};

		unsubscribe = runtime.subscribe(sessionId, async (event: SessionEvent) => {
			if (event.type === "message.delta") {
				responseText += event.delta;
				emitTaskStreamEvent({
					taskId: task.id,
					sessionId,
					type: "message.delta",
					delta: event.delta,
				});
			}

			if (event.type === "thinking.delta") {
				emitTaskStreamEvent({
					taskId: task.id,
					sessionId,
					type: "thinking.delta",
					delta: event.delta,
				});
			}

			if (event.type === "toolcall.start") {
				emitTaskStreamEvent({
					taskId: task.id,
					sessionId,
					type: "toolcall.start",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
				});
			}

			if (event.type === "tool.start") {
				emitTaskStreamEvent({
					taskId: task.id,
					sessionId,
					type: "tool.start",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args as Record<string, unknown>,
				});
			}

			if (event.type === "tool.end") {
				emitTaskStreamEvent({
					taskId: task.id,
					sessionId,
					type: "tool.end",
					toolCallId: event.toolCallId,
					result: event.result,
					isError: event.isError,
				});
			}

			if (event.type === "session.lifecycle") {
				emitTaskStreamEvent({
					taskId: task.id,
					sessionId,
					type: "session.lifecycle",
					phase: event.phase,
				});

				if (event.phase === "agent_end" || event.phase === "aborted") {
					record.status = event.phase === "aborted" ? "aborted" : "success";
					record.completedAt = Date.now();
					record.responsePreview = responseText.slice(0, 500);
					record.durationMs = record.completedAt - record.startedAt;

					await updateRecordMetadata(record);
					await updateTaskLastRun(task.id, event.phase === "aborted" ? "failed" : "success");
					executingTasks.delete(task.id);
					// 解除订阅，避免用户后续在同一 session 继续对话时误触发本
					// 回调覆写历史记录。RuntimeHost 由 session IPC 与本模块
					// 共享，session 仍然存活，下次打开复用即可。
					safeUnsubscribe();

					emitTaskEvent({
						type: "record.updated",
						taskId: task.id,
						sessionId,
						status: event.phase === "aborted" ? "aborted" : "success",
					});

					// Auto-disable one-time tasks after execution completes
					if (task.isOnce && event.phase === "agent_end") {
						await options.onOneTimeCompleted?.(task);
						emitTaskEvent({ type: "tasks.changed" });
					}
				}
			}
		});

		executingTasks.set(task.id, { sessionId, runtime, unsubscribe: safeUnsubscribe });

		await runtime.prompt(sessionId, {
			text: task.prompt,
			...(task.skill
				? {
						promptRef: {
							kind: task.skill.type === "scene" ? ("scene" as const) : ("skill" as const),
							name: task.skill.name,
						},
					}
				: {}),
			...(task.modelKey ? { modelKey: task.modelKey } : {}),
		});
	} catch (error) {
		record.status = "failed";
		record.completedAt = Date.now();
		record.error = String(error);
		record.durationMs = record.completedAt - record.startedAt;
		await createRecord(record);
		await updateTaskLastRun(task.id, "failed");
		executingTasks.delete(task.id);

		emitTaskEvent({
			type: "task.failed",
			taskId: task.id,
			error: String(error),
		});
	}
}

export async function abortTask(taskId: string): Promise<boolean> {
	const executing = executingTasks.get(taskId);
	if (!executing) return false;
	await executing.runtime.abort(executing.sessionId);
	executing.unsubscribe();
	executingTasks.delete(taskId);
	return true;
}

export async function shutdownSchedulerTaskExecutor(): Promise<void> {
	acceptingExecutions = false;
	if (shutdownPromise) return await shutdownPromise;
	shutdownPromise = (async () => {
		const activeTasks = [...executingTasks.entries()];
		await Promise.allSettled(
			activeTasks.map(async ([taskId, executing]) => {
				try {
					await executing.runtime.abort(executing.sessionId);
				} finally {
					executing.unsubscribe();
					executingTasks.delete(taskId);
				}
			}),
		);
		await Promise.allSettled([...activeExecutions]);
	})();
	return await shutdownPromise;
}

export function isTaskRunning(taskId: string): boolean {
	return executingTasks.has(taskId);
}

export function getRunningTaskIds(): string[] {
	return [...executingTasks.keys()];
}

export function getSchedulerTaskExecutorState(): {
	readonly acceptingExecutions: boolean;
	readonly shutdownStarted: boolean;
	readonly activeTasks: Array<{
		readonly taskId: string;
		readonly sessionId: string;
		readonly sessionPath: string | undefined;
	}>;
} {
	return {
		acceptingExecutions,
		shutdownStarted: shutdownPromise !== undefined,
		activeTasks: [...executingTasks.entries()].map(([taskId, executing]) => ({
			taskId,
			sessionId: executing.sessionId,
			sessionPath: executing.runtime.getSessionPath(executing.sessionId),
		})),
	};
}
