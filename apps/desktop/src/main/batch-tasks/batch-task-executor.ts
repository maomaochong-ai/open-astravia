import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AssistantMessage, Message, StopReason } from "@vetta/ai";
import type { RuntimeHost, SessionExecutionMode } from "@vetta/runtime-core";
import { monitorRuntimeSession, recordBatchRunStarted } from "../app-monitor/app-monitor-service.js";
import { resolveExecutionMode } from "../execution-mode.js";
import { readDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { assertSandboxAvailableForMode } from "../sandbox/capability.js";
import { getWebhookManager } from "../webhook/index.js";
import { verifyArtifacts } from "./artifact-validator";
import { type BatchTaskState, getTaskState, saveTaskState } from "./batch-task-state";
import type { BatchProject, BatchTask } from "./batch-task-storage";
import { DEFAULT_BATCH_TIMEOUT_MINUTES, getProject } from "./batch-task-storage";
import {
	buildProjectSummaryMessage,
	buildTaskFinishedMessage,
	isProjectFinished,
	type TaskOutcome,
} from "./notification-templates.js";

const TASK_TMP_SUBDIR = ".tmp";
const log = getAppLogger("batch-executor");

const DEFAULT_TASK_TIMEOUT_MS = DEFAULT_BATCH_TIMEOUT_MINUTES * 60 * 1000;

function resolveTaskTimeoutMs(project: BatchProject): number {
	const minutes = project.timeoutMinutes;
	if (typeof minutes === "number" && minutes > 0) {
		return Math.floor(minutes * 60 * 1000);
	}
	return DEFAULT_TASK_TIMEOUT_MS;
}

export type BatchTaskEvent =
	| {
			type: "task.started";
			projectId: string;
			taskId: string;
			sessionId: string;
			sessionPath: string | undefined;
			executionMode: SessionExecutionMode;
	  }
	| { type: "task.completed"; projectId: string; taskId: string }
	| { type: "task.failed"; projectId: string; taskId: string; error: string }
	| { type: "task.reset"; projectId: string; taskId: string }
	| { type: "task.queued"; projectId: string; taskId: string }
	| { type: "task.dequeued"; projectId: string; taskId: string }
	| {
			type: "task.paused";
			projectId: string;
			taskId: string;
			sessionId: string;
			sessionPath: string | undefined;
			executionMode: SessionExecutionMode;
	  };

interface ExecutingTask {
	projectId: string;
	taskId: string;
	cwd: string;
	artifactPatterns: string[] | undefined;
	sessionId: string;
	sessionPath: string | undefined;
	executionMode: SessionExecutionMode;
	abortController: AbortController;
	timeoutHandle: ReturnType<typeof setTimeout>;
	timeoutMs: number;
	timedOut: boolean;
	startedAt: number;
	modelKey: string | undefined;
	runtime: RuntimeHost;
}

const executingTasks = new Map<string, ExecutingTask>();
const eventHandlers = new Set<(event: BatchTaskEvent) => void>();
const activeJobs = new Set<Promise<void>>();
let acceptingJobs = true;
let shutdownPromise: Promise<void> | undefined;

// ─── Per-project concurrency scheduler ─────────────────────────────────────
//
// 单点"运行"和批量启动共用一个调度器，保证同一项目内同时执行的任务数永远不
// 超过 project.concurrency。runningByProject 跟踪已经启动并占用 worker 槽位的
// taskId；pendingByProject 是 FIFO 等待队列。所有 run/resume 入口都经过
// enqueueJob，由调度器决定立即执行还是排队。
//
// 仅在主进程内存中维护——重启后队列丢失（pending 的任务回到"未执行"或上次
// 持久化的状态），与 recoverRunningTasks() 把 stale running 标 failed 的行为一致。

type PendingJob = {
	project: BatchProject;
	task: BatchTask;
	runtime: RuntimeHost;
	/**
	 * When present, this job is a "resume" of a paused task: reuse the existing
	 * sessionId on the task instead of creating a new session, and send this
	 * text as the next user prompt. Absent on regular runs.
	 */
	resumeText?: string;
};

const runningByProject = new Map<string, Set<string>>();
const pendingByProject = new Map<string, PendingJob[]>();

function getRunningSet(projectId: string): Set<string> {
	let s = runningByProject.get(projectId);
	if (!s) {
		s = new Set<string>();
		runningByProject.set(projectId, s);
	}
	return s;
}

function getPendingQueue(projectId: string): PendingJob[] {
	let q = pendingByProject.get(projectId);
	if (!q) {
		q = [];
		pendingByProject.set(projectId, q);
	}
	return q;
}

export function isTaskQueued(taskId: string): boolean {
	for (const queue of pendingByProject.values()) {
		if (queue.some((j) => j.task.id === taskId)) return true;
	}
	return false;
}

export function getQueuedTaskIds(projectId?: string): string[] {
	const ids: string[] = [];
	const queues = projectId ? [pendingByProject.get(projectId) ?? []] : pendingByProject.values();
	for (const queue of queues) {
		for (const j of queue) ids.push(j.task.id);
	}
	return ids;
}

function enqueueJob(job: PendingJob, options?: { priority?: boolean }): void {
	if (!acceptingJobs) throw new Error("Batch task executor is shutting down");
	const projectId = job.project.id;
	const running = getRunningSet(projectId);
	const queue = getPendingQueue(projectId);

	if (running.has(job.task.id)) {
		log.warn(`enqueueJob: task ${job.task.id} already running, skip`);
		return;
	}
	const existingIdx = queue.findIndex((j) => j.task.id === job.task.id);
	if (existingIdx >= 0) {
		// 同一任务已在队列里。如果新入队是优先（resume）就把它移到队首并替换
		// payload（取最新的 resumeText/project 副本），否则保持原状跳过。
		if (options?.priority) {
			queue.splice(existingIdx, 1);
			queue.unshift(job);
			log.debug(`task ${job.task.id} re-prioritized to head of queue`);
		} else {
			log.warn(`enqueueJob: task ${job.task.id} already queued, skip`);
		}
		return;
	}

	const concurrency = Math.max(1, job.project.concurrency);
	if (running.size < concurrency) {
		running.add(job.task.id);
		launchJob(job);
	} else {
		if (options?.priority) {
			// 多个 paused 同时恢复时按 FIFO 插队首：先恢复的先在前。寻找当前
			// 队列中第一个非 priority 项的位置，把新 job 插在所有 priority 项之后。
			let insertAt = 0;
			while (insertAt < queue.length && queue[insertAt].resumeText !== undefined) {
				insertAt++;
			}
			queue.splice(insertAt, 0, job);
		} else {
			queue.push(job);
		}
		log.debug(
			`task ${job.task.id} queued${options?.priority ? " (priority)" : ""} (project ${projectId}, running=${running.size}/${concurrency})`,
		);
		emitBatchTaskEvent({ type: "task.queued", projectId, taskId: job.task.id });
	}
}

function launchJob(job: PendingJob): void {
	const activeJob = startJob(job);
	activeJobs.add(activeJob);
	void activeJob.then(
		() => activeJobs.delete(activeJob),
		() => activeJobs.delete(activeJob),
	);
}

async function startJob(job: PendingJob): Promise<void> {
	try {
		await runTaskInner(job.project, job.task, job.runtime, job.resumeText);
	} finally {
		const running = getRunningSet(job.project.id);
		running.delete(job.task.id);
		drainQueue(job.project.id);
	}
}

function drainQueue(projectId: string): void {
	if (!acceptingJobs) return;
	const queue = getPendingQueue(projectId);
	const running = getRunningSet(projectId);
	while (queue.length > 0) {
		const next = queue[0];
		const concurrency = Math.max(1, next.project.concurrency);
		if (running.size >= concurrency) break;
		queue.shift();
		running.add(next.task.id);
		launchJob(next);
	}
}

export function enqueueRunTask(project: BatchProject, task: BatchTask, runtime: RuntimeHost): void {
	enqueueJob({ project, task, runtime });
}

/**
 * Enqueue a "resume" of a paused task. Reuses the existing sessionId stored
 * on the task; sends `resumeText` as the next user prompt instead of
 * `project.prompt`. Inserted at the head of the pending queue (or run
 * immediately if a worker slot is free).
 *
 * If `resumeText` is omitted, defaults to "继续" — a generic continuation
 * cue used by the card-level "继续" overlay button.
 */
export function enqueueResumeTask(
	project: BatchProject,
	task: BatchTask,
	runtime: RuntimeHost,
	resumeText: string = "继续",
): void {
	enqueueJob({ project, task, runtime, resumeText }, { priority: true });
}

/**
 * 从 pending 队列移除一个尚未启动的任务。返回是否命中。
 * 用于 abortTask / deleteTask / cleanTaskFilesAndState 在任务进入执行之前
 * 直接撤销排队，无需走 abort 路径。
 */
export function removeFromPending(projectId: string, taskId: string): boolean {
	const queue = getPendingQueue(projectId);
	const idx = queue.findIndex((j) => j.task.id === taskId);
	if (idx < 0) return false;
	queue.splice(idx, 1);
	emitBatchTaskEvent({ type: "task.dequeued", projectId, taskId });
	log.debug(`task ${taskId} removed from pending queue`);
	return true;
}

export function emitBatchTaskEvent(event: BatchTaskEvent): void {
	for (const handler of eventHandlers) {
		handler(event);
	}
}

/**
 * Push a task-finished webhook (and, when the project is fully done, a
 * summary message). Best-effort: failures are logged and never bubble up so a
 * misbehaving webhook can't strand a finalized batch task.
 *
 * `getProject` is re-read so the message reflects post-save state (statuses
 * for sibling tasks may have changed concurrently under parallel workers).
 */
async function maybeNotifyTaskFinished(
	projectId: string,
	taskId: string,
	outcome: TaskOutcome,
	startedAt: number | undefined,
	finishedAt: number,
	modelKey: string | undefined,
): Promise<void> {
	try {
		const project = await getProject(projectId);
		if (!project?.notifyEnabled) return;
		const task = project.tasks.find((t) => t.id === taskId);
		if (!task) return;

		const manager = getWebhookManager();
		const taskMessage = buildTaskFinishedMessage({
			project,
			task,
			outcome,
			startedAt,
			finishedAt,
			modelKey,
		});
		void manager.broadcast(taskMessage).catch((err: unknown) => {
			log.warn(`notify task-finished broadcast failed: ${(err as Error).message}`);
		});

		if (isProjectFinished(project.tasks)) {
			const summary = buildProjectSummaryMessage({ project, finishedAt });
			void manager.broadcast(summary).catch((err: unknown) => {
				log.warn(`notify project-summary broadcast failed: ${(err as Error).message}`);
			});
		}
	} catch (err) {
		log.warn(`maybeNotifyTaskFinished failed: ${(err as Error).message}`);
	}
}

export function subscribeBatchTaskEvents(handler: (event: BatchTaskEvent) => void): () => void {
	eventHandlers.add(handler);
	return () => {
		eventHandlers.delete(handler);
	};
}

function findLastAssistant(messages: Message[]): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === "assistant") return m;
	}
	return undefined;
}

