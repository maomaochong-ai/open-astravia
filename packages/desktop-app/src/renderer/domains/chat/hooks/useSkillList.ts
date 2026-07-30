import type { AppMonitorPromptRefUsageMap, SkillInfo } from "@preload/api";
import { useEffect, useMemo, useState } from "react";
import { filterSkills, sortSkillsForPanel } from "../lib/skill-ranking";

export interface SkillListModel {
	/** 已按「调用次数 → 类别 → 最近使用 → 名称」排好并过滤完的单列列表。 */
	items: SkillInfo[];
	loading: boolean;
}

/**
 * 命令面板与批量任务 dialog 共用的 skill 数据源。
 *
 * 只在面板打开时拉取：skills.list 会扫盘（用户目录、项目目录、插件贡献路径），
 * 常驻订阅没有意义。使用统计与 skill 列表一起拉，避免打开面板时排序跳变。
 */
export function useSkillList({ open, cwd, filter }: { open: boolean; cwd?: string; filter: string }): SkillListModel {
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const [usage, setUsage] = useState<AppMonitorPromptRefUsageMap>({});
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoading(true);
		void Promise.all([
			window.vetta.skills.list(cwd),
			window.vetta.appMonitor.getPromptRefUsage().catch(() => ({}) as AppMonitorPromptRefUsageMap),
		])
			.then(([listed, usageMap]) => {
				if (cancelled) return;
				setSkills(listed);
				setUsage(usageMap);
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
