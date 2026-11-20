import type { InstalledPlugin } from "@preload/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * 行内插件 token 的展示解析：slug → 「标题 + 图标」。
 *
 * 与 skill 令牌同一套理由：文本流里只留 `@plugin:<slug>`（模型要按真实 id 认插件），
 * 标题与图标属于展示层，渲染时回查——否则气泡里只能看到 slug，与输入框里刚插入的
 * 那枚胶囊长得不一样。
 */
export interface PluginTokenMeta {
	readonly label: string;
	readonly icon?: string;
}

/** 键带语言：插件标题可能来自插件自带的本地化 catalog。 */
const cache = new Map<string, InstalledPlugin[]>();
const inflight = new Map<string, Promise<InstalledPlugin[]>>();

function cacheKey(language: string): string {
	return language;
}

async function load(language: string): Promise<InstalledPlugin[]> {
	const key = cacheKey(language);
	const running = inflight.get(key);
	if (running) return running;
	const task = window.astravia.plugins
		.listAll()
		.then((plugins) => {
			cache.set(key, plugins);
			return plugins;
		})
		.finally(() => {
			inflight.delete(key);
		});
	inflight.set(key, task);
	return task;
}

/** 每个 token 各持一份订阅，但 IPC 走模块级缓存：整屏只发一次请求。 */
export function usePluginTokenMeta(): (name: string) => PluginTokenMeta | undefined {
	// 语言键只用来让缓存跟着界面语言失效；没有 i18n 实例时（单元测试、独立渲染）
	// 退回固定键，不要因为读不到 `language` 而让整条消息渲染崩掉。
	const { i18n } = useTranslation();
	const language = i18n?.language ?? "default";
	const [plugins, setPlugins] = useState<InstalledPlugin[]>(() => cache.get(cacheKey(language)) ?? []);

	useEffect(() => {
		const cached = cache.get(cacheKey(language));
		if (cached) {
			setPlugins(cached);
			return;
		}
		let alive = true;
		void load(language)
			.then((next) => {
				if (alive) setPlugins(next);
			})
			.catch((error) => {
				console.error("[usePluginTokenMeta] load failed:", error);
			});
		return () => {
			alive = false;
		};
	}, [language]);

	const metaById = useMemo(() => {
		const map = new Map<string, PluginTokenMeta>();
		for (const plugin of plugins) {
			map.set(plugin.id, {
				label: plugin.name || plugin.id,
				...(plugin.iconUrl ? { icon: plugin.iconUrl } : {}),
			});
		}
		return map;
	}, [plugins]);

	return useCallback((name: string) => metaById.get(name), [metaById]);
}
