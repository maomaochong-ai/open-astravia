import type { AppMonitorPromptRefUsageMap, SkillInfo } from "@preload/api";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
 *
 * 键带语言：内置 skill 的展示文案由主进程按当前语言给出，切语言后不能复用旧缓存。
 * 不带工作模式：skill 清单与顺序和模式无关（ADR-0071），主进程返回的清单不随模式增减。
 */
const cache = new Map<string, SkillListData>();
const inflight = new Map<string, Promise<SkillListData>>();

function cacheKey(cwd: string | undefined, language: string): string {
	return `${language}|${cwd ?? ""}`;
}

async function load(cwd: string | undefined, language: string): Promise<SkillListData> {
	const key = cacheKey(cwd, language);
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
	const { i18n } = useTranslation();
	const language = i18n.language;
	const cached = cache.get(cacheKey(cwd, language));
	const [skills, setSkills] = useState<SkillInfo[]>(cached?.skills ?? []);
	const [usage, setUsage] = useState<AppMonitorPromptRefUsageMap>(cached?.usage ?? {});
	const [loading, setLoading] = useState(false);

	// 预取：不进入 loading 态，也不覆盖已展开时的实时结果。
	// 刻意不等 requestIdleCallback：冷启动那几秒主线程被插件与主题占满，idle 会一路拖到
	// 超时才跑，预取赶不上第一次展开就等于没预取。IPC 本身是异步的，挂载即发起不阻塞渲染。
	useEffect(() => {
		if (!prefetch || open || cache.has(cacheKey(cwd, language))) return;
		void load(cwd, language).catch(() => undefined);
	}, [cwd, language, open, prefetch]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const apply = (data: SkillListData): void => {
			if (cancelled) return;
			setSkills(data.skills);
			setUsage(data.usage);
		};
		const refresh = (): void => {
			void load(cwd, language)
				.then(apply)
				.catch((error) => {
					console.error("[useSkillList] load failed:", error);
				})
				.finally(() => {
					if (!cancelled) setLoading(false);
				});
		};
		const seeded = cache.get(cacheKey(cwd, language));
		if (!seeded) {
			setLoading(true);
			refresh();
			return () => {
				cancelled = true;
			};
		}
		setSkills(seeded.skills);
		setUsage(seeded.usage);
		// 已有缓存时把「反映磁盘增删」的那次重拉推到空闲：展开那一刻重拉会让 setState
		// 落在高度动画中间，几十行重渲染足以把动画顿住。
		const cancelIdle = whenIdle(refresh);
		return () => {
			cancelled = true;
			cancelIdle();
		};
	}, [cwd, language, open]);

	const ranked = useMemo(() => sortSkillsForPanel(skills, usage), [skills, usage]);
	const items = useMemo(() => filterSkills(ranked, filter), [filter, ranked]);

	return { items, loading };
}
