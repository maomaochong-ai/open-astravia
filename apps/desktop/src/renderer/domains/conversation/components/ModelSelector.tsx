import { useThemeComponent } from "@astravia-org/theme-sdk";
import { useShortcutScope } from "@shared/shortcuts";
import { type ModelSelectorScope, useModelSelectorModel } from "../hooks/useModelSelectorModel";
import { ModelSelectorView } from "@astravia-org/theme-ui/chat/ModelSelectorView";
import { useModelMenuFooter } from "./input-bar/model-menu-footer-context";
import { useCallback, useEffect, useMemo, useState } from "react";

export function ModelSelector({
	updateActiveSession = true,
	scope,
	openOnShortcut = true,
}: {
	readonly updateActiveSession?: boolean;
	readonly scope?: ModelSelectorScope;
	/** 输入栏里的那颗才抢 Cmd/Ctrl+P；插件与团队面板复用同一视图时不注册全局键。 */
	readonly openOnShortcut?: boolean;
} = {}): JSX.Element {
	const model = useModelSelectorModel({ updateActiveSession, scope });
	// 输入栏的权限模式（沙箱 / 完全访问）挂在菜单底栏；插件与团队面板没有输入栏，读到 null。
	const footer = useModelMenuFooter();
	const ThemedModelSelectorView = useThemeComponent("chat.modelSelectorView", ModelSelectorView);
	const [open, setOpen] = useState(false);

	const handleOpenChange = useCallback((next: boolean) => setOpen(next), []);

	// Cmd/Ctrl+P 与其它「打开某某面板」的快捷键同形：输入框里也要生效，
	// 用 when=editable 而不是 always，避免在只读区域里也抢键。
	const bindings = useMemo(
		() => [
			{
				key: "mod+p",
				when: "editable" as const,
				preventDefault: true,
				run: () => setOpen(true),
			},
		],
		[],
	);

	useShortcutScope({
		id: "chat:model-selector",
		kind: "overlay",
		active: openOnShortcut && !model.empty,
		exclusive: false,
		bindings,
	});

	// 面板关掉时把受控状态收回来：Esc / 选中后都会经过 onOpenChange。
	useEffect(() => {
		if (!open) return;
		if (model.empty) setOpen(false);
	}, [open, model.empty]);

	// 没有可选模型时菜单不存在，底栏插槽退回原位：否则权限模式会随之一起消失，用户无从修改。
	if (model.empty) return <>{footer}</>;
	return (
		<ThemedModelSelectorView
			{...model.viewProps}
			open={open}
			onOpenChange={handleOpenChange}
			footerStart={footer ?? undefined}
		/>
	);
}
