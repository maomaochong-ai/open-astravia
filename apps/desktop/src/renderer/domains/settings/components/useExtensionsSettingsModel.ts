import { pluginWorkspaceViewsAtom, type RegisteredWorkspaceView } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { desktopHostedRouteService } from "../../../shared/hosted-routes/hosted-route-service";
import { pluginWorkspaceRoute } from "../../plugins/runtime/plugin-hosted-route-capability";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { sortWorkspaceViews, workspaceViewNavKey } from "../../plugins/runtime/workspace-view-registry";

/** 侧边栏没有专属图标时的回落，与 sidebar 导航项保持一致。 */
const FALLBACK_ICON = "icon-[solar--widget-2-linear]";

export interface ExtensionEntryModel {
	/** 与侧边栏导航项同一个 key，便于两处对同一入口的引用保持一致。 */
	key: string;
	label: string;
	/** 插件名或视图描述，作为卡片副标题。 */
	subtitle: string;
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
	const description = view.description ? resolveText(view.pluginId, view.description) : "";
	return {
		key: workspaceViewNavKey(view.pluginId, view.viewId),
		label: resolveText(view.pluginId, view.label),
		// 视图自己的描述更具体；没有就退回插件名，卡片副标题不留空。
		subtitle: description || view.pluginName,
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
	const workspaceViews = useAtomValue(pluginWorkspaceViewsAtom);
	const resolvePluginText = usePluginTextResolver();

	const entries = useMemo(
		() =>
			sortWorkspaceViews(workspaceViews).map((view) =>
				toExtensionEntry(
					view,
					resolvePluginText,
					() => void desktopHostedRouteService.open(pluginWorkspaceRoute(view.pluginId, view.viewId)),
				),
			),
		[resolvePluginText, workspaceViews],
	);

	return {
		entries,
		labels: {
			title: t("extensions.title"),
			description: t("extensions.description"),
			empty: t("extensions.empty"),
			emptyHint: t("extensions.emptyHint"),
		},
	};
}
