import type { SkillInfo } from "@preload/api";
import { type ShortcutBinding, useShortcutScope } from "@shared/shortcuts";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SkillPickerPanelViewProps } from "../components/command-panel/SkillPickerPanel";
import { skillSourceLabelKey } from "../lib/skill-source-label";
import { useSkillList } from "./useSkillList";

export interface SkillPickerModelInput {
	open: boolean;
	onClose: () => void;
	onSelect: (skill: SkillInfo) => void;
	filter: string;
	placement?: "top" | "bottom";
	cwd?: string;
	className?: string;
}

export interface SkillPickerModel {
	viewProps: SkillPickerPanelViewProps;
}

/** dialog 侧的纯 skill 选择器：同一份列表与排序，去掉连接器与动作条。 */
export function useSkillPickerModel({
	open,
	onClose,
	onSelect,
	filter,
	placement = "top",
	cwd,
	className,
}: SkillPickerModelInput): SkillPickerModel {
	const { t } = useTranslation("chat");
	const normalizedFilter = filter.startsWith("/") ? filter.slice(1) : filter;
	const { items } = useSkillList({ open, cwd, filter: normalizedFilter });
	const [activeIndex, setActiveIndex] = useState(0);
	const panelRef = useRef<HTMLDivElement>(null);
	// 仅键盘导航需要把高亮滚进视口；鼠标 hover 只改高亮，不抢滚动位置。
	const shouldScrollActiveIntoViewRef = useRef(false);

	// 过滤词一变就把高亮拉回首项，否则会指向一个已被过滤掉的位置。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 依赖是「重置时机」而非读取值
	useEffect(() => {
		setActiveIndex(0);
	}, [normalizedFilter]);

	useLayoutEffect(() => {
		if (!open || !shouldScrollActiveIntoViewRef.current) return;
		shouldScrollActiveIntoViewRef.current = false;
		panelRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open]);

	const keyBindings = useMemo((): ShortcutBinding[] => {
		return [
			{
				key: "arrowdown",
				run: () => {
					if (items.length === 0) return;
					shouldScrollActiveIntoViewRef.current = true;
					setActiveIndex((index) => (index + 1) % items.length);
				},
			},
			{
				key: "arrowup",
				run: () => {
					if (items.length === 0) return;
					shouldScrollActiveIntoViewRef.current = true;
					setActiveIndex((index) => (index - 1 + items.length) % items.length);
				},
			},
			{
				key: "enter",
				run: () => {
					const target = items[activeIndex];
					if (target) onSelect(target);
				},
			},
			{
				key: "escape",
				run: () => onClose(),
			},
		];
	}, [activeIndex, items, onClose, onSelect]);

	useShortcutScope({
		id: "overlay:skill-picker",
		kind: "overlay",
		active: open,
		exclusive: false,
		bindings: keyBindings,
	});

	useEffect(() => {
		if (!open) return;
		function handleClick(event: MouseEvent): void {
			if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
		}
		const timer = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("mousedown", handleClick);
		};
	}, [onClose, open]);

	const labels = useMemo(
		() => ({
			header: t("slashPanel.header"),
			resultCount: t("slashPanel.resultCount", { count: items.length }),
			emptyNoMatch: t("slashPanel.emptyNoMatch"),
			emptyNoMatchHint: t("slashPanel.emptyNoMatchHint"),
			emptyNoSkills: t("slashPanel.emptyNoSkills"),
			emptyNoSkillsHint: t("slashPanel.emptyNoSkillsHint"),
			sourceLabel: (source: string, type: SkillInfo["type"]) => {
				const key = skillSourceLabelKey(source, type);
				return key ? t(key) : source;
			},
		}),
		[items.length, t],
	);

	return {
		viewProps: {
			open,
			placement,
			filter: normalizedFilter,
			items,
			activeIndex,
			labels,
			panelRef: panelRef as RefObject<HTMLDivElement | null>,
			className,
			onHoverItem: setActiveIndex,
			onSelectItem: onSelect,
		},
	};
}
