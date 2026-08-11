import type { SessionExecutionMode } from "@vetta/runtime-core";
import type { ExecutionModeOverride, SelectedSkillRef } from "./shared.js";

export type BatchTaskStatus = "pending" | "running" | "completed" | "failed" | "paused";

export interface BatchTask {
	id: string;
	name: string;
	cwd: string;
	sourcePath: string;
	status: BatchTaskStatus;
	sessionId?: string;
	sessionPath?: string;
	executionMode?: SessionExecutionMode;
	error?: string;
	createdAt: number;
	updatedAt: number;
}

export interface BatchProject {
	id: string;
	name: string;
	prompt: string;
	modelKey?: string;
	executionMode?: ExecutionModeOverride;
	concurrency: number;
	artifactPatterns?: string[];
	notifyEnabled?: boolean;
	timeoutMinutes?: number;
	skill?: SelectedSkillRef;
	tasks: BatchTask[];
	createdAt: number;
	updatedAt: number;
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

export interface DesktopBatchTasksApi {
	getProjects(): Promise<BatchProject[]>;
	createProject(data: {
		name: string;
		prompt: string;
		modelKey?: string;
		executionMode?: ExecutionModeOverride;
		folders: string[];
		concurrency: number;
		artifactPatterns?: string[];
		notifyEnabled?: boolean;
		timeoutMinutes?: number;
		skill?: SelectedSkillRef;
	}): Promise<BatchProject>;
	updateProject(
		projectId: string,
		data: Partial<{
			name: string;
			prompt: string;
			modelKey: string;
			executionMode: ExecutionModeOverride;
			concurrency: number;
			artifactPatterns: string[];
			notifyEnabled: boolean;
			timeoutMinutes: number;
			newFolders: string[];
			skill: SelectedSkillRef | null;
		}>,
	): Promise<void>;
	deleteProject(projectId: string): Promise<void>;
	runTask(projectId: string, taskId: string): Promise<void>;
	retryTask(projectId: string, taskId: string): Promise<void>;
	stopTask(projectId: string, taskId: string): Promise<void>;
	deleteTask(projectId: string, taskId: string): Promise<void>;
	batchDelete(projectId: string): Promise<void>;
	batchStart(projectId: string): Promise<void>;
	batchStop(projectId: string): Promise<void>;
	batchReset(projectId: string): Promise<void>;
	batchResetFailed(projectId: string, taskIds: string[]): Promise<void>;
	deleteSession(sessionPath: string): Promise<void>;
	resumeTask(projectId: string, taskId: string): Promise<void>;
	resumeTaskWithText(projectId: string, taskId: string, text: string): Promise<void>;
	onTaskEvent(handler: (event: BatchTaskEvent) => void): () => void;
}
