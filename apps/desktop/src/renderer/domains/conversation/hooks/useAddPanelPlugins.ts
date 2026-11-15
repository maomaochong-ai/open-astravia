import { resolvePluginText } from "@astravia-org/plugin-sdk";
import type { InstalledPlugin } from "@preload/api";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AddPanelPluginEntry } from "../components/command-panel/add-panel-catalog";

/**
 * 面板「插件」分类的数据源：已安装且未被禁用的插件。
 *
 * ADR-0177 §4 定下的归属规则在这里落地：出现在面板的条件是「已安装 + 未禁用」，
 * 显隐跟随安装状态；未安装的插件属于能力广场，不进面板。
 *
 * 列表只在面板打开时读一次（`open` 变化时重读）：插件启停会改变清单，但用户不会在
 * 面板里装插件，因此不需要订阅式刷新。读取失败按空清单处理——面板是「顺手插一个东西」
 * 的地方，不该因为一次读盘失败而弹错。
 */
export function projectPluginEntries(
	plugins: readonly InstalledPlugin[],
	locale: string = "en",
): AddPanelPluginEntry[] {
	return plugins
		.filter((plugin) => plugin.enabled !== false)
		.map((plugin) => ({
			id: plugin.id,
			// manifest 的 name/description 可能是 `%key%` 形式的目录键，必须按插件自己的
			// catalog 解析；直接显示原文会出现 `%name%` 这种裸占位符（实测如此）。
			label: resolvePluginText(plugin.name, plugin.locales, locale, plugin.defaultLocale) || plugin.id,
			description: plugin.description
				? resolvePluginText(plugin.description, plugin.locales, locale, plugin.defaultLocale)
				: undefined,
			// `iconUrl` 已由 main 解析成可直接渲染的值（iconify 名或 astravia-plugin:// URL），
			// 目录投影时按 `splitIcon` 区分 class 与图片。
			icon: plugin.iconUrl,
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

export function useAddPanelPlugins(open: boolean): readonly AddPanelPluginEntry[] {
	const { i18n } = useTranslation();
	const locale = i18n.language || "en";
	const [plugins, setPlugins] = useState<readonly InstalledPlugin[]>([]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		// 用 `?.` 一直链到底：某些宿主（测试替身、精简 preload）没有暴露 plugins 命名空间，
		// 缺一个子对象就让整个面板崩掉不值得。
		void window.astravia.plugins
			?.listAll?.()
			.then((installed) => {
				if (!cancelled) setPlugins(installed ?? []);
			})
			.catch((error: unknown) => {
				console.warn("[useAddPanelPlugins] list plugins failed:", error);
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	return useMemo(() => projectPluginEntries(plugins, locale), [plugins, locale]);
}
