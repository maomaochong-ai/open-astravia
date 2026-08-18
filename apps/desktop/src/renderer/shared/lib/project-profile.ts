import type { ProjectType } from "@shared/store/project-atoms";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 项目活动面板 tab 配置。
 * `plugin:<pluginId>:<tabId>` 为用户 attach 的插件 tab（见 ActivityPanel）。
 */
export type ActivityTabKey =
	| "file"
	| "batch-progress"
	| "schedule-records"
	| "todo"
	| "background-tasks"
	| "workflow"
	| "debug"
	| "knowledge-history"
	| "browser"
	| `plugin:${string}`;

/** 内置 tab 的 i18n key（chat 命名空间）——模块级常量只存 key，渲染期解析。 */
export type ActivityTabLabelKey = "activityPanel.tabs.file" | "activityPanel.tabs.batchProgress";

export interface ActivityTabConfig {
	key: ActivityTabKey;
	/** i18n key（chat 命名空间），渲染期解析——不存已翻译文案 */
	label: ActivityTabLabelKey;
	icon?: string;
}

/**
 * 项目属性 / 元数据
 *
 * 这是一个统一的项目"画像"，未来所有需要按项目类型区分的配置和属性
 * 都应该通过此对象暴露 —— 调用方不应再关心 meta.json 的原始结构。
 */
export interface ProjectProfile {
	/** 项目工作目录 */
	cwd: string;
	/** 项目类型 */
	type: ProjectType;
	/** 原始 meta.json 内容（仅用于兜底，业务尽量不直接读） */
	rawMeta: Record<string, unknown> | null;
	/** 该项目的活动面板 tab 列表 */
	activityTabs: ActivityTabConfig[];
	/** 该项目活动面板默认激活的 tab */
	defaultActivityTab: ActivityTabKey;
}

// label 存 i18n key（chat 命名空间），渲染期由 ActivityPanel 用 t() 解析——模块级常量不放中文。
const TAB_FILE: ActivityTabConfig = {
	key: "file",
	label: "activityPanel.tabs.file",
	icon: "icon-[mdi--file-document-outline]",
};
const TAB_BATCH_PROGRESS: ActivityTabConfig = {
	key: "batch-progress",
	label: "activityPanel.tabs.batchProgress",
	icon: "icon-[mdi--progress-clock]",
};
/**
 * 根据 meta 推断项目类型。
 * 规则：
 * - meta.type === "batch" → 批量项目
 * - 其他 → "normal"
 */
function deriveType(meta: Record<string, unknown> | null): { type: ProjectType } {
	const rawType = typeof meta?.type === "string" ? (meta.type as string) : null;
	return { type: rawType === "batch" ? "batch" : "normal" };
}

/**
 * 项目 profile 上的 activityTabs / defaultActivityTab。
 * 默认激活 tab 仍用 defaultActivityTab；栏上候选由 activity-panel builtins 注册表
 * （+ 插件 pool）贡献，不再依赖本列表组装。tabs 字段保留兼容读方。
 */
function buildActivityTabs(type: ProjectType): {
	tabs: ActivityTabConfig[];
	defaultTab: ActivityTabKey;
} {
	if (type === "batch") {
		return {
			tabs: [TAB_FILE, TAB_BATCH_PROGRESS],
			defaultTab: "file",
		};
	}

	return {
		tabs: [TAB_FILE],
		defaultTab: "file",
	};
}

function buildProfile(cwd: string, meta: Record<string, unknown> | null): ProjectProfile {
	const { type } = deriveType(meta);
	const { tabs, defaultTab } = buildActivityTabs(type);
	return {
		cwd,
		type,
		rawMeta: meta,
		activityTabs: tabs,
		defaultActivityTab: defaultTab,
	};
}

/**
 * 异步获取项目 profile。
 *
 * 直接读取 .vetta/meta.json，不做任何缓存。
 * 适合在事件回调 / 命令式代码中使用。组件渲染请使用 {@link useProjectProfile}。
 */
export async function getProjectProfile(cwd: string): Promise<ProjectProfile> {
	let meta: Record<string, unknown> | null = null;
	try {
		meta = await window.vetta.project.readMeta(cwd);
	} catch {
		meta = null;
	}
	return buildProfile(cwd, meta);
}

/**
 * 同步根据已知的 meta 构造 profile（不做 IO）。
 * 用于已经持有 meta 的场景，避免重复 IPC。
 */
export function buildProjectProfileFromMeta(cwd: string, meta: Record<string, unknown> | null): ProjectProfile {
	return buildProfile(cwd, meta);
}

interface UseProjectProfileResult {
	profile: ProjectProfile | null;
	loading: boolean;
	error: Error | null;
	/** 重新读取 meta.json 并刷新 profile */
	refresh: () => Promise<void>;
}

/**
 * React Hook：根据 cwd 获取项目 profile。
 *
 * - 内置 hook 内存缓存（同一 cwd 的多次渲染不会重复 IPC）
 * - 切换 cwd 时自动重新读取
 * - 调用 refresh() 可强制重新读取（例如 meta.json 被修改后）
 * - cwd 为 null 时不发起请求，profile 返回 null
 */
export function useProjectProfile(cwd: string | null): UseProjectProfileResult {
	const [profile, setProfile] = useState<ProjectProfile | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	// 缓存：cwd → profile，避免同一 cwd 反复读 meta
	const cacheRef = useRef<Map<string, ProjectProfile>>(new Map());
	// 标识当前正在处理的 cwd，避免并发请求乱序覆盖
	const activeCwdRef = useRef<string | null>(null);

	const load = useCallback(async (targetCwd: string, force: boolean) => {
		if (!force) {
			const cached = cacheRef.current.get(targetCwd);
			if (cached) {
				activeCwdRef.current = targetCwd;
				setProfile(cached);
				setLoading(false);
				setError(null);
				return;
			}
		}
		activeCwdRef.current = targetCwd;
		setLoading(true);
		setError(null);
		try {
			const next = await getProjectProfile(targetCwd);
			cacheRef.current.set(targetCwd, next);
			// 仅当当前请求仍是最新的才写回 state
			if (activeCwdRef.current === targetCwd) {
				setProfile(next);
				setLoading(false);
			}
		} catch (err) {
			if (activeCwdRef.current === targetCwd) {
				setError(err instanceof Error ? err : new Error(String(err)));
				setLoading(false);
			}
		}
	}, []);

	useEffect(() => {
		if (!cwd) {
			activeCwdRef.current = null;
			setProfile(null);
			setLoading(false);
			setError(null);
			return;
		}
		void load(cwd, false);
	}, [cwd, load]);

	const refresh = useCallback(async () => {
		if (!cwd) return;
		cacheRef.current.delete(cwd);
		await load(cwd, true);
	}, [cwd, load]);

	return { profile, loading, error, refresh };
}
