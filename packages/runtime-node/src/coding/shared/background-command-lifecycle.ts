import type {
	BackgroundCommandHost,
	BackgroundCommandOutput,
	BackgroundCommandProcess,
} from "./background-command-host.js";
import type {
	BackgroundCommandEvent,
	BackgroundCommandService,
	BackgroundCommandSnapshot,
	BackgroundCommandStatus,
	BackgroundCommandStopReason,
	ReadBackgroundCommandOutputOptions,
	SpawnBackgroundCommandOptions,
} from "./background-command-service.js";

interface BackgroundCommandTask {
	snapshot: BackgroundCommandSnapshot;
	process: BackgroundCommandProcess;
	output: BackgroundCommandOutput;
	readOffset: number;
	writtenBytes: number;
	ended: boolean;
	notified: boolean;
	promoted: boolean;
	notifyOnlyIfPromoted: boolean;
	waiters: Array<() => void>;
	outputTimer?: ReturnType<typeof setTimeout>;
	stopReason?: BackgroundCommandStopReason;
}

const TAIL_MAX_CHARS = 2048;
const OUTPUT_EVENT_THROTTLE_MS = 200;

export function createBackgroundCommandService(host: BackgroundCommandHost): BackgroundCommandService {
	const tasks = new Map<string, BackgroundCommandTask>();
	const listeners: Array<(event: BackgroundCommandEvent) => void> = [];
	const notificationListeners: Array<(task: BackgroundCommandSnapshot) => void> = [];
	let counter = 0;

	const notifyObservers = <T>(observers: Array<(value: T) => void>, value: T): void => {
		for (const observer of observers) {
			try {
				observer(value);
			} catch (error) {
				console.warn("Background command observer failed.", error);
			}
		}
	};

	const emit = (event: BackgroundCommandEvent): void => {
		notifyObservers(listeners, event);
	};

	const scheduleOutputEvent = (task: BackgroundCommandTask): void => {
		if (task.outputTimer || task.ended) return;
		task.outputTimer = setTimeout(() => {
			task.outputTimer = undefined;
			if (!task.ended) emit({ type: "task_output", task: { ...task.snapshot } });
		}, OUTPUT_EVENT_THROTTLE_MS);
	};

	const finish = (
		task: BackgroundCommandTask,
		status: BackgroundCommandStatus,
		exitCode: number | undefined,
	): void => {
		if (task.ended) return;
		task.ended = true;
		if (task.outputTimer) {
			clearTimeout(task.outputTimer);
			task.outputTimer = undefined;
		}
		task.output.close();
		task.snapshot = {
			...task.snapshot,
			status: task.stopReason ? "killed" : status,
			exitCode,
			endedAt: Date.now(),
			...(task.stopReason ? { endedBy: task.stopReason } : {}),
		};

		const waiters = task.waiters.splice(0, task.waiters.length);
		for (const waiter of waiters) {
			try {
				waiter();
			} catch {
				// A waiter must not interrupt task finalization.
			}
		}

		emit({ type: "task_ended", task: { ...task.snapshot } });
		const shouldNotify = !task.notifyOnlyIfPromoted || task.promoted;
		if (shouldNotify && !task.notified) {
			task.notified = true;
			notifyObservers(notificationListeners, { ...task.snapshot });
		}
	};

	const appendOutput = (task: BackgroundCommandTask, text: string): void => {
		if (!text || task.ended) return;
		task.output.append(text);
		task.writtenBytes += Buffer.byteLength(text, "utf-8");
		task.snapshot = {
			...task.snapshot,
			tail: (task.snapshot.tail + text).slice(-TAIL_MAX_CHARS),
		};
		scheduleOutputEvent(task);
	};

	const stop = (taskId: string, reason?: BackgroundCommandStopReason): boolean => {
		const task = tasks.get(taskId);
		if (!task || task.ended) return false;
		if (reason) task.stopReason = reason;
		task.process.stop();
		return true;
	};

	return {
		spawn(options: SpawnBackgroundCommandOptions): BackgroundCommandSnapshot {
			const id = `b${++counter}`;
			const output = host.outputStore.create(id);
			const initialSnapshot: BackgroundCommandSnapshot = {
				id,
				command: options.command,
				cwd: options.cwd,
				status: "running",
				outputFile: output.path,
				exitCode: undefined,
				startedAt: Date.now(),
				toolCallId: options.toolCallId,
				tail: "",
			};
			let task: BackgroundCommandTask | undefined;
			const process = host.processOperations.spawn({
				command: options.command,
				cwd: options.cwd,
				env: options.env,
				onOutput: (text) => {
					if (task) appendOutput(task, text);
				},
				onExit: (exitCode) => {
					if (!task) return;
					finish(task, exitCode === undefined ? "killed" : exitCode === 0 ? "completed" : "failed", exitCode);
				},
				onError: (error) => {
					if (!task) return;
					appendOutput(task, `\nFailed to spawn command: ${error.message}\n`);
					finish(task, "failed", undefined);
				},
			});
			task = {
				snapshot: initialSnapshot,
				process,
				output,
				readOffset: 0,
				writtenBytes: 0,
				ended: false,
				notified: false,
				promoted: false,
				notifyOnlyIfPromoted: options.notifyOnlyIfPromoted ?? false,
				waiters: [],
			};
			tasks.set(id, task);
			emit({ type: "task_started", task: { ...initialSnapshot } });
			return { ...initialSnapshot };
		},
		subscribe(listener) {
			listeners.push(listener);
			return () => {
				const index = listeners.indexOf(listener);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
		subscribeNotifications(listener) {
			notificationListeners.push(listener);
			return () => {
				const index = notificationListeners.indexOf(listener);
				if (index >= 0) notificationListeners.splice(index, 1);
			};
		},
		async wait(taskId, options) {
			const task = tasks.get(taskId);
			if (!task) throw new Error(`Background task "${taskId}" not found.`);
			if (task.ended) return { stillRunning: false, snapshot: { ...task.snapshot } };
			if (options.signal?.aborted) {
				stop(taskId);
				throw new Error("aborted");
			}

			return new Promise((resolve, reject) => {
				let settled = false;
				let timer: ReturnType<typeof setTimeout>;
				const cleanup = (): void => {
					options.signal?.removeEventListener("abort", onAbort);
					clearTimeout(timer);
					const index = task.waiters.indexOf(onEnd);
					if (index >= 0) task.waiters.splice(index, 1);
				};
				const settle = (stillRunning: boolean): void => {
					if (settled) return;
					settled = true;
					cleanup();
					if (stillRunning) task.promoted = true;
					resolve({ stillRunning, snapshot: { ...task.snapshot } });
				};
				const onEnd = (): void => settle(false);
				const onAbort = (): void => {
					if (settled) return;
					settled = true;
					cleanup();
					stop(taskId);
					reject(new Error("aborted"));
				};

				timer = setTimeout(() => settle(true), Math.max(0, options.maxMs));
				task.waiters.push(onEnd);
				options.signal?.addEventListener("abort", onAbort, { once: true });
				if (task.ended) settle(false);
			});
		},
		get(taskId) {
			const task = tasks.get(taskId);
			return task ? { ...task.snapshot } : undefined;
		},
		list() {
			return [...tasks.values()].map((task) => ({ ...task.snapshot }));
		},
		clearFinished() {
			let cleared = 0;
			for (const [taskId, task] of tasks) {
				if (!task.ended) continue;
				tasks.delete(taskId);
				cleared += 1;
			}
			if (cleared > 0) emit({ type: "tasks_cleared" });
			return cleared;
		},
		readOutput(taskId: string, options: ReadBackgroundCommandOutputOptions): string {
			const task = tasks.get(taskId);
			if (!task) return "";
			const start = options.fromStart ? 0 : task.readOffset;
			if (options.advanceCursor) task.readOffset = task.writtenBytes;
			try {
				return task.output.read(start);
			} catch {
				return "";
			}
		},
		stop,
		dispose() {
			for (const [id, task] of tasks) {
				if (!task.ended) stop(id, "dispose");
			}
		},
		async shutdown() {
			const completions: Promise<void>[] = [];
			for (const [id, task] of tasks) {
				if (task.ended) continue;
				completions.push(
					new Promise((resolve) => {
						task.waiters.push(resolve);
					}),
				);
				stop(id, "dispose");
			}
			await Promise.all(completions);
		},
	};
}
