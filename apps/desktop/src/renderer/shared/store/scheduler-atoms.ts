import { atom } from "jotai";
import type { AutomationSessionLink, ScheduledTask } from "../../../shared/automation";

export type {
	AutomationSessionLink,
	ScheduledTask,
	TaskExecutionRecord,
} from "../../../shared/automation";

export const scheduledTasksAtom = atom<ScheduledTask[]>([]);
/** 当前正在执行的任务 id 集合，由 task.started/record.updated 等事件维护。 */
export const runningTaskIdsAtom = atom<Set<string>>(new Set<string>());
export const selectedTaskIdAtom = atom<string | null>(null);
export const selectedRecordIdAtom = atom<string | null>(null);
export const formOpenAtom = atom<ScheduledTask | null | undefined>(undefined);

/**
 * 会话 → 自动化的归属（sessionPath 为键）。侧栏据此把「每次新建会话」产生的会话折叠成
 * 自动化会话组，并给绑定会话挂定时标记；数据源是主进程的执行记录与任务配置。
 */
export const automationSessionLinksAtom = atom<ReadonlyMap<string, AutomationSessionLink>>(
	new Map<string, AutomationSessionLink>(),
);

/** 来自自动化的会话路径集合（挂定时图标用）。 */
export const scheduledSessionPathsAtom = atom<ReadonlySet<string>>(
	(get) => new Set(get(automationSessionLinksAtom).keys()),
);

/** 自增计数器：删除执行记录后 +1，驱动正在展示的执行历史重新拉取。 */
export const scheduledRecordsVersionAtom = atom(0);
