import type { RuntimeHost } from "@vetta/runtime-core";
import { Cron } from "croner";
import { powerMonitor } from "electron";
import { type AutomationNotRunReason, automationScheduleToCron, type ScheduledTask } from "../../shared/automation.js";
import { emitTaskEvent } from "../ipc/scheduler.js";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { isValidSchedule, localTimezone, nextFireTime, summarizeFireTimes } from "./cron.js";
import { executeTask, shutdownSchedulerTaskExecutor } from "./task-executor.js";
import {
	generateId,
	loadTasks,
	readSchedulerState,
	updateTask,
	writeRecord,
	writeSchedulerState,
} from "./task-storage.js";

const scheduledJobs = new Map<string, Cron>();
const log = getAppLogger("scheduler");
/** 存活心跳间隔：应用崩溃时，最多有这么长的空窗不会被记为「已错过」。 */
const HEARTBEAT_MS = 60_000;

let acceptingSchedules = true;
let shutdownPromise: Promise<void> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let suspendedAt: number | undefined;
let powerListenersAttached = false;

function getRuntime(): RuntimeHost {
	return getSharedRuntime();
}

function writeHeartbeat(): void {
	void writeSchedulerState({ aliveAt: Date.now() }).catch((error) => log.warn("heartbeat write failed", error));
}

export async function initScheduler(): Promise<void> {
	if (!acceptingSchedules) throw new Error("Scheduler is shutting down");
	const now = Date.now();
	const previous = await readSchedulerState();
	const tasks = await loadTasks();
	if (previous) await recordMissedRuns(tasks, previous.aliveAt, now, "app-not-running");
	const enabled = (await loadTasks()).filter((task) => task.enabled);
	for (const task of enabled) scheduleTaskInCron(task);
	writeHeartbeat();
	heartbeatTimer ??= setInterval(writeHeartbeat, HEARTBEAT_MS);
	attachPowerListeners();
	log.info(`Initialized with ${enabled.length} enabled tasks`);
}

/**
 * 休眠期间计时器冻结，唤醒后 croner 可能立刻补触发积压的一次：休眠前先停掉所有作业，
 * 唤醒后把这段时间本该触发的记为「已错过」，再重新排程（ADR-0127：不补跑）。
 */
function attachPowerListeners(): void {
	if (powerListenersAttached) return;
	powerListenersAttached = true;
	powerMonitor.on("suspend", () => {
		suspendedAt = Date.now();
		for (const job of scheduledJobs.values()) job.stop();
		scheduledJobs.clear();
		writeHeartbeat();
	});
	powerMonitor.on("resume", () => {
		const from = suspendedAt;
		suspendedAt = undefined;
		if (!acceptingSchedules || from === undefined) return;
		void (async () => {
			const tasks = await loadTasks();
			await recordMissedRuns(tasks, from, Date.now(), "system-sleep");
			await rescheduleAll();
			writeHeartbeat();
		})().catch((error) => log.error("resume reschedule failed", error));
	});
}

/** 连续错过的合并成一条记录；错过的一次性任务随之停用。 */
export async function recordMissedRuns(
	tasks: readonly ScheduledTask[],
	from: number,
	to: number,
	reason: Extract<AutomationNotRunReason, "app-not-running" | "system-sleep">,
): Promise<void> {
	let changed = false;
	for (const task of tasks) {
		if (!task.enabled) continue;
		// 任务在窗口内才被创建/修改/运行过的，窗口起点顺延到那一刻，免得把「还不存在」记成错过。
		const windowStart = Math.max(from, task.updatedAt, task.lastRunAt ?? 0);
		const summary = summarizeFireTimes(task.schedule, windowStart, to);
		if (!summary) continue;
		await writeRecord({
			id: generateId(),
			taskId: task.id,
			mode: task.runTarget.mode,
			startedAt: summary.first,
			completedAt: summary.first,
			status: "missed",
			reason,
			missedCount: summary.count,
			...(summary.count > 1 ? { missedUntil: summary.last } : {}),
			prompt: task.prompt,
			responsePreview: "",
		});
		if (task.schedule.kind === "once") {
			await updateTask(task.id, (current) => ({ ...current, enabled: false, updatedAt: Date.now() }));
			changed = true;
		}
		emitTaskEvent({ type: "record.updated", taskId: task.id });
	}
	if (changed) emitTaskEvent({ type: "tasks.changed" });
}

async function runScheduled(taskId: string): Promise<void> {
	// 以触发时刻的最新配置执行：编辑后的内容从下一次触发开始生效。
	const task = (await loadTasks()).find((candidate) => candidate.id === taskId);
	if (!task?.enabled) return;
	log.info(`Executing task: ${task.name} (${task.id})`);
	writeHeartbeat();
	try {
		await executeTask(task, getRuntime(), { trigger: "schedule", onTaskChanged: syncTaskSchedule });
	} catch (error) {
		log.error("Task execution failed:", error);
	}
}

export function scheduleTaskInCron(task: ScheduledTask): void {
	if (!acceptingSchedules) throw new Error("Scheduler is shutting down");
	unscheduleTaskInCron(task.id);
	if (!isValidSchedule(task.schedule)) {
		throw new Error(`Invalid schedule for task: ${task.id}`);
	}
	const options = { timezone: localTimezone(), protect: true, catch: true };
	const handler = () => void runScheduled(task.id);
	if (task.schedule.kind === "once") {
		if (task.schedule.at <= Date.now()) return;
		scheduledJobs.set(task.id, new Cron(new Date(task.schedule.at), options, handler));
		return;
	}
	if (task.schedule.kind === "interval") {
		// 间隔不是 cron：每次只排下一个触发点，触发后再排下一个，始终对齐 startAt。
		const next = nextFireTime(task.schedule, Date.now());
		if (next === null) return;
		scheduledJobs.set(
			task.id,
			new Cron(new Date(next), options, () => {
				if (acceptingSchedules) scheduleTaskInCron(task);
				handler();
			}),
		);
		return;
	}
	const cron = automationScheduleToCron(task.schedule);
	if (cron) scheduledJobs.set(task.id, new Cron(cron, options, handler));
}

export function unscheduleTaskInCron(taskId: string): void {
	scheduledJobs.get(taskId)?.stop();
	scheduledJobs.delete(taskId);
}

/** 按任务当前配置同步作业：启用则（重新）排程，停用则撤下。 */
export function syncTaskSchedule(task: ScheduledTask): void {
	if (task.enabled && acceptingSchedules) scheduleTaskInCron(task);
	else unscheduleTaskInCron(task.id);
}

export async function rescheduleAll(): Promise<void> {
	if (!acceptingSchedules) throw new Error("Scheduler is shutting down");
	for (const job of scheduledJobs.values()) job.stop();
	scheduledJobs.clear();
	for (const task of await loadTasks()) {
		if (task.enabled) scheduleTaskInCron(task);
	}
}

export async function shutdownScheduler(): Promise<void> {
	acceptingSchedules = false;
	if (shutdownPromise) return await shutdownPromise;
	shutdownPromise = (async () => {
		for (const job of scheduledJobs.values()) job.stop();
		scheduledJobs.clear();
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		heartbeatTimer = undefined;
		await shutdownSchedulerTaskExecutor();
		// 正常退出时把心跳写到最后一刻，下次启动的「已错过」窗口从这里算起。
		await writeSchedulerState({ aliveAt: Date.now() }).catch(() => {});
	})();
	return await shutdownPromise;
}

export { getRuntime };