function buildTaskSystemPrompt(task: BatchTask): string {
	const tmpDir = join(task.cwd, TASK_TMP_SUBDIR);
	return [
		`## 批量任务上下文`,
		`- 源目录路径（只读参考）: ${task.sourcePath}`,
		`- 工作目录: ${task.cwd}`,
		`- 临时目录（已为本任务私有，可写入中间文件）: ${tmpDir}`,
		`- 任务名称: ${task.name}`,
		``,
		`## 规则`,
		`- 只读取源目录路径中的文件作为参考，不要修改源目录中的任何内容`,
		`- 最终产物文件必须放在工作目录的顶层（不要放进 ${TASK_TMP_SUBDIR}/ 子目录）`,
		`- 任何临时文件、辅助脚本、中间产物必须写入上面给出的临时目录，禁止写入 /tmp、/var/tmp、C:\\Windows\\Temp 等系统共享目录`,
		`- TMPDIR、TEMP、TMP 环境变量已自动指向该临时目录，Python tempfile、bash mktemp 等会自动落到这里`,
		`- 完成所有工作后直接结束，不要等待用户确认`,
	].join("\n");
}

function scheduleTimeout(taskId: string, runtime: RuntimeHost, timeoutMs: number): ReturnType<typeof setTimeout> {
	return setTimeout(() => {
		const executing = executingTasks.get(taskId);
		if (!executing) return;
		log.warn(`Task ${taskId} timed out after ${timeoutMs}ms, aborting`);
		executing.timedOut = true;
		runtime.abort(executing.sessionId).catch((err) => {
			log.warn(`abort on timeout failed for ${taskId}: ${err}`);
		});
	}, timeoutMs);
}

