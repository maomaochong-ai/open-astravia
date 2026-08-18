import { atom } from "jotai";
import type { ExecutionModeOverride, SelectedSkill, SessionExecutionMode } from "./chat-atoms";

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
	/** Project-level model key in "provider/modelId" format */
	modelKey?: string;
	executionMode?: ExecutionModeOverride;
	concurrency: number;
	artifactPatterns?: string[];
	/** When true, finalized subtasks broadcast a webhook notification. */
	notifyEnabled?: boolean;
	/** Per-task hard timeout in minutes. Defaults to 60 when undefined. */
	timeoutMinutes?: number;
	/** 项目级技能/场景。运行时通过 PromptRequest.promptRef 结构化传递。 */
	skill?: SelectedSkill;
	tasks: BatchTask[];
	createdAt: number;
	updatedAt: number;
}

export interface BatchSession {
	id: string;
	projectId: string;
	taskId: string;
	path: string;
	name: string;
	firstMessage: string;
	modifiedAt: number;
}

export interface BatchTaskState {
	taskId: string;
	status: BatchTaskStatus;
	sessionId?: string;
	sessionPath?: string;
	executionMode?: SessionExecutionMode;
	error?: string;
	startedAt?: number;
	completedAt?: number;
	lastModified: number;
}

export const batchProjectsAtom = atom<BatchProject[]>([]);
export const batchSessionsMapAtom = atom<Map<string, BatchSession[]>>(new Map());
export const selectedBatchProjectIdAtom = atom<string | null>(null);
export const selectedBatchTaskIdAtom = atom<string | null>(null);
export const batchProjectDialogOpenAtom = atom<BatchProject | null | undefined>(undefined);
export const expandedBatchProjectsAtom = atom<Set<string>>(new Set<string>());
export const batchProjectsOffsetAtom = atom<number>(0);
export const batchProjectsHasMoreAtom = atom<boolean>(true);
export const batchTaskStatesAtom = atom<Record<string, Record<string, BatchTaskState>>>({});

/**
 * 后端调度器排队中、但还未真正启动的 taskId 集合。
 * 与持久化的 BatchTask.status 解耦，仅在主进程内存中维护，重启后清空。
 */
export const batchQueuedTaskIdsAtom = atom<Set<string>>(new Set<string>());
