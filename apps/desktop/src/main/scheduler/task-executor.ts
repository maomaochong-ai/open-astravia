import { existsSync } from "node:fs";
import { CODING_AGENT_UNATTENDED_TURN_METADATA_KEY } from "@vetta/coding-agent/function-extensions";
import {
	CODING_AGENT_PERMISSION_MODE_SET,
	CODING_AGENT_PLAN_MODE_STATE_READ,
} from "@vetta/coding-agent/session-extensions";
import type { PromptRequest, RuntimeHost, SessionExecutionMode } from "@vetta/runtime-core";
import { prepareInputPrompt } from "../../renderer/shared/lib/input-tokens/prepare.js";
import type { AutomationSuspendReason, ScheduledTask, TaskExecutionRecord } from "../../shared/automation.js";
import { formatScheduleSessionName } from "../../shared/scheduled-session.js";
import { recordAutomationRunStarted } from "../app-monitor/app-monitor-service.js";
import {
	type DesktopConversationSession,
	getDesktopConversationService,
} from "../conversations/desktop-conversation-service.js";
import { isConversationCwd } from "../conversations/session-paths.js";
import { mainT } from "../i18n/index.js";
import { readDesktopConfig } from "../ipc/fs.js";
import { emitTaskEvent } from "../ipc/scheduler.js";
import { getAppLogger } from "../logger.js";
import { getDesktopModelSettingsService } from "../models/model-settings-host.js";
import { sameProjectPath } from "../projects/project-path.js";
import { notifyAutomationFinished } from "./automation-notifier.js";
import { generateId, updateTask, updateTaskLastRun, writeRecord } from "./task-storage.js";

const log = getAppLogger("scheduler");

/** 绑定会话正忙时，每隔这么久复查一次是否已空闲。 */
const BUSY_POLL_MS = 2_000;

interface ExecutingTask {
	sessionId?: string;
	runtime: RuntimeHost;
	readonly controller: AbortController;
}

const executingTasks = new Map<string, ExecutingTask>();
const activeExecutions = new Set<Promise<void>>();
let acceptingExecutions = true;
let shutdownPromise: Promise<void> | undefined;

export type AutomationTrigger = "schedule" | "manual";

export interface ExecuteTaskOptions {
	readonly trigger: AutomationTrigger;
	/** 任务配置被执行器改写（暂停、停用、回写绑定会话）后通知调度层同步。 */
	readonly onTaskChanged?: (task: ScheduledTask) => void;
}

export class AutomationAlreadyRunningError extends Error {
	constructor(readonly taskId: string) {
		super(`Scheduled task is already running: ${taskId}`);
		this.name = "AutomationAlreadyRunningError";
	}
}

