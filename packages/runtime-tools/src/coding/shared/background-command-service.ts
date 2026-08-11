export type BackgroundCommandStatus = "running" | "completed" | "failed" | "killed";
export type BackgroundCommandStopReason = "user" | "agent" | "dispose";

export interface BackgroundCommandSnapshot {
	readonly id: string;
	readonly command: string;
	readonly cwd: string;
	readonly status: BackgroundCommandStatus;
	readonly outputFile: string;
	readonly exitCode: number | undefined;
	readonly startedAt: number;
	readonly endedAt?: number;
	readonly toolCallId?: string;
	readonly tail: string;
	readonly endedBy?: BackgroundCommandStopReason;
}

export type BackgroundCommandEvent =
	| { readonly type: "task_started"; readonly task: BackgroundCommandSnapshot }
	| { readonly type: "task_output"; readonly task: BackgroundCommandSnapshot }
	| { readonly type: "task_ended"; readonly task: BackgroundCommandSnapshot }
	| { readonly type: "tasks_cleared" };

export interface SpawnBackgroundCommandOptions {
	readonly command: string;
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
	readonly toolCallId?: string;
	readonly notifyOnlyIfPromoted?: boolean;
}

export interface ReadBackgroundCommandOutputOptions {
	readonly fromStart: boolean;
	readonly advanceCursor: boolean;
}

export interface BackgroundCommandService {
	spawn(options: SpawnBackgroundCommandOptions): BackgroundCommandSnapshot;
	subscribe(listener: (event: BackgroundCommandEvent) => void): () => void;
	subscribeNotifications(listener: (task: BackgroundCommandSnapshot) => void): () => void;
	wait(
		taskId: string,
		options: { readonly maxMs: number; readonly signal?: AbortSignal },
	): Promise<{ readonly stillRunning: boolean; readonly snapshot: BackgroundCommandSnapshot }>;
	get(taskId: string): BackgroundCommandSnapshot | undefined;
	list(): readonly BackgroundCommandSnapshot[];
	clearFinished(): number;
	readOutput(taskId: string, options: ReadBackgroundCommandOutputOptions): string;
	stop(taskId: string, reason?: BackgroundCommandStopReason): boolean;
	dispose(): void;
	shutdown(): Promise<void>;
}

export function buildBackgroundCommandNotification(task: BackgroundCommandSnapshot): string {
	const statusText =
		task.status === "completed"
			? `completed (exit code ${task.exitCode ?? 0})`
			: task.status === "killed"
				? task.endedBy === "user"
					? "was terminated by the user from the UI"
					: "was killed"
				: `failed (exit code ${task.exitCode ?? "unknown"})`;
	const summary = `Background command "${task.command}" ${statusText}`;
	const userStopNote =
		task.status === "killed" && task.endedBy === "user"
			? "The user manually stopped this background task. Do not restart it unless the user asks."
			: undefined;
	return [
		"<task-notification>",
		`<task-id>${task.id}</task-id>`,
		...(task.toolCallId ? [`<tool-use-id>${task.toolCallId}</tool-use-id>`] : []),
		`<status>${task.status}</status>`,
		...(task.endedBy ? [`<ended-by>${task.endedBy}</ended-by>`] : []),
		`<output-file>${task.outputFile}</output-file>`,
		`<summary>${summary}</summary>`,
		"</task-notification>",
		"",
		...(userStopNote ? [userStopNote, ""] : []),
		"Use the task_output tool to read the command output if needed.",
	].join("\n");
}
