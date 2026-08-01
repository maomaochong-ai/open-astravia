import { useMemo } from "react";
import type { AbilitiesModel, PluginAbility } from "../types";
import { PluginPermissionsDialog } from "./detail/PluginPermissionsDialog";

/**
 * 插件装完立刻弹权限配置：首装时所有权限默认未授予，不必让用户再自己找入口。
 * 插件数据要等一次刷新才落地，因此在条目真正 installed 之前不渲染。
 */
export function PluginPermissionPrompt({ model }: { model: AbilitiesModel }): JSX.Element | null {
	const slug = model.permissionPromptSlug;
	const item = useMemo<PluginAbility | null>(() => {
		if (!slug) return null;
		const found = model.allItems.find(
			(entry): entry is PluginAbility => entry.type === "plugin" && entry.slug === slug && entry.plugin !== null,
		);
		return found ?? null;
	}, [model.allItems, slug]);

	// 系统插件权限自动授予，没有声明权限的也没什么可配。
	if (!item || item.permissions.length === 0 || item.plugin?.source === "system") return null;

	return (
		<PluginPermissionsDialog
			item={item}
			model={model}
			open
			onOpenChange={(open) => {
				if (!open) model.dismissPermissionPrompt();
			}}
		/>
	);
}
