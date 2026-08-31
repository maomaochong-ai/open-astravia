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

const SIDEBAR_SESSION_PINS_STORAGE_KEY = "vetta-sidebar-session-pins";
const SIDEBAR_SESSION_PINS_SCHEMA_VERSION = 1;

interface StoredSidebarSessionPins {
	schemaVersion: typeof SIDEBAR_SESSION_PINS_SCHEMA_VERSION;
	pins: Array<{ path: string; pinnedAt: number }>;
}

export type PinnedSessionPaths = ReadonlyMap<string, number>;

export function parseSidebarSessionPins(value: unknown): Map<string, number> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return new Map();
	const input = value as { schemaVersion?: unknown; pins?: unknown };
	if (input.schemaVersion !== SIDEBAR_SESSION_PINS_SCHEMA_VERSION || !Array.isArray(input.pins)) {
		return new Map();
	}
	const pins = new Map<string, number>();
	for (const entry of input.pins) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
		const path = Reflect.get(entry, "path");
		const pinnedAt = Reflect.get(entry, "pinnedAt");
		if (typeof path !== "string" || path.trim().length === 0) continue;
		if (typeof pinnedAt !== "number" || !Number.isFinite(pinnedAt) || pinnedAt <= 0) continue;
		pins.set(path, pinnedAt);
	}
	return pins;
}

function loadSidebarSessionPins(): Map<string, number> {
	try {
		const raw = localStorage.getItem(SIDEBAR_SESSION_PINS_STORAGE_KEY);
		return raw ? parseSidebarSessionPins(JSON.parse(raw) as unknown) : new Map();
	} catch {
		return new Map();
	}
}

function persistSidebarSessionPins(pins: PinnedSessionPaths): void {
	const stored: StoredSidebarSessionPins = {
		schemaVersion: SIDEBAR_SESSION_PINS_SCHEMA_VERSION,
		pins: Array.from(pins, ([path, pinnedAt]) => ({ path, pinnedAt })),
	};
	try {
		localStorage.setItem(SIDEBAR_SESSION_PINS_STORAGE_KEY, JSON.stringify(stored));
	} catch {
		// 隐私模式或配额不足时保留当前内存态；置顶只是本机 UI 偏好。
	}
}

export function updatePinnedSessionPaths(
	current: PinnedSessionPaths,
	input: { path: string; pinned: boolean; pinnedAt?: number },
): Map<string, number> {
	const next = new Map(current);
	if (input.pinned) {
		let latestPin = 0;
		for (const pinnedAt of current.values()) latestPin = Math.max(latestPin, pinnedAt);
		next.set(input.path, input.pinnedAt ?? Math.max(Date.now(), latestPin + 1));
	} else next.delete(input.path);
	return next;
}

export const pinnedSessionPathsAtom = atom<Map<string, number>>(loadSidebarSessionPins());
export const setSessionPinnedAtom = atom(
	null,
	(get, set, input: { path: string; pinned: boolean; pinnedAt?: number }) => {
		const next = updatePinnedSessionPaths(get(pinnedSessionPathsAtom), input);
		persistSidebarSessionPins(next);
		set(pinnedSessionPathsAtom, next);
	},
);
export const removePinnedSessionsAtom = atom(null, (get, set, paths: Iterable<string>) => {
	const next = new Map(get(pinnedSessionPathsAtom));
	let changed = false;
	for (const path of paths) changed = next.delete(path) || changed;
	if (!changed) return;
	persistSidebarSessionPins(next);
	set(pinnedSessionPathsAtom, next);
});

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

export type DefaultConversationFilter = "conversation" | "claw";
export const defaultConversationFilterAtom = atom<DefaultConversationFilter>("conversation");
// Always start expanded on app launch — collapse state is per-session only.
export const sidebarCollapsedAtom = atom<boolean>(false);

const DEFAULT_WORKSPACE = "~/.vetta/workspace";
export const workspacePathAtom = atom<string>(localStorage.getItem("vetta-workspace-path") || DEFAULT_WORKSPACE);

export const sessionContextMenuAtom = atom<{
	x: number;
	y: number;
	session: SessionInfo;
	/** Claw 等只读来源仍允许置顶和打开目录，但不暴露重命名/删除。 */
	allowMutations: boolean;
} | null>(null);
export const renamingSessionPathAtom = atom<string | null>(null);
export const projectContextMenuAtom = atom<{ x: number; y: number; project: Project } | null>(null);