// runtime.prompt / runtime.continue 在所有 auto-retry 用尽后才 return（session 内 waitForRetry）。
// 此时最后一条 assistant message 的 stopReason 才是任务真正的终态。
// 直接监听 lifecycle agent_end 不可靠：retry 序列里每次 LLM 调用都会触发 agent_end。
async function finalizeTask(projectId: string, taskId: string, runtime: RuntimeHost): Promise<void> {
	const executing = executingTasks.get(taskId);
	if (!executing) {
		// abortTask 已经清理掉 executing 记录；持久化状态由调用方（停止流）统一处理。
		return;
	}
	clearTimeout(executing.timeoutHandle);

	let last: AssistantMessage | undefined;
	try {
		last = findLastAssistant(runtime.getMessages(executing.sessionId));
	} catch (err) {
		log.warn(`finalizeTask: failed to read messages for ${taskId}: ${err}`);
	}

	const stopReason: StopReason | undefined = last?.stopReason;
	const errMessage = last?.errorMessage;
	const now = Date.now();
	const base = {
		taskId,
		sessionId: executing.sessionId,
		sessionPath: executing.sessionPath,
		executionMode: executing.executionMode,
		lastModified: now,
	};

	let state: BatchTaskState;
	let outcome: TaskOutcome | null = null;

	if (executing.timedOut) {
		const message = `任务超时（${Math.round(executing.timeoutMs / 60000)} 分钟未完成）`;
		state = { ...base, status: "failed", error: message, completedAt: now };
		emitBatchTaskEvent({ type: "task.failed", projectId, taskId, error: message });
		outcome = { kind: "timeout" };
	} else if (stopReason === "stop") {
		const verify = await verifyArtifacts(executing.cwd, executing.artifactPatterns);
		if (verify.ok) {
			state = { ...base, status: "completed", completedAt: now };
			emitBatchTaskEvent({ type: "task.completed", projectId, taskId });
			outcome = { kind: "completed" };
		} else {
			const message = `产物缺失: ${verify.missingPatterns.join(", ")}`;
			state = { ...base, status: "failed", error: message, completedAt: now };
			emitBatchTaskEvent({ type: "task.failed", projectId, taskId, error: message });
			outcome = { kind: "artifact-missing", missing: verify.missingPatterns };
		}
	} else if (stopReason === "aborted") {
		// 正常项目级停止/重置走 abortTask，会先清空 executingTasks，finalizeTask
		// 顶部就直接 return，不会到这里。走到这里说明 abort 来自其它路径——典型场景
		// 是用户在该子任务的对话页点了 InputBar 上的「停止」按钮（直接 session.abort，
		// 不经 batch executor 的 abortTask）。此时把任务标记为「已暂停」并保留
		// sessionId/sessionPath/产物等，等用户手动「继续」或在 session 内发新消息
		// 走 resume 路径恢复运行。
		state = {
			...base,
			status: "paused",
			startedAt: executing.startedAt,
		};
		emitBatchTaskEvent({
			type: "task.paused",
			projectId,
			taskId,
			sessionId: executing.sessionId,
			sessionPath: executing.sessionPath,
			executionMode: executing.executionMode,
		});
	} else {
		const message = errMessage ?? `Agent ended unexpectedly (stopReason=${stopReason ?? "unknown"})`;
		state = { ...base, status: "failed", error: message, completedAt: now };
		emitBatchTaskEvent({ type: "task.failed", projectId, taskId, error: message });
		outcome = { kind: "failed", error: message };
	}

	await saveTaskState(projectId, taskId, state);
	const capturedStartedAt = executing.startedAt;
	const capturedModelKey = executing.modelKey;
	executingTasks.delete(taskId);

	if (outcome) {
		await maybeNotifyTaskFinished(projectId, taskId, outcome, capturedStartedAt, now, capturedModelKey);
	}
}

