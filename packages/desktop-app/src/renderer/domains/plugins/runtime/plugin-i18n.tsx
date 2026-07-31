import { languageAtom, type PluginI18nEntry, pluginI18nByIdAtom } from "@shared/store/atoms";
import { __PluginI18nContext, resolvePluginText } from "@vetta-org/plugin-sdk";
import { useAtomValue } from "jotai";
import { useCallback, type ReactNode } from "react";

/**
 * Resolve a host-rendered plugin string against an explicit i18n entry. A value
 * of the exact form `%key%` is a catalog key (current locale → defaultLocale →
 * bare key); any other string is a literal. Reactive — re-resolves on language
 * change. Use this when the caller already holds the InstalledPlugin (which
 * carries `.locales`/`.defaultLocale`), e.g. the settings/list page.
 */
export function usePluginI18n(): (entry: PluginI18nEntry | undefined, raw: string | undefined) => string {
	const locale = useAtomValue(languageAtom);
	return useCallback(
		(entry, raw) =>
			raw == null ? "" : resolvePluginText(raw, entry?.locales ?? {}, locale, entry?.defaultLocale ?? "zh"),
		[locale],
	);
}

/**
 * A registry-backed resolver `(pluginId, raw) => string`, reactive to language
 * change. Returns a plain function (not a hook), so it is safe to call inside a
 * `.map` when resolving many contribution labels (activity-tab / input-action).
 *
 * `entry` 覆盖注册表查表：注册表只收录**已启用且加载成功**的插件（见
 * PluginGlobalSlotHost），而刚安装尚未启用的插件同样要显示名字。调用方持有
 * InstalledPlugin 时把它传进来，直接用插件自带的 catalog 解析。
 */
export function usePluginTextResolver(): (
	pluginId: string,
	raw: string | undefined,
	entry?: PluginI18nEntry,
) => string {
	const locale = useAtomValue(languageAtom);
	const registry = useAtomValue(pluginI18nByIdAtom);
	return useCallback(
		(pluginId, raw, entry) => {
			if (raw == null) return "";
			const resolved = entry ?? registry[pluginId];
			return resolvePluginText(raw, resolved?.locales ?? {}, locale, resolved?.defaultLocale ?? "zh");
		},
		[locale, registry],
	);
}

/**
 * Wrap a plugin-rendered component subtree so `useTranslation()` resolves
 * against this plugin's catalogs and generated plugin CSS stays inside this
 * plugin's DOM subtree.
 */
export function PluginI18nBoundary({ pluginId, children }: { pluginId: string; children?: ReactNode }): JSX.Element {
	const registry = useAtomValue(pluginI18nByIdAtom);
	const entry = registry[pluginId];
	return (
		<__PluginI18nContext.Provider
			value={{ locales: entry?.locales ?? {}, defaultLocale: entry?.defaultLocale ?? "zh" }}
		>
			<div className="contents" data-vetta-plugin-root={pluginId}>
				{children}
			</div>
		</__PluginI18nContext.Provider>
	);
}

/** Inline variant for plugin-owned icons rendered inside host buttons and tree rows. */
export function PluginInlineI18nBoundary({
	pluginId,
	children,
}: {
	pluginId: string;
	children?: ReactNode;
}): JSX.Element {
	const registry = useAtomValue(pluginI18nByIdAtom);
	const entry = registry[pluginId];
	return (
		<__PluginI18nContext.Provider
			value={{ locales: entry?.locales ?? {}, defaultLocale: entry?.defaultLocale ?? "zh" }}
		>
			<span className="contents" data-vetta-plugin-root={pluginId}>
				{children}
			</span>
		</__PluginI18nContext.Provider>
	);
}