export function executeTask(task: ScheduledTask, runtime: RuntimeHost, options: ExecuteTaskOptions): Promise<void> {
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

function baseRecord(task: ScheduledTask, startedAt: number): TaskExecutionRecord {
	return {
		id: generateId(),
		taskId: task.id,
		mode: task.runTarget.mode,
		startedAt,
		completedAt: null,
		status: "running",
		prompt: task.prompt,
		responsePreview: "",
	};
}

async function executeTaskInner(task: ScheduledTask, runtime: RuntimeHost, options: ExecuteTaskOptions): Promise<void> {
	const startedAt = Date.now();
	if (isTaskRunning(task.id)) {
		if (options.trigger === "manual") throw new AutomationAlreadyRunningError(task.id);
		// 同一个自动化同时只跑一次：上次没结束，这次记为「已跳过」，不排队累积。
		await writeRecord({
			...baseRecord(task, startedAt),
			status: "skipped",
			reason: "previous-running",
			completedAt: startedAt,
		});
		emitTaskEvent({ type: "record.updated", taskId: task.id });
		return;
	}

	const executing: ExecutingTask = { runtime, controller: new AbortController() };
	executingTasks.set(task.id, executing);
	let record: TaskExecutionRecord = baseRecord(task, startedAt);
	let reply = "";
	try {
		const invalidTarget = await findInvalidTarget(task);
		if (invalidTarget) {
			await suspendTask(task, invalidTarget, options);
			throw new Error(mainT(`automation:suspended.${invalidTarget}`));
		}

		const session = await acquireSession(task);
		executing.sessionId = session.sessionId;
		record = { ...record, sessionId: session.sessionId, sessionPath: session.sessionPath, cwd: session.cwd };
		recordAutomationRunStarted();

		const isNewSession = task.runTarget.mode === "new-session" || task.runTarget.sessionPath === null;
		const sessionName = isNewSession
			? task.runTarget.mode === "new-session"
				? formatScheduleSessionName(task.name, startedAt)
				: task.name
			: undefined;
		if (sessionName) await runtime.renameSessionById(session.sessionId, sessionName);

		await writeRecord(record);
		emitTaskEvent({
			type: "task.started",
			taskId: task.id,
			taskName: task.name,
			recordId: record.id,
			sessionId: session.sessionId,
			sessionPath: session.sessionPath,
			listCwd: session.listCwd,
			sessionName: sessionName ?? task.name,
			firstMessage: task.prompt.slice(0, 80),
			mode: task.runTarget.mode,
		});

		// 绑定会话里用户可能正在聊天：排在当前这一轮之后，不打断也不跳过。
		await waitForSessionIdle(runtime, session.sessionId, executing.controller.signal);
		const outcome = await withUnattendedSessionModes(runtime, session.sessionId, async () =>
			runtime.prompt(session.sessionId, await buildPromptRequest(task)),
		);
		reply = readLastAssistantText(runtime, session.sessionId);
		const completedAt = Date.now();
		record = {
			...record,
			status: outcome.status === "cancelled" ? "aborted" : outcome.status === "failed" ? "failed" : "success",
			...(outcome.status === "failed" && outcome.error ? { error: outcome.error.message } : {}),
			completedAt,
			durationMs: completedAt - startedAt,
			responsePreview: reply.slice(0, 500),
		};

		if (task.runTarget.mode === "same-session" && task.runTarget.sessionPath === null) {
			await bindCreatedSession(task, session.sessionPath, options);
		}
	} catch (error) {
		const completedAt = Date.now();
		record = {
			...record,
			status: executing.controller.signal.aborted ? "aborted" : "failed",
			error: error instanceof Error ? error.message : String(error),
			completedAt,
			durationMs: completedAt - startedAt,
		};
		log.warn(`automation run failed: ${task.name} (${task.id})`, error);
	} finally {
		executingTasks.delete(task.id);
	}

	const notifyError = await notifyAutomationFinished(task, record, reply);
	if (notifyError) record = { ...record, notifyError };
	await writeRecord(record);
	await updateTaskLastRun(task.id, record.status === "success" ? "success" : "failed");
	if (task.schedule.kind === "once" && options.trigger === "schedule") {
		const updated = await updateTask(task.id, (current) => ({ ...current, enabled: false, updatedAt: Date.now() }));
		if (updated) options.onTaskChanged?.(updated);
	}
	emitTaskEvent({ type: "record.updated", taskId: task.id });
	emitTaskEvent({ type: "tasks.changed" });
}

async function findInvalidTarget(task: ScheduledTask): Promise<AutomationSuspendReason | undefined> {
	const { projectCwd } = task.runTarget;
	if (!isConversationCwd(projectCwd)) {
		const config = await readDesktopConfig();
		const known = [...(config.projects ?? []), ...(config.archivedProjects ?? [])].some((project) =>
			sameProjectPath(project.path, projectCwd),
		);
		if (!known) return "project-removed";
	}
	if (
		task.runTarget.mode === "same-session" &&
		task.runTarget.sessionPath &&
		!existsSync(task.runTarget.sessionPath)
	) {
		return "session-deleted";
	}
	return undefined;
}

async function suspendTask(
	task: ScheduledTask,
	reason: AutomationSuspendReason,
	options: ExecuteTaskOptions,
): Promise<void> {
	const updated = await updateTask(task.id, (current) => ({
		...current,
		enabled: false,
		suspendedReason: reason,
		updatedAt: Date.now(),
	}));
	if (updated) options.onTaskChanged?.(updated);
}

async function bindCreatedSession(
	task: ScheduledTask,
	sessionPath: string,
	options: ExecuteTaskOptions,
): Promise<void> {
	// 会话文件在首轮回复后才落盘；没落盘就保持未绑定，下次再新建，避免绑定到不存在的文件。
	if (!existsSync(sessionPath)) return;
	const updated = await updateTask(task.id, (current) =>
		current.runTarget.mode === "same-session" && current.runTarget.sessionPath === null
			? { ...current, runTarget: { ...current.runTarget, sessionPath } }
			: current,
	);
	if (updated) options.onTaskChanged?.(updated);
}

async function acquireSession(task: ScheduledTask): Promise<DesktopConversationSession> {
	const conversations = getDesktopConversationService();
	const { runTarget } = task;
	const kind = isConversationCwd(runTarget.projectCwd) ? "conversation" : "other";
	if (runTarget.mode === "same-session" && runTarget.sessionPath) {
		// 以会话平时的执行模式打开，自动化这一轮再临时切到完全访问，结束后还原。
		const config = await readDesktopConfig();
		const preferred: SessionExecutionMode = config.defaultExecutionMode === "sandbox" ? "sandbox" : "full-access";
		try {
			return await conversations.openSession(runTarget.sessionPath, preferred, "automation");
		} catch (error) {
			if (preferred === "full-access") throw error;
			return await conversations.openSession(runTarget.sessionPath, "full-access", "automation");
		}
	}
	return await conversations.createSession(
		{
			cwd: runTarget.projectCwd,
			executionMode: "full-access",
			agentMode: "work",
			// 每次新建的会话只为这一轮存在，用 automation 场景：不提供提问与计划模式。
			// 「开启一个新会话」之后用户也会在里面手动聊天，保留普通场景，靠单轮否决兜底。
			...(runTarget.mode === "new-session" ? { scenario: "automation" as const } : {}),
		},
		kind,
		"automation",
	);
}

async function buildPromptRequest(task: ScheduledTask): Promise<PromptRequest> {
	const prepared = prepareInputPrompt(task.prompt);
	const modelKey = task.model?.key ?? (await getDesktopModelSettingsService().list()).defaultModel ?? undefined;
	return {
		text: prepared.text,
		...(prepared.sceneName ? { promptRef: { kind: "scene" as const, name: prepared.sceneName } } : {}),
		...(modelKey ? { modelKey } : {}),
		...(task.model?.reasoning ? { reasoning: task.model.reasoning } : {}),
		metadata: { [CODING_AGENT_UNATTENDED_TURN_METADATA_KEY]: true, automationTaskId: task.id },
	};
}

async function waitForSessionIdle(runtime: RuntimeHost, sessionId: string, signal: AbortSignal): Promise<void> {
	while (runtime.getState(sessionId).isStreaming) {
		signal.throwIfAborted();
		await new Promise<void>((resolve) => {
			const timer = setTimeout(done, BUSY_POLL_MS);
			const unsubscribe = runtime.subscribe(sessionId, (event) => {
				if (event.type === "session.lifecycle" && (event.phase === "agent_end" || event.phase === "aborted"))
					done();
			});
			signal.addEventListener("abort", done, { once: true });
			function done(): void {
				clearTimeout(timer);
				unsubscribe();
				signal.removeEventListener("abort", done);
				resolve();
			}
		});
	}
	signal.throwIfAborted();
}

/**
 * 无人值守的一轮：执行模式固定完全访问、不受计划模式约束；结束后还原会话原来的设置，
 * 用户在同一会话里的手动轮次不受影响。新建的 automation 场景会话没有计划模式，读取失败即跳过。
 */
async function withUnattendedSessionModes<T>(
	runtime: RuntimeHost,
	sessionId: string,
	run: () => Promise<T>,
): Promise<T> {
	const previousExecutionMode = runtime.getState(sessionId).executionMode;
	let previousPermissionMode: "default" | "plan" | undefined;
	try {
		previousPermissionMode = runtime.invokeSessionExtensionSync(
			sessionId,
			CODING_AGENT_PLAN_MODE_STATE_READ,
			undefined,
		).permissionMode;
	} catch {
		previousPermissionMode = undefined;
	}
	if (previousExecutionMode !== "full-access") await runtime.setExecutionMode(sessionId, "full-access");
	if (previousPermissionMode === "plan") {
		runtime.invokeSessionExtensionSync(sessionId, CODING_AGENT_PERMISSION_MODE_SET, { permissionMode: "default" });
	}
	try {
		return await run();
	} finally {
		if (previousExecutionMode !== "full-access") {
			await runtime.setExecutionMode(sessionId, previousExecutionMode).catch(() => {});
		}
		if (previousPermissionMode === "plan") {
			try {
				runtime.invokeSessionExtensionSync(sessionId, CODING_AGENT_PERMISSION_MODE_SET, { permissionMode: "plan" });
			} catch {
				// 会话可能已被关闭；还原失败不影响本次执行结果。
			}
		}
	}
}

function readLastAssistantText(runtime: RuntimeHost, sessionId: string): string {
	try {
		const messages = runtime.getMessages(sessionId);
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index] as { role?: string; content?: unknown };
			if (message.role !== "assistant") continue;
			if (typeof message.content === "string") return message.content;
			if (!Array.isArray(message.content)) return "";
			return message.content
				.flatMap((part: { type?: string; text?: string }) =>
					part.type === "text" && typeof part.text === "string" ? [part.text] : [],
				)
				.join("");
		}
	} catch {
		// 会话已被释放时拿不到消息，通知里回复留空即可。
	}
	return "";
}

export async function abortTask(taskId: string): Promise<boolean> {
	const executing = executingTasks.get(taskId);
	if (!executing) return false;
	executing.controller.abort();
	if (executing.sessionId) await executing.runtime.abort(executing.sessionId).catch(() => {});
	return true;
}

export async function shutdownSchedulerTaskExecutor(): Promise<void> {
	acceptingExecutions = false;
	if (shutdownPromise) return await shutdownPromise;
	shutdownPromise = (async () => {
		await Promise.allSettled([...executingTasks.keys()].map((taskId) => abortTask(taskId)));
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
		readonly sessionId: string | undefined;
		readonly sessionPath: string | undefined;
	}>;
} {
	return {
		acceptingExecutions,
		shutdownStarted: shutdownPromise !== undefined,
		activeTasks: [...executingTasks.entries()].map(([taskId, executing]) => ({
			taskId,
			sessionId: executing.sessionId,
			sessionPath: executing.sessionId ? executing.runtime.getSessionPath(executing.sessionId) : undefined,
		})),
	};
}