async function runTaskInner(
	project: BatchProject,
	task: BatchTask,
	runtime: RuntimeHost,
	resumeText?: string,
): Promise<void> {
	const abortController = new AbortController();
	const isResume = resumeText !== undefined;
	log.info(
		`runTask${isResume ? " (resume)" : ""}: project=${project.id}(${project.name}), task=${task.id}(${task.name}), cwd=${task.cwd}`,
	);

	let sessionId: string | undefined;
	let sessionPath: string | undefined;
	let executionMode: SessionExecutionMode | undefined;

	try {
		const config = await readDesktopConfig();
		const mode = resolveExecutionMode(project.executionMode, config.defaultExecutionMode);
		executionMode = mode;
		await assertSandboxAvailableForMode(mode, async () => mode);

		if (isResume) {
			// Resume 路径：复用 paused 时保留的 sessionId 与产物目录，不 createSession。
			// 优先用 disk 上的 task state（最新），fallback 到入参 task。
			const persisted = await getTaskState(project.id, task.id);
			const existingSessionId = persisted?.sessionId ?? task.sessionId;
			const existingSessionPath = persisted?.sessionPath ?? task.sessionPath;
			if (!existingSessionId) {
				throw new Error(`恢复失败：任务 ${task.id} 缺少 sessionId`);
			}
			sessionId = existingSessionId;
			sessionPath = existingSessionPath;
		} else {
			const sessionDir = join(project.id, ".vetta", "sessions");
			const taskSystemPrompt = buildTaskSystemPrompt(task);
			// 为本任务准备私有临时目录。三套环境变量同时设：
			// TMPDIR 覆盖 macOS / Linux，TEMP + TMP 覆盖 Windows，
			// 同时也覆盖 Python tempfile / bash mktemp 等系统调用的隐式路径。
			const taskTmpDir = join(task.cwd, TASK_TMP_SUBDIR);
			await mkdir(taskTmpDir, { recursive: true });
			const result = await runtime.createSession({
				cwd: task.cwd,
				sessionDir,
				scenario: "batch",
				// 显式固化为 work：批量任务是 work 产品线的会话形态，不传则执行时没有
				// mode 提示词、事后打开会话时 UI 又按 work 回退渲染，执行与展示割裂。
				agentMode: "work",
				appendSystemPrompt: taskSystemPrompt,
				executionMode: mode,
				env: {
					TMPDIR: taskTmpDir,
					TEMP: taskTmpDir,
					TMP: taskTmpDir,
				},
				// 批量任务按 session 结束判定子任务完成并调度并发队列：后台任务会让
				// agent 提前 agent_end 而进程仍在跑，完成通知又会凭空唤醒新 turn，
				// 干扰队列对「任务完成」的判定，故禁用。
				enableBackgroundTasks: false,
			});
			sessionId = result.sessionId;
			sessionPath = runtime.getSessionPath(sessionId);
			monitorRuntimeSession(runtime, sessionId, "batch");
		}
		if (!acceptingJobs) {
			await runtime.abort(sessionId);
			return;
		}

		const startedAt = Date.now();
		const timeoutMs = resolveTaskTimeoutMs(project);
		const timeoutHandle = scheduleTimeout(task.id, runtime, timeoutMs);
		executingTasks.set(task.id, {
			projectId: project.id,
			taskId: task.id,
			cwd: task.cwd,
			artifactPatterns: project.artifactPatterns,
			sessionId,
			sessionPath,
			executionMode: mode,
			abortController,
			timeoutHandle,
			timeoutMs,
			timedOut: false,
			startedAt,
			modelKey: project.modelKey,
			runtime,
		});
		log.info(`Session ${isResume ? "resumed" : "created"}: ${sessionId}, path=${sessionPath}`);

		if (!isResume) {
			await runtime.renameSessionById(sessionId, `${project.name}: ${task.name}`);
		}

		const runningState: BatchTaskState = {
			taskId: task.id,
			status: "running",
			sessionId,
			sessionPath,
			executionMode: mode,
			startedAt,
			lastModified: startedAt,
		};
		await saveTaskState(project.id, task.id, runningState);

		emitBatchTaskEvent({
			type: "task.started",
			projectId: project.id,
			taskId: task.id,
			sessionId,
			sessionPath,
			executionMode: mode,
		});
		recordBatchRunStarted();
		log.info(`task.started emitted: ${task.id}`);

		if (!acceptingJobs) return;

		// 模型选择透传给 prompt — 跟 chat 走完全一致的路径（useSessionManager 也是
		// 把 modelKey 放进 PromptRequest）。原来这里走的是 updateSettings + getState
		// 严格校验，对本地 provider 容易误报"模型不可用"：updateSettings 内部用
		// getAvailable() 过滤，而本地 provider 的 hasAuth 在某些时序下不为 true，
		// 模型会被静默忽略；prompt 路径已加 find() 回退，可以兜住这种情况。
		const promptText = isResume ? (resumeText as string) : project.prompt;
		log.info(
			`Sending prompt for session ${sessionId}, model=${project.modelKey ?? "(session default)"}, resume=${isResume}`,
		);
		await runtime.prompt(sessionId, {
			text: promptText,
			...(!isResume && project.skill
				? {
						promptRef: {
							kind: project.skill.type === "scene" ? ("scene" as const) : ("skill" as const),
							name: project.skill.name,
						},
					}
				: {}),
			...(project.modelKey ? { modelKey: project.modelKey } : {}),
		});
		log.info(`prompt returned, finalizing task ${task.id}`);

		await finalizeTask(project.id, task.id, runtime);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		log.error(`runTask failed for task ${task.id}: ${errorMessage}`);
		const executing = executingTasks.get(task.id);
		if (executing) clearTimeout(executing.timeoutHandle);
		const failedAt = Date.now();
		const state: BatchTaskState = {
			taskId: task.id,
			status: "failed",
			error: errorMessage,
			sessionId: executing?.sessionId ?? sessionId,
			sessionPath: executing?.sessionPath ?? sessionPath,
			executionMode: executing?.executionMode ?? executionMode,
			completedAt: failedAt,
			lastModified: failedAt,
		};
		await saveTaskState(project.id, task.id, state);
		const capturedStartedAt = executing?.startedAt;
		const capturedModelKey = executing?.modelKey ?? project.modelKey;
		executingTasks.delete(task.id);
		emitBatchTaskEvent({ type: "task.failed", projectId: project.id, taskId: task.id, error: errorMessage });
		await maybeNotifyTaskFinished(
			project.id,
			task.id,
			{ kind: "failed", error: errorMessage },
			capturedStartedAt,
			failedAt,
			capturedModelKey,
		);
	}
}

