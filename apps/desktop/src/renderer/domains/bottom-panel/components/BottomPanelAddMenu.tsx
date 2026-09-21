import { Button } from "@shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@shared/components/ui/popover";
import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";
import { canOpenBottomPanelComponent } from "../registry/resolve-bottom-panel-tabs";
import type { BottomPanelComponentDefinition } from "../registry/types";
import type { BottomPanelSessionState } from "@shared/store/atoms";

export interface BottomPanelAddMenuProps {
	readonly definitions: readonly BottomPanelComponentDefinition[];
	readonly state: BottomPanelSessionState;
	readonly onPick: (definition: BottomPanelComponentDefinition) => void;
}

/** 「+」菜单：内置在上、插件在下并带来源副标题，与活动面板的加号菜单同一套信息结构。 */
export function BottomPanelAddMenu({ definitions, state, onPick }: BottomPanelAddMenuProps): JSX.Element {
	const { t } = useTranslation("chat");
	const [open, setOpen] = useState(false);
	const builtins = definitions.filter((definition) => definition.source === "builtin");
	const plugins = definitions.filter((definition) => definition.source === "plugin");

	const renderRow = (definition: BottomPanelComponentDefinition): JSX.Element => {
		const allowed = canOpenBottomPanelComponent(state, definition);
		return (
			<button
				key={definition.id}
				type="button"
				disabled={!allowed}
				title={allowed ? undefined : t("bottomPanel.addMenu.instanceLimit")}
				onClick={() => {
					setOpen(false);
					onPick(definition);
				}}
				className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-accent/60 disabled:opacity-40 disabled:hover:bg-transparent"
			>
				{typeof definition.defaultMeta.icon === "string" ? (
					<span aria-hidden className={`${definition.defaultMeta.icon} h-3.5 w-3.5 shrink-0`} />
				) : (
					<span aria-hidden className="h-3.5 w-3.5 shrink-0">
						{definition.defaultMeta.icon}
					</span>
				)}
				<span className="min-w-0 flex-1 truncate">{definition.defaultMeta.label}</span>
				{definition.pluginName ? (
					<span className="shrink-0 text-[11px] text-muted-foreground">{definition.pluginName}</span>
				) : null}
			</button>
		);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="icon-xs" aria-label={t("bottomPanel.actions.add")}>
					<span aria-hidden className="icon-[solar--add-circle-linear] h-3.5 w-3.5" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-56 p-1">
				{builtins.length > 0 ? (
					<div className="px-2.5 pt-1 pb-0.5 text-[10px] text-muted-foreground">
						{t("bottomPanel.addMenu.builtinGroup")}
					</div>
				) : null}
				{builtins.map(renderRow)}
				{plugins.length > 0 ? (
					<div className="px-2.5 pt-1.5 pb-0.5 text-[10px] text-muted-foreground">
						{t("bottomPanel.addMenu.pluginGroup")}
					</div>
				) : null}
				{plugins.map(renderRow)}
			</PopoverContent>
		</Popover>
	);
}
