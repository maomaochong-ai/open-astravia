import { isSubPath, pathBasename } from "@shared/lib/utils";
import type { RuntimeSessionAccess } from "@vetta/runtime-core";
import { atom } from "jotai";
import { SCHEDULE_SESSION_MARKER } from "../../../shared/scheduled-session";

export type ProjectType = "normal" | "batch";

export interface Project {
	cwd: string;
	name?: string;
	sessionCount: number;
	type: ProjectType;
	/** 是否为默认「对话」项目（运行时虚拟注入，不写入 config.projects）。 */
	isDefault?: boolean;
}

/** 默认「对话」项目的显示名称。 */
export const DEFAULT_CONVERSATION_PROJECT_NAME = "对话";
/**
 * 默认「对话」项目的 cwd（绝对路径）。
 * 启动时由主进程 ConfigGet 返回真实路径并写入此 atom；在收到之前保持空串作为「未就绪」标记。
 */
export const defaultConversationCwdAtom = atom<string>("");

/**
 * im-gateway 的 cwd（绝对路径），与桌面「对话」cwd 物理分离（ADR-0005）。
 * 用于判定一条 session 是否是 Claw（IM）来源：session.cwd === defaultImConversationCwdAtom。
 */
export const defaultImConversationCwdAtom = atom<string>("");

/**
 * 知识库加工特殊项目 cwd（~/.vetta/knowledges/processing_records）。
 * 用于判定一条 session 是否是知识库加工 session：session.path 落在该 cwd 的 sessions 目录下。
 */
export const knowledgeProcessingCwdAtom = atom<string>("");

/**
 * 根据 cwd 获取项目展示名：默认「对话」项目返回中文名，其它项目使用 cwd basename。
 * 传入 defaultCwd 来识别默认项目（避免对 atom 的隐式依赖，便于在非 React 环境调用）。
 */
export function getProjectDisplayName(cwd: string, defaultCwd: string): string {
	if (defaultCwd && cwd === defaultCwd) return DEFAULT_CONVERSATION_PROJECT_NAME;
	return pathBasename(cwd);
}

/**
 * ADR-0007：默认「对话」session 的运行 cwd 是项目根（`defaultCwd`）下的 per-session 子目录，
 * 但侧边栏 sessionsMap / 默认会话列表都以项目根为 bucket key。任何要落到侧边栏 bucket 的
 * 操作（ensureLocalSession / applyLocalRename / loadSessions / 顶部新会话目标 cwd）都必须先把
 * 子目录 cwd 归一回项目根，否则会出现「乐观行进错桶、改名落空、列表要刷新才更新」等问题。
 * 非默认项目的 cwd 原样返回（它们没有 per-session 子目录）。
 */
export function conversationBucketCwd(cwd: string, defaultCwd: string): string {
	if (defaultCwd && cwd !== defaultCwd && isSubPath(cwd, defaultCwd)) return defaultCwd;
	return cwd;
}

export interface SessionInfo {
	id: string;
	path: string;
	cwd: string;
	name?: string;
	firstMessage: string;
	modifiedAt: number;
	/** 宿主显式声明的访问能力；乐观创建的本地条目可能暂未解析。 */
	access?: RuntimeSessionAccess;
	/** Parent session jsonl path when this session was forked. */
	parentSessionPath?: string;
	/** User entry id in the parent session this fork was created from. */
	parentEntryId?: string;
}

/** coding-agent 对「无消息」session 给出的占位 firstMessage，UI 层不直接展示。 */
export const NO_MESSAGES_SENTINEL = "(no messages)";
/** 既无用户命名、也无首条消息时的展示名。 */
export const UNNAMED_SESSION_LABEL = "未命名会话";

/**
 * 会话在侧边栏 / 标题栏的展示名：优先用户命名，其次首条消息文本；
 * 两者皆空（或仅为 coding-agent 占位串）时回退到「未命名会话」。
 */
export function sessionDisplayLabel(session: Pick<SessionInfo, "name" | "firstMessage">): string {
	// 兼容旧定时 session：剥离历史遗留的不可见标记前缀（见 scheduled-session）。
	const raw = (session.name || session.firstMessage || "").split(SCHEDULE_SESSION_MARKER).join("").trim();
	if (!raw || raw === NO_MESSAGES_SENTINEL) return UNNAMED_SESSION_LABEL;
	return raw;
}

