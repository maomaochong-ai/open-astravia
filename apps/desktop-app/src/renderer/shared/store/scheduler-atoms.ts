import { atom } from "jotai";
import type { ExecutionModeOverride, SelectedSkill, SessionExecutionMode } from "./chat-atoms";

export interface ScheduledTask {
	id: string;
	name: string;
	prompt: string;
	cron: string;
	/** Whether this task runs only once and disables itself after execution */
	isOnce: boolean;
	enabled: boolean;
	/** Working directory used when the task executes */
	cwd: string;
	modelKey?: string;
	executionMode?: ExecutionModeOverride;
	/** 任务级技能/场景。运行时通过 PromptRequest.promptRef 结构化传递。 */
	skill?: SelectedSkill;
	createdAt: number;
	updatedAt: number;
	lastRunAt: number | null;
	lastRunStatus: "success" | "failed" | null;
}

export interface TaskExecutionRecord {
	id: string;
	taskId: string;
	sessionId: string;
	/** Session file path for navigating to the conversation */
	sessionPath?: string;
	/** Working directory used for this execution */
	cwd?: string;
	startedAt: number;
	completedAt: number | null;
	status: "running" | "success" | "failed" | "aborted";
	prompt: string;
	responsePreview: string;
	error?: string;
	durationMs?: number;
	executionMode?: SessionExecutionMode;
}

export const scheduledTasksAtom = atom<ScheduledTask[]>([]);
/** 当前正在执行的任务 id 集合，由 task.started/record.updated 等事件维护。 */
export const runningTaskIdsAtom = atom<Set<string>>(new Set<string>());
export const selectedTaskIdAtom = atom<string | null>(null);
export const selectedRecordIdAtom = atom<string | null>(null);
export const formOpenAtom = atom<ScheduledTask | null | undefined>(undefined);

/**
 * 所有定时任务执行产生的 session 路径集合。侧栏据此给对应 session item
 * 挂定时图标（数据源是调度执行记录里的 sessionPath，可靠且不依赖会话名）。
 */
export const scheduledSessionPathsAtom = atom<Set<string>>(new Set<string>());

/** 自增计数器：删除执行记录后 +1，驱动正在展示的执行历史重新拉取。 */
export const scheduledRecordsVersionAtom = atom(0);
