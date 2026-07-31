/**
 * skill / scene 的图标解析，口径与能力广场一致：图标只存在于市场目录（`MarketAbility.icon`），
 * 本地条目按 slug + type 认领。`skills.list()` 返回的 SkillInfo 不带 icon，所以命令区要拿到
 * 真实图标只能回市场目录查；查不到再看是不是随 App 分发的内置 Skill（图标走 renderer
 * 静态资源）。未登录 / 离线 / 两处都没有时返回 undefined，由 SkillTypeIcon 落默认图。
 */
import type { SkillInfo } from "@preload/api";
import { fetchMarketAbilities } from "@shared/lib/api";
import { builtinSkillIconUrl } from "@shared/lib/builtin-skill-icons";
import { authTokenAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

/** 键为 `${type}:${slug}`：本地清单里 skill 与 scene 同命名空间，同名不同类型不能互相认领。 */
export type SkillIconMap = ReadonlyMap<string, string>;

const EMPTY_ICON_MAP: SkillIconMap = new Map();

export function skillIconOf(map: SkillIconMap, skill: SkillInfo): string | undefined {
	// 随 App 分发的内置 Skill 不在市场目录里，图标来自 renderer 静态资源（口径同能力广场）。
	return (
		map.get(`${skill.type}:${skill.name}`) ??
		(skill.source === "builtin" ? builtinSkillIconUrl(skill.name) : undefined)
	);
}

/** 按 token 缓存整份目录解析结果：命令区反复开合不该反复打网络。 */
const iconMapCache = new Map<string, Promise<SkillIconMap>>();

/** 两个目录都用 allSettled 收口，任一失败只是少几个图标，绝不让命令区打不开。 */
async function loadSkillIconMap(token: string | null): Promise<SkillIconMap> {
	const map = new Map<string, string>();
	const [server, open] = await Promise.allSettled([
		token ? fetchMarketAbilities(token) : Promise.resolve([]),
		window.vetta.abilities.listOpenMarketplaces(),
	]);
	const entries: Array<{ type: string; slug: string; icon: string }> = [];
	if (server.status === "fulfilled") entries.push(...server.value);
	if (open.status === "fulfilled") entries.push(...open.value.abilities);
	for (const entry of entries) {
		if (entry.type !== "skill" && entry.type !== "scene") continue;
		if (!entry.icon) continue;
		const key = `${entry.type}:${entry.slug}`;
		// 先到先得：服务端目录排在开放市场之前，与广场的来源优先级一致。
		if (!map.has(key)) map.set(key, entry.icon);
	}
	return map;
}

/**
 * enabled 为 false 时不发起加载：命令区没展开过就不该为图标去拉目录。
 *
 * `prefetch` 为真时提前拉：目录解析要打网络，等展开那一刻才发起的话，结果会在高度动画
 * 进行中才到位，整列图标同时换图（远程 `<img>` 首次还要走网络与解码），动画就顿在那里。
 */
export function useSkillIconMap(enabled: boolean, prefetch = false): SkillIconMap {
	const token = useAtomValue(authTokenAtom);
	const [map, setMap] = useState<SkillIconMap>(EMPTY_ICON_MAP);

	useEffect(() => {
		if (!enabled && !prefetch) return;
		let alive = true;
		const cacheKey = token ?? "";
		let pending = iconMapCache.get(cacheKey);
		if (!pending) {
			pending = loadSkillIconMap(token);
			iconMapCache.set(cacheKey, pending);
		}
		void pending.then((next) => {
			if (alive) setMap(next);
		});
		return () => {
			alive = false;
		};
	}, [enabled, prefetch, token]);

	return map;
}
