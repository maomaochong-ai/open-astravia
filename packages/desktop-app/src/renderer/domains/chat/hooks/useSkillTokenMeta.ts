/**
 * 行内 skill token 的展示解析：slug → 「别名 + 图标」。
 *
 * 文本流里只留 `@skill:<name>`（软引用的权威形态，模型要按真实 name 查 skill），
 * 别名与图标属于展示层，必须在渲染时回查——否则消息气泡、重编辑回填的输入框只能
 * 显示 slug，与命令区刚插入时的胶囊对不上。数据源与命令区完全一致：
 * `skills.list()` 给别名，市场目录 / 内置静态资源给图标。
 */
import type { SkillInfo } from "@preload/api";
import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildSkillTokenMetaMap, type SkillTokenMeta } from "../lib/skill-token-meta";
import { useSkillIconMap } from "./useSkillIconMap";

/** 查不到（未安装 / 已卸载）时返回 undefined，由调用方落 slug + 默认图。 */
export type SkillTokenMetaResolver = (name: string) => SkillTokenMeta | undefined;

/** 键带语言：内置 skill 的别名由主进程按当前语言给出，切语言后旧结果不能复用。 */
const cache = new Map<string, SkillInfo[]>();
const inflight = new Map<string, Promise<SkillInfo[]>>();

function cacheKey(cwd: string | undefined, language: string): string {
	return `${language}|${cwd ?? ""}`;
}

async function load(cwd: string | undefined, language: string): Promise<SkillInfo[]> {
	const key = cacheKey(cwd, language);
	const running = inflight.get(key);
	if (running) return running;
	const task = window.vetta.skills
		.list(cwd)
		.then((skills) => {
			cache.set(key, skills);
			return skills;
		})
		.finally(() => {
			inflight.delete(key);
		});
	inflight.set(key, task);
	return task;
}

/**
 * 每条消息、每个 token 各持一份订阅，但 IPC 与市场目录都走模块级缓存，
 * 因此整屏只发一次请求。返回的 resolver 引用稳定，解析结果到位时才换新——
 * 调用方可以据此决定是否重建 markdown 组件树。
 */
export function useSkillTokenMeta(): SkillTokenMetaResolver {
	const { i18n } = useTranslation();
	const language = i18n.language;
	const cwd = useAtomValue(activeSessionAtom)?.cwd;
	const iconMap = useSkillIconMap(true);
	const [skills, setSkills] = useState<SkillInfo[]>(() => cache.get(cacheKey(cwd, language)) ?? []);

	useEffect(() => {
		const cached = cache.get(cacheKey(cwd, language));
		if (cached) {
			setSkills(cached);
			return;
		}
		let alive = true;
		void load(cwd, language)
			.then((next) => {
				if (alive) setSkills(next);
			})
			.catch((error) => {
				console.error("[useSkillTokenMeta] load failed:", error);
			});
		return () => {
			alive = false;
		};
	}, [cwd, language]);

	const metaByName = useMemo(() => buildSkillTokenMetaMap(skills, iconMap), [iconMap, skills]);

	return useCallback((name: string) => metaByName.get(name), [metaByName]);
}
