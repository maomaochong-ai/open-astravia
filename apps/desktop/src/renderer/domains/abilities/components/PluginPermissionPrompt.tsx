import { useMemo } from "react";
import type { AbilitiesModel, PluginAbility } from "../types";
import { PluginInstallSetupDialog } from "./PluginInstallSetupDialog";

/**
 * 插件装完立刻弹启用 + 权限配置：安装既不启用插件、也不授予权限，不必让用户再自己找入口。
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

	// 系统插件随包启用、权限自动授予，没什么可配。
	if (!item || item.plugin?.source === "system") return null;

	return <PluginInstallSetupDialog item={item} model={model} onClose={model.dismissPermissionPrompt} />;
}