export type SidebarFilter = "all" | "normal" | "batch";

export const projectsAtom = atom<Project[]>([]);
export const projectsInitializedAtom = atom<boolean>(false);
export const expandedProjectsAtom = atom<Set<string>>(new Set<string>());
export const sessionsMapAtom = atom<Map<string, SessionInfo[]>>(new Map<string, SessionInfo[]>());
export const sessionLoadingCwdsAtom = atom<Set<string>>(new Set<string>());

export const SIDEBAR_WIDTH_STORAGE_KEY = "vetta-sidebar-width";
export const SIDEBAR_WIDTH_DEFAULT = 220;
/** 与 useSidebarModel.MIN_WIDTH 保持一致 */
export const SIDEBAR_WIDTH_MIN = 180;
const readSidebarWidth = (): number => {
	const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
	if (raw == null) return SIDEBAR_WIDTH_DEFAULT;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return SIDEBAR_WIDTH_DEFAULT;
	return Math.max(SIDEBAR_WIDTH_MIN, n);
};
export const sidebarWidthAtom = atom<number>(readSidebarWidth());
export const sidebarFilterAtom = atom<SidebarFilter>("all");

/** 侧栏项目区的最大高度占比。内容不足时按自然高度收缩；默认最多占 80%。 */
export const SIDEBAR_PROJECTS_SPLIT_RATIO_KEY = "vetta-sidebar-projects-split-ratio";
export const SIDEBAR_PROJECTS_SPLIT_DEFAULT = 0.8;
export const SIDEBAR_PROJECTS_SPLIT_MIN = 0.2;
export const SIDEBAR_PROJECTS_SPLIT_MAX = 0.8;

export function clampSidebarProjectsSplitRatio(ratio: number): number {
	if (!Number.isFinite(ratio)) return SIDEBAR_PROJECTS_SPLIT_DEFAULT;
	return Math.min(SIDEBAR_PROJECTS_SPLIT_MAX, Math.max(SIDEBAR_PROJECTS_SPLIT_MIN, ratio));
}

const readSidebarProjectsSplitRatio = (): number => {
	const raw = localStorage.getItem(SIDEBAR_PROJECTS_SPLIT_RATIO_KEY);
	if (raw == null) return SIDEBAR_PROJECTS_SPLIT_DEFAULT;
	return clampSidebarProjectsSplitRatio(Number(raw));
};

const sidebarProjectsSplitRatioBaseAtom = atom<number>(readSidebarProjectsSplitRatio());

/** 项目区最大高度占比。每次写入同步持久化，避免拖拽结束事件丢失导致刷新后复位。 */
export const sidebarProjectsSplitRatioAtom = atom(
	(get) => get(sidebarProjectsSplitRatioBaseAtom),
	(get, set, update: number | ((prev: number) => number)) => {
		const prev = get(sidebarProjectsSplitRatioBaseAtom);
		const next = clampSidebarProjectsSplitRatio(typeof update === "function" ? update(prev) : update);
		if (next === prev) return;
		set(sidebarProjectsSplitRatioBaseAtom, next);
		try {
			localStorage.setItem(SIDEBAR_PROJECTS_SPLIT_RATIO_KEY, String(next));
		} catch {
			// ignore storage failures; the in-memory preference still applies for this renderer session
		}
	},
);

export type DefaultConversationFilter = "conversation" | "claw";
export const defaultConversationFilterAtom = atom<DefaultConversationFilter>("conversation");
// Always start expanded on app launch — collapse state is per-session only.
export const sidebarCollapsedAtom = atom<boolean>(false);

const DEFAULT_WORKSPACE = "~/.vetta/workspace";
export const workspacePathAtom = atom<string>(localStorage.getItem("vetta-workspace-path") || DEFAULT_WORKSPACE);

export const sessionContextMenuAtom = atom<{ x: number; y: number; session: SessionInfo } | null>(null);
export const renamingSessionPathAtom = atom<string | null>(null);
export const projectContextMenuAtom = atom<{ x: number; y: number; project: Project } | null>(null);
