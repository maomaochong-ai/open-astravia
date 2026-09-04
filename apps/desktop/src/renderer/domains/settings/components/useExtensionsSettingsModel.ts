import { pluginWorkspaceViewsAtom, type RegisteredWorkspaceView } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import {
	sortWorkspaceViews,
	workspaceViewNavKey,
	workspaceViewRef,
} from "../../plugins/runtime/workspace-view-registry";

/** 侧边栏没有专属图标时的回落，与 sidebar 导航项保持一致。 */
const FALLBACK_ICON = "icon-[solar--widget-2-linear]";

export interface ExtensionEntryModel {
	/** 与侧边栏导航项同一个 key，便于两处对同一入口的引用保持一致。 */
	key: string;
	label: string;
	/** 视图自己的说明；插件没写时为空串，卡片改用插件名占住描述区。 */
	description: string;
	/** 拥有者插件展示名，作为卡片底部的归属信息。 */
	pluginName: string;
	/** iconify class 或宿主生成的 mask class。 */
	icon: string;
	/** 原色图片图标；有值时以 `<img>` 渲染，`icon` 退为回落。 */
	iconUrl?: string;
	open: () => void;
}

export interface ExtensionsSettingsModel {
	entries: ExtensionEntryModel[];
	labels: {
		title: string;
		description: string;
		empty: string;
		emptyHint: string;
		sectionTitle: string;
		/** 分区标题右侧的入口数量。 */
		count: string;
	};
}

/** 注册表条目 → 入口卡片。纯映射，便于在不挂 jotai 与路由的情况下测试。 */
export function toExtensionEntry(
	view: Pick<
		RegisteredWorkspaceView,
		"pluginId" | "pluginName" | "viewId" | "label" | "icon" | "iconUrl" | "description"
	>,
	resolveText: (pluginId: string, value: string) => string,
	open: () => void,
): ExtensionEntryModel {
	return {
		key: workspaceViewNavKey(view.pluginId, view.viewId),
		label: resolveText(view.pluginId, view.label),
		description: view.description ? resolveText(view.pluginId, view.description) : "",
		// pluginName 同样可能是 `%plugin.name%` 占位符，必须过插件 catalog 才是人读的名字。
		pluginName: resolveText(view.pluginId, view.pluginName),
		icon: view.icon ?? FALLBACK_ICON,
		...(view.iconUrl ? { iconUrl: view.iconUrl } : {}),
		open,
	};
}

/**
 * 「扩展设置」只做一件事：把已注册的插件工作区视图列成入口。
 *
 * 插件配置本身归插件自己的页面所有（ADR-0105），这里不读也不写任何插件配置。
 */
export function useExtensionsSettingsModel(): ExtensionsSettingsModel {
	const { t } = useTranslation("settings");
	const navigate = useNavigate();
	const workspaceViews = useAtomValue(pluginWorkspaceViewsAtom);
	const resolvePluginText = usePluginTextResolver();
	/**
	 * 在设置壳内打开，而不是跳整页路由：两层侧栏留在原位，切换另一个插件页面
	 * 只需要一次点击，不必退回设置再展开一遍。
	 */
	const open = useCallback(
		(pluginId: string, viewId: string) => {
			void navigate({
				to: "/settings/$tab",
				params: { tab: "extensions" },
				search: { view: workspaceViewRef(pluginId, viewId) },
			});
		},
		[navigate],
	);

	const entries = useMemo(
		() =>
			// 只收不上栏的视图：上栏的在侧边栏里已经有稳定位置，两处重复只会让人犹豫点哪个。
			sortWorkspaceViews(workspaceViews.filter((view) => !view.sidebar)).map((view) =>
				toExtensionEntry(view, resolvePluginText, () => open(view.pluginId, view.viewId)),
			),
		[open, resolvePluginText, workspaceViews],
	);

	return {
		entries,
		labels: {
			title: t("extensions.title"),
			description: t("extensions.description"),
			empty: t("extensions.empty"),
			emptyHint: t("extensions.emptyHint"),
			sectionTitle: t("extensions.sectionTitle"),
			count: t("extensions.count", { count: entries.length }),
		},
	};
}
