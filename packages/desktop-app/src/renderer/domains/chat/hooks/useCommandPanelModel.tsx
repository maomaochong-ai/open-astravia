import type { SkillInfo } from "@preload/api";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommandPanelLabels, CommandPanelProps } from "../components/command-panel/types";
import type { ConnectorGridItem } from "./useConnectorGrid";
import { useConnectorGrid } from "./useConnectorGrid";
import { useInputActionBarModel } from "../components/useInputActionBarModel";
import { skillSourceLabelKey } from "../lib/skill-source-label";
import { useSkillList } from "./useSkillList";

export interface CommandPanelModelInput {
	open: boolean;
	onClose: () => void;
	onSelect: (skill: SkillInfo) => void;
	onSelectConnector: (connector: ConnectorGridItem) => void;
	/** 触发词原文（含 `/`）。 */
	filter: string;
	placement?: "top" | "bottom";
	cwd?: string;
	className?: string;
}

export interface CommandPanelModel {
	viewProps: CommandPanelProps;
}

export function useCommandPanelModel({
	open,
	onClose,
	onSelect,
	onSelectConnector,
	filter,
	placement = "top",
	cwd,
	className,
}: CommandPanelModelInput): CommandPanelModel {
	const { t } = useTranslation("chat");
	const normalizedFilter = filter.startsWith("/") ? filter.slice(1) : filter;
	const { items } = useSkillList({ open, cwd, filter: normalizedFilter });
	const { items: connectors, columns } = useConnectorGrid(open);
	const actionBar = useInputActionBarModel();
	const [activeIndex, setActiveIndex] = useState(0);
	const panelRef = useRef<HTMLDivElement>(null);

	// 过滤词一变就把高亮拉回首项，否则会指向一个已被过滤掉的位置。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 依赖是「重置时机」而非读取值
	// 过滤词一变就把高亮拉回首项，否则会指向一个已被过滤掉的位置。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 依赖是「重置时机」而非读取值
	useEffect(() => {
		setActiveIndex(0);
	}, [normalizedFilter]);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (!open || items.length === 0) return;
			if (event.key === "ArrowDown") {
				event.preventDefault();
				event.stopPropagation();
				setActiveIndex((index) => (index + 1) % items.length);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				event.stopPropagation();
				setActiveIndex((index) => (index - 1 + items.length) % items.length);
			} else if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				const target = items[activeIndex];
				if (target) onSelect(target);
			} else if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			}
		},
		[activeIndex, items, onClose, onSelect, open],
	);

	useEffect(() => {
		if (!open) return;
		document.addEventListener("keydown", handleKeyDown, true);
		return () => document.removeEventListener("keydown", handleKeyDown, true);
	}, [handleKeyDown, open]);

	useEffect(() => {
		if (!open) return;
		function handleClick(event: MouseEvent): void {
			if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
		}
		// 延后一帧再挂：打开面板的那次 mousedown 否则会立刻把它关掉。
		const timer = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("mousedown", handleClick);
		};
	}, [onClose, open]);

	useEffect(() => {
		if (!open) return;
		panelRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open]);

	const labels: CommandPanelLabels = useMemo(
		() => ({
			header: t("slashPanel.header"),
			resultCount: t("slashPanel.resultCount", { count: items.length }),
			connectorsSection: t("slashPanel.connectorsSection"),
			emptyNoMatch: t("slashPanel.emptyNoMatch"),
			emptyNoSkills: t("slashPanel.emptyNoSkills"),
			sourceLabel: (source, type) => {
				const key = skillSourceLabelKey(source, type);
				return key ? t(key) : source;
			},
		}),
		[items.length, t],
	);

	const actions = useMemo(
		() => [
			...(actionBar.knowledge
				? [
						{
							id: "__builtin_knowledge_retrieval__",
							label: actionBar.knowledge.label,
							icon: (
								<span className="icon-[mdi--book-search-outline] flex h-3.5 w-3.5 items-center justify-center" />
							),
							active: actionBar.knowledge.active,
							onToggle: actionBar.actions.toggleKnowledge,
						},
					]
				: []),
			...actionBar.items.map((item) => ({
				id: item.id,
				label: item.label,
				icon: item.icon,
				active: item.active,
				onToggle: () => actionBar.actions.toggleItem(item.id),
			})),
		],
		[actionBar],
	);

	return {
		viewProps: {
			open,
			placement,
			filter: normalizedFilter,
			items,
			activeIndex,
			connectors,
			connectorColumns: columns,
			actions,
			labels,
			panelRef: panelRef as RefObject<HTMLDivElement | null>,
			className,
			onHoverItem: setActiveIndex,
			onSelectItem: onSelect,
			onSelectConnector,
		},
	};
}
