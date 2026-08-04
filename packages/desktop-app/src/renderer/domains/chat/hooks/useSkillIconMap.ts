/**
 * skill / scene 的市场图标目录加载。命令区解析顺序见 `skillIconOf`：
 * 市场目录 → SkillInfo.icon（插件宿主图）→ 内置静态资源 → 默认图。
 * 这里只负责市场半边；插件 / 内置不进这份 map。
 *
 * 解析口径本身是纯逻辑，住在 lib/skill-token-meta。
 */
import { fetchMarketAbilities } from "@shared/lib/api";
import { authTokenAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import type { SkillIconMap } from "../lib/skill-token-meta";

export { type SkillIconMap, skillIconOf } from "../lib/skill-token-meta";

const EMPTY_ICON_MAP: SkillIconMap = new Map();

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
