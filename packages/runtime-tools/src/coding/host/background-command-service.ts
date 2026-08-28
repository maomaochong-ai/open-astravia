export type BackgroundCommandStatus = "running" | "completed" | "failed" | "killed";
export type BackgroundCommandStopReason = "caller" | "agent" | "dispose";

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
	readonly env: Readonly<Record<string, string | undefined>>;
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
