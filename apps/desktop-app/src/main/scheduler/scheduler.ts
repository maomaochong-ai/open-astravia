import type { RuntimeHost } from "@vetta/runtime-core";
import { AsyncTask, CronJob, ToadScheduler } from "toad-scheduler";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { isValidCronExpression } from "./cron.js";
import { executeTask, isTaskRunning, shutdownSchedulerTaskExecutor } from "./task-executor";
import type { ScheduledTask as TaskData } from "./task-storage";
import { loadTasks, updateTaskEnabled } from "./task-storage";

const _scheduler = new ToadScheduler();
const scheduledJobs = new Map<string, CronJob>();
const log = getAppLogger("scheduler");
let acceptingSchedules = true;
let shutdownPromise: Promise<void> | undefined;

function getRuntime(): RuntimeHost {
	return getSharedRuntime();
}

export async function initScheduler(): Promise<void> {
	if (!acceptingSchedules) throw new Error("Scheduler is shutting down");
	const tasks = await loadTasks();
	let enabledCount = 0;

	for (const task of tasks) {
		if (task.enabled) {
			scheduleTaskInCron(task);
			enabledCount++;
		}
	}

	log.info(`Initialized with ${enabledCount} enabled tasks`);
}

export function scheduleTaskInCron(task: TaskData): void {
	if (!acceptingSchedules) throw new Error("Scheduler is shutting down");
	unscheduleTaskInCron(task.id);
	if (!isValidCronExpression(task.cron)) {
		throw new Error(`Invalid cron expression: ${task.cron}`);
	}

	const asyncTask = new AsyncTask(
		`scheduled-task-${task.id}`,
		async () => {
			log.info(`Executing task: ${task.name} (${task.id})`);
			if (isTaskRunning(task.id)) {
				log.warn(`Skipping task because it is already running: ${task.name} (${task.id})`);
				return;
			}
			try {
				await executeTask(task, getRuntime(), {
					onOneTimeCompleted: async () => {
						disableTaskInCron(task.id);
						await updateTaskEnabled(task.id, false);
					},
				});
			} catch (error) {
				log.error(`Task execution failed:`, error);
			}
		},
		(error: Error) => {
			log.error(`Task error: ${task.name} (${task.id})`, error);
		},
	);

	const job = new CronJob(
		{
			cronExpression: task.cron,
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		},
		asyncTask,
	);

	scheduledJobs.set(task.id, job);
	job.start();
}

export function unscheduleTaskInCron(taskId: string): void {
	const existing = scheduledJobs.get(taskId);
	if (existing) {
		existing.stop();
		scheduledJobs.delete(taskId);
	}
}

/** Stop and remove a scheduled job without changing task enabled state */
export function disableTaskInCron(taskId: string): void {
	unscheduleTaskInCron(taskId);
}

export async function rescheduleAll(): Promise<void> {
	if (!acceptingSchedules) throw new Error("Scheduler is shutting down");
	for (const job of scheduledJobs.values()) {
		job.stop();
	}
	scheduledJobs.clear();

	const tasks = await loadTasks();
	for (const task of tasks) {
		if (task.enabled) {
			scheduleTaskInCron(task);
		}
	}
}

export async function shutdownScheduler(): Promise<void> {
	acceptingSchedules = false;
	if (shutdownPromise) return await shutdownPromise;
	shutdownPromise = (async () => {
		for (const job of scheduledJobs.values()) job.stop();
		scheduledJobs.clear();
		await shutdownSchedulerTaskExecutor();
		_scheduler.stop();
	})();
	return await shutdownPromise;
}

export { getRuntime };
