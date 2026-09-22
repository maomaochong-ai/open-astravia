import type {
	AutomationSessionLink,
	AutomationTaskEvent,
	AutomationTaskInput,
	AutomationTaskPatch,
	ScheduledTask,
	TaskExecutionRecord,
} from "../../shared/automation.js";

export type {
	AutomationModel,
	AutomationMonthDay,
	AutomationNotification,
	AutomationNotifyWhen,
	AutomationRecordStatus,
	AutomationRunTarget,
	AutomationRunTargetMode,
	AutomationSchedule,
	AutomationScheduleKind,
	AutomationSessionLink,
	AutomationSuspendReason,
	AutomationTaskInput,
	AutomationTaskPatch,
	ScheduledTask,
	TaskExecutionRecord,
} from "../../shared/automation.js";

export type TaskEvent = AutomationTaskEvent;

export interface DesktopSchedulerApi {
	getTasks(): Promise<ScheduledTask[]>;
	createTask(task: AutomationTaskInput): Promise<ScheduledTask>;
	updateTask(id: string, patch: AutomationTaskPatch): Promise<void>;
	deleteTask(id: string): Promise<void>;
	toggleTask(id: string): Promise<void>;
	/** Disable a task (set enabled=false and stop its scheduled job) */
	disableTask(id: string): Promise<void>;
	getRecords(taskId: string): Promise<TaskExecutionRecord[]>;
	/** 当前正在执行的任务 id 列表（main 进程内存态快照）。 */
	getRunningTaskIds(): Promise<string[]>;
	/** 会话与自动化的归属（侧栏据此折叠会话组、挂定时标记）。 */
	getSessionLinks(): Promise<AutomationSessionLink[]>;
	runTaskNow(id: string): Promise<void>;
	abortTask(id: string): Promise<void>;
	onTaskEvent(handler: (event: TaskEvent) => void): () => void;
}
