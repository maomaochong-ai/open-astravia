import { useThemeComponent } from "@astravia-org/theme-sdk";
import { useEffectiveShortcut } from "@shared/hooks/useShortcuts";
import { shortcutParts } from "@shared/lib/platform";
import { useShortcutScope } from "@shared/shortcuts";
import { ModelSelectorView } from "@astravia-org/theme-ui/chat/ModelSelectorView";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ModelSelectorScope, useModelSelectorModel } from "../hooks/useModelSelectorModel";
import { ExecutionModeSelector } from "./ExecutionModeSelector";
import { useModelMenuFooter } from "./input-bar/model-menu-footer-context";

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
	// 输入栏的权限模式（沙箱 / 完全访问）挂在菜单底栏右侧；插件与团队面板没有输入栏，读到 null。
	const footer = useModelMenuFooter();
	const ThemedModelSelectorView = useThemeComponent("chat.modelSelectorView", ModelSelectorView);
	const [open, setOpen] = useState(false);

	const handleOpenChange = useCallback((next: boolean) => setOpen(next), []);

	/**
	 * 组合键来自设置里的「打开模型选择器」绑定，不写死：改键之后这里与底栏提示要一起变。
	 * 与其它「打开某某面板」的快捷键同形，输入框里也要生效，因此用 when=editable 而不是 always。
	 */
	const openShortcut = useEffectiveShortcut("open-model-selector");
	const bindings = useMemo(
		() => [
			{
				key: openShortcut,
				when: "editable" as const,
				preventDefault: true,
				run: () => setOpen(true),
			},
		],
		[openShortcut],
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

	/*
	 * 底栏两个位置与参照实现一致：左侧是「怎么打开这个面板」的键帽提示，右侧是权限模式。
	 * 权限模式这颗要显式给 showLabel（底栏不是容器查询上下文，否则只出图标）并把弹层朝左展开
	 * （它在面板最右一格，向右开会顶出面板右缘）。
	 */
	const executionMode = footer ? (
		<ExecutionModeSelector model={{ ...footer, showLabel: true, contentAlign: "end", className: "ml-0" }} />
	) : undefined;

	// 没有可选模型时菜单不存在，底栏插槽退回原位：否则权限模式会随之一起消失，用户无从修改。
	if (model.empty) return <>{executionMode}</>;
	return (
		<ThemedModelSelectorView
			{...model.viewProps}
			open={open}
			onOpenChange={handleOpenChange}
			footerStart={<ModelSelectorShortcutHint shortcut={openShortcut} />}
			footerEnd={executionMode}
		/>
	);
}

/**
 * 底栏左侧：打开 / 收起这个面板的组合键。
 *
 * 与参照实现一致，按「键帽」逐段渲染；文案随设置里的绑定实时变化，
 * 因此这里绝不能再写一遍 `mod+p`。
 */
export function ModelSelectorShortcutHint({ shortcut }: { readonly shortcut: string }): JSX.Element {
	const { t } = useTranslation("common");
	const parts = shortcutParts(shortcut);
	return (
		<span className="flex items-center gap-1" title={t("modelSelect.shortcutHint")}>
			{parts.map((part, index) => (
				<kbd
					// biome-ignore lint/suspicious/noArrayIndexKey: 组合键各段固定顺序，同一个键可能重复出现
					key={index}
					className="rounded border border-border/60 bg-muted/50 px-1 text-[10px] font-medium leading-4 text-muted-foreground"
				>
					{part}
				</kbd>
			))}
		</span>
	);
}
