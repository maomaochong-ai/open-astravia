import type { AppMonitorPromptRefUsageMap, SkillInfo } from "@preload/api";
import { useEffect, useMemo, useState } from "react";
import { filterSkills, sortSkillsForPanel } from "../lib/skill-ranking";

export interface SkillListModel {
	/** 已按「调用次数 → 类别 → 最近使用 → 名称」排好并过滤完的单列列表。 */
	items: SkillInfo[];
	loading: boolean;
}

interface SkillListData {
	skills: SkillInfo[];
	usage: AppMonitorPromptRefUsageMap;
}

/**
 * 按 cwd 缓存的列表数据（模块级，跨挂载复用）。
 *
 * 命令区第一次展开时若还在等 `skills.list`（要扫用户目录、项目目录、插件贡献路径）
 * 与用量统计，数据会在高度动画进行中才到位：`height: auto` 的目标被不断重测，
 * 同时主线程正在渲染几十行列表 —— 表现就是「第一次展开卡一下，第二次就顺了」。
 * 因此预取一次并缓存，展开时先用缓存立即出内容。
 */
const cache = new Map<string, SkillListData>();
const inflight = new Map<string, Promise<SkillListData>>();

async function load(cwd: string | undefined): Promise<SkillListData> {
	const key = cwd ?? "";
	const running = inflight.get(key);
	if (running) return running;
	const task = Promise.all([
		window.vetta.skills.list(cwd),
		window.vetta.appMonitor.getPromptRefUsage().catch(() => ({}) as AppMonitorPromptRefUsageMap),
	])
		.then(([skills, usage]) => {
			const data: SkillListData = { skills, usage };
			cache.set(key, data);
			return data;
		})
		.finally(() => {
			inflight.delete(key);
		});
	inflight.set(key, task);
	return task;
}

function whenIdle(run: () => void): () => void {
	const idle = window.requestIdleCallback;
	if (typeof idle === "function") {
		const handle = idle(run, { timeout: 2000 });
		return () => window.cancelIdleCallback?.(handle);
	}
	const timer = window.setTimeout(run, 300);
	return () => window.clearTimeout(timer);
}

/**
 * 命令区与批量任务 dialog 共用的 skill 数据源。
 *
 * `prefetch` 为真时在空闲时段先备好数据（面板还没展开），展开那一刻直接出内容。
 * 展开时仍会再拉一次，保证磁盘上新增/删除的 skill 能反映出来。
 */
export function useSkillList({
	open,
	cwd,
	filter,
	prefetch = false,
}: {
	open: boolean;
	cwd?: string;
	filter: string;
	prefetch?: boolean;
}): SkillListModel {
	const cached = cache.get(cwd ?? "");
	const [skills, setSkills] = useState<SkillInfo[]>(cached?.skills ?? []);
	const [usage, setUsage] = useState<AppMonitorPromptRefUsageMap>(cached?.usage ?? {});
	const [loading, setLoading] = useState(false);

	// 预取：不进入 loading 态，也不覆盖已展开时的实时结果。
	useEffect(() => {
		if (!prefetch || open || cache.has(cwd ?? "")) return;
		return whenIdle(() => {
			void load(cwd).catch(() => undefined);
		});
	}, [cwd, open, prefetch]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const seeded = cache.get(cwd ?? "");
		if (seeded) {
			setSkills(seeded.skills);
			setUsage(seeded.usage);
		} else {
			setLoading(true);
		}
		void load(cwd)
			.then((data) => {
				if (cancelled) return;
				setSkills(data.skills);
				setUsage(data.usage);
			})
			.catch((error) => {
				console.error("[useSkillList] load failed:", error);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [cwd, open]);

	const ranked = useMemo(() => sortSkillsForPanel(skills, usage), [skills, usage]);
	const items = useMemo(() => filterSkills(ranked, filter), [filter, ranked]);

	return { items, loading };
}