/**
 * 中断一个任务的执行：从队列里撤销（如尚未启动）或 abort runtime 会话（如运行中）。
 * 不写持久化状态——调用方（停止流）随后会通过 cleanTaskFilesAndState 统一清理
 * session、task-state 和工作目录产物。
 */
export async function abortTask(projectId: string, taskId: string, runtime: RuntimeHost): Promise<void> {
	log.info(`abortTask: project=${projectId}, task=${taskId}`);
	if (removeFromPending(projectId, taskId)) return;
	const executing = executingTasks.get(taskId);
	if (!executing) {
		log.warn(`abortTask: task ${taskId} not found in executingTasks`);
		return;
	}

	// 先从 map 中删除，防止 finalizeTask 在 prompt return 后重入
	executingTasks.delete(taskId);
	clearTimeout(executing.timeoutHandle);
	await runtime.abort(executing.sessionId);
	executing.abortController.abort();
	log.debug(`Abort called for session ${executing.sessionId}`);
}

export async function shutdownBatchTaskExecutor(): Promise<void> {
	acceptingJobs = false;
	if (shutdownPromise) return await shutdownPromise;
	shutdownPromise = (async () => {
		for (const [projectId, queue] of pendingByProject) {
			for (const job of queue) {
				emitBatchTaskEvent({ type: "task.dequeued", projectId, taskId: job.task.id });
			}
		}
		pendingByProject.clear();

		const activeTasks = [...executingTasks.values()];
		for (const executing of activeTasks) {
			executingTasks.delete(executing.taskId);
			clearTimeout(executing.timeoutHandle);
		}
		await Promise.allSettled(
			activeTasks.map(async (executing) => {
				await executing.runtime.abort(executing.sessionId);
				executing.abortController.abort();
			}),
		);
		await Promise.allSettled([...activeJobs]);
		runningByProject.clear();
		pendingByProject.clear();
	})();
	return await shutdownPromise;
}

export function isTaskRunning(taskId: string): boolean {
	return executingTasks.has(taskId);
}

export function getExecutingTaskIds(): string[] {
	return Array.from(executingTasks.keys());
}

export function getBatchTaskExecutorState(): {
	readonly acceptingJobs: boolean;
	readonly shutdownStarted: boolean;
	readonly activeTasks: Array<{
		readonly projectId: string;
		readonly taskId: string;
		readonly sessionId: string;
		readonly sessionPath: string | undefined;
	}>;
	readonly queuedTaskIds: string[];
} {
	return {
		acceptingJobs,
		shutdownStarted: shutdownPromise !== undefined,
		activeTasks: [...executingTasks.values()].map((executing) => ({
			projectId: executing.projectId,
			taskId: executing.taskId,
			sessionId: executing.sessionId,
			sessionPath: executing.sessionPath,
		})),
		queuedTaskIds: getQueuedTaskIds(),
	};
}
