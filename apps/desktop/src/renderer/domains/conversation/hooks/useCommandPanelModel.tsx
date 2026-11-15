import type { SkillInfo } from "@preload/api";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ADD_PANEL_CATEGORY_ORDER,
	type AddPanelEntry,
	type AddPanelTab,
	buildAddPanelCatalog,
	buildFavoritesSections,
	flattenAddPanelSections,
	searchAddPanelSections,
	sectionOf,
} from "../components/command-panel/add-panel-catalog";
import { buildCommandPanelLabels } from "../components/command-panel/command-panel-labels";
import type {
	CommandPanelActionItem,
	CommandPanelFileAction,
	CommandPanelPreviewModel,
	CommandPanelProps,
} from "../components/command-panel/types";
import { type InputActionBarModel, useInputActionBarModel } from "../components/useInputActionBarModel";
import { useAddPanelAbilityEntries } from "./useAddPanelAbilityEntries";
import { useAddPanelFavorites } from "./useAddPanelFavorites";
import { COMPACTION_OPERATION_KEY, useCommandPanelCompaction } from "./useCommandPanelCompaction";
import { type ConnectorGridItem, useConnectorGrid } from "./useConnectorGrid";
import { skillIconOf, useSkillIconMap } from "./useSkillIconMap";
import { useSkillList } from "./useSkillList";

export interface CommandPanelModelInput {
	inputActions?: InputActionBarModel;
	open: boolean;
	onClose: () => void;
	onSelect: (skill: SkillInfo, icon?: string) => void;
	onSelectConnector: (connector: ConnectorGridItem) => void;
	/** 触发词原文（含 `/`）。 */
	filter: string;
	cwd?: string;
	className?: string;
	/** 会话级操作仅在已绑定 Runtime 的聊天输入框中可用。 */
	allowCompaction?: boolean;
	fileActions?: readonly CommandPanelFileAction[];
	/** 打开能力广场首页（左栏底部入口）。 */
	onOpenAbilityPlaza?: () => void;
}

export interface CommandPanelModel {
	viewProps: CommandPanelProps;
}

/**
 * 添加面板的连接层：把三类数据源投影成目录，持有分类 / 搜索 / 高亮 / 预览状态，
 * 并处理面板内的键盘（`onPanelKeyDown`）。
 *
 * 它不做渲染决策（那些在 `CommandPanelView`），也不管压缩上下文
 * （那一行由 `useCommandPanelCompaction` 自己负责）。
 */
export function useCommandPanelModel({
	inputActions,
	open,
	onClose,
	onSelect,
	onSelectConnector,
	filter,
	cwd,
	className,
	allowCompaction = true,
	fileActions,
	onOpenAbilityPlaza,
}: CommandPanelModelInput): CommandPanelModel {
	const { t } = useTranslation("chat");
	const normalizedFilter = filter.startsWith("/") ? filter.slice(1) : filter;

	// 预取：面板第一次展开时不必再等扫盘，避免与揭幕动画抢主线程。
	/**
	 * 连接器清单只作**查找表**用：面板展示的条目来自能力页，插入时要落回 mcp.json 的
	 * server 名与图标，所以这里仍读一次配置（不参与分类与是否出现的判断）。
	 */
	const { items: connectors } = useConnectorGrid(open, true);

	// 技能清单仍要保留：插入时要拿到原始 SkillInfo（面板只展示标题与图标）。
	const { items: skills } = useSkillList({
		open,
		cwd,
		filter: normalizedFilter,
		surface: "commandPalette",
		prefetch: true,
	});
	const iconMap = useSkillIconMap(open, true);
	const resolveIcon = useCallback((skill: SkillInfo) => skillIconOf(iconMap, skill), [iconMap]);
	const favorites = useAddPanelFavorites();
	/**
	 * 面板的条目直接来自能力页的同一套组装结果（ADR-0177）：技能 / 连接器 / 插件 / 应用
	 * 的名称、图标、是否出现都跟能力页一致，面板不再自己扫 `mcp.json` 或猜技能来源。
	 */
	const abilityEntries = useAddPanelAbilityEntries(open);

	/**
	 * 默认停在「全部」：与能力页「有什么就列什么」一致，用户不必先猜东西属于哪一类。
	 *
	 * 不做「记住上次分类」：清单是异步来的，记住 + 自动纠正会让分类在打开后几百毫秒里
	 * 跳一次；每次打开都一样更稳。
	 */
	const [tab, setTab] = useState<AddPanelTab>("all");
	const [query, setQuery] = useState("");
	/**
	 * 键盘高亮下标。**初始为 -1（没有高亮项）**：这个列表不是「当前值」，默认给第一行
	 * 上选中态会被读成「已经选好了」；模型选择器必须显示当前模型，所以它有默认项，
	 * 这里没有。
	 */
	const [activeIndex, setActiveIndex] = useState(-1);
	/** 键盘移动序号：只在 `↑`/`↓` 时递增，列表据此决定要不要把高亮行滚进视口。 */
	const [scrollSignal, setScrollSignal] = useState(0);
	const [previewKey, setPreviewKey] = useState<string | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const operation = useCommandPanelCompaction({
		onClose,
		enabled: allowCompaction,
		filter: normalizedFilter,
	});

	const catalog = useMemo(
		() =>
			buildAddPanelCatalog({
				files: fileActions?.map((action) => ({ id: action.id, label: action.label, icon: action.icon })),
				entries: abilityEntries,
			}),
		[abilityEntries, fileActions],
	);

	const searching = query.trim().length > 0;
	const sections = useMemo(() => {
		if (searching) return searchAddPanelSections(catalog, query);
		if (tab === "favorites") return buildFavoritesSections(catalog, favorites.favorites);
		if (tab === "all") return catalog;
		if (tab === "operations") return [];
		const section = sectionOf(catalog, tab);
		return section ? [section] : [];
	}, [catalog, favorites.favorites, query, searching, tab]);

	/**
	 * 可见条目。
	 *
	 * 两处过滤叠加，互不替代：编辑器里的 `/xxx` 触发词按原有语义过滤整份清单（用户是
	 * 直接在输入框里打字的），面板搜索框按分类内条目过滤（用户点开面板后再找）。
	 */
	const visibleEntries = useMemo(() => {
		const entries = flattenAddPanelSections(sections);
		const needle = normalizedFilter.trim().toLocaleLowerCase();
		if (!needle || searching) return entries;
		return entries.filter(
			(entry) =>
				entry.label.toLocaleLowerCase().includes(needle) ||
				(entry.description ?? "").toLocaleLowerCase().includes(needle),
		);
	}, [normalizedFilter, searching, sections]);

	// 数据变化（切分类、改搜索词、收藏增删）后清掉高亮：那些条目可能已经不在列表里，
	// 而且用户此刻还没按方向键。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 依赖是「重置时机」而非读取值
	useEffect(() => {
		setActiveIndex(-1);
	}, [tab, query, normalizedFilter, searching, previewKey]);

	/** 压缩上下文是「操作」分类里的一行，不再是固定头部：只有停在该分类时参与列表。 */
	const showsOperations = tab === "operations" && operation !== undefined;
	const operationOffset = showsOperations ? 1 : 0;
	const total = visibleEntries.length + operationOffset;
	const activeEntry =
		activeIndex < 0 || (operationOffset === 1 && activeIndex === 0)
			? null
			: (visibleEntries[activeIndex - operationOffset] ?? null);
	const activeKey =
		activeIndex < 0
			? null
			: operationOffset === 1 && activeIndex === 0
				? COMPACTION_OPERATION_KEY
				: (activeEntry?.key ?? null);

	const labels = useMemo(() => buildCommandPanelLabels(t), [t]);

	const activateEntry = useCallback(
		(entry: AddPanelEntry) => {
			switch (entry.category) {
				case "files":
					fileActions?.find((candidate) => candidate.id === entry.id)?.onSelect();
					return;
				case "skills": {
					const skill = skills.find((candidate) => `${candidate.type}:${candidate.name}` === entry.id);
					if (skill) onSelect(skill, resolveIcon(skill));
					return;
				}
				case "connectors": {
					// 面板里的连接器 id 是能力 id（`<source>:<id>:mcp:<slug>`），要落回 mcp.json 的
					// server 名才能插入 `@mcp:` 标记。取最后一段 slug，再用已加载的配置确认存在。
					const slug = entry.id.split(":").pop() ?? entry.id;
					const connector =
						connectors.find((candidate) => candidate.name === slug) ??
						connectors.find((candidate) => candidate.name === entry.label);
					if (connector) onSelectConnector(connector);
					return;
				}
				default:
					// 插件与应用没有「插入」语义（它们提供技能，不产出文本）：点行改为打开预览，
					// 页面里说明它是什么、以及它提供的技能在哪一类。空白响应比任何反馈都差。
					setPreviewKey(entry.key);
					return;
			}
		},
		[connectors, fileActions, onSelect, onSelectConnector, resolveIcon, skills],
	);

	const handleSelectTab = useCallback((next: AddPanelTab) => {
		setTab(next);
		setQuery("");
		setPreviewKey(null);
	}, []);

	const handleActivateEntry = useCallback(
		(key: string) => {
			if (key === COMPACTION_OPERATION_KEY) {
				operation?.onSelect();
				return;
			}
			const entry = visibleEntries.find((candidate) => candidate.key === key);
			if (entry) activateEntry(entry);
		},
		[activateEntry, operation, visibleEntries],
	);

	const preview = useMemo<CommandPanelPreviewModel | null>(() => {
		if (!previewKey) return null;
		const entry = visibleEntries.find((candidate) => candidate.key === previewKey);
		if (!entry) return null;
		const categoryLabel = labels.categoryLabel(entry.category);
		const group = sections
			.flatMap((section) => section.groups)
			.find((candidate) => candidate.entries.some((candidate) => candidate.key === entry.key));
		const groupLabel = group ? labels.groupLabel(group.titleKey) : "";
		const subtitle = groupLabel ? `${categoryLabel} · ${groupLabel}` : categoryLabel;
		const base = {
			key: entry.key,
			label: entry.label,
			subtitle,
			description: entry.description,
			icon: entry.icon,
			iconUrl: entry.iconUrl,
			fallbackIcon: entry.fallbackIcon,
			kind: entry.kind,
		} as const;

		if (entry.category === "files") {
			return { ...base, meta: [] };
		}
		if (entry.category === "skills") {
			const identifier = entry.id.split(":").slice(1).join(":");
			return {
				...base,
				meta: [
					{ label: labels.preview.sourceLabel, value: groupLabel },
					{ label: labels.preview.insertLabel, value: `/${identifier}` },
				],
			};
		}
		if (entry.category === "connectors") {
			// 进到目录里的连接器都是能力页认定为「已安装且启用」的，状态恒为已连接。
			return {
				...base,
				meta: [{ label: labels.preview.statusLabel, value: labels.preview.statusConnected }],
			};
		}
		return { ...base, meta: [] };
	}, [labels, previewKey, sections, visibleEntries]);

	const handleOpenPreview = useCallback((key: string) => setPreviewKey(key), []);
	const handleClosePreview = useCallback(() => setPreviewKey(null), []);

	/**
	 * 面板自己的键盘处理。
	 *
	 * 挂在这里而不是只靠全局快捷键栈：编辑器在 capture 阶段会 `preventDefault`，
	 * 全局栈看到 `defaultPrevented` 就直接放弃，于是「快捷键按了没反应」。事件来自
	 * 面板内部的元素（搜索框、条目）时，这个处理器一定先拿到。
	 */
	const onPanelKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLElement>) => {
			const key = event.key;
			if (previewKey) {
				if (key === "Escape" || key === "ArrowLeft") {
					event.preventDefault();
					event.stopPropagation();
					setPreviewKey(null);
				}
				return;
			}
			if (key === "ArrowDown" || key === "ArrowUp") {
				if (total === 0) return;
				event.preventDefault();
				event.stopPropagation();
				setScrollSignal((value) => value + 1);
				setActiveIndex((index) =>
					key === "ArrowDown" ? (index < 0 ? 0 : (index + 1) % total) : index < 0 ? total - 1 : (index - 1 + total) % total,
				);
				return;
			}
			if (key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				if (activeKey === COMPACTION_OPERATION_KEY) {
					operation?.onSelect();
					return;
				}
				if (activeEntry) activateEntry(activeEntry);
				return;
			}
			if (key === "Tab") {
				event.preventDefault();
				event.stopPropagation();
				const order: AddPanelTab[] = ["favorites", ...ADD_PANEL_CATEGORY_ORDER, "operations"];
				const at = order.indexOf(tab);
				handleSelectTab(order[(at + 1) % order.length] ?? "skills");
				return;
			}
			if (key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			}
		},
		[activeEntry, activeKey, handleSelectTab, onClose, operation, previewKey, tab, total],
	);
	/*
	 * 键盘只由 `onPanelKeyDown` 一处处理。
	 *
	 * 这里曾经同时注册 `useShortcutScope`——两者都挂在 document 的 capture 阶段，
	 * `stopPropagation()` 拦不住同一元素上的另一个监听器，于是一次 ↓ 会把高亮推进两格。
	 * 全局快捷键栈在本场景也没有额外价值：面板开着时焦点可能留在编辑器里，
	 * 而编辑器会在 capture 阶段先 `preventDefault`，栈会直接放弃。
	 */

	useEffect(() => {
		if (!open) return;
		function handleClick(event: MouseEvent): void {
			const target = event.target as Node;
			if (!panelRef.current || panelRef.current.contains(target)) return;
			// 「+」按钮自己负责开合，别让这里先把它关掉（否则它永远只能开、不能收）。
			// keep-open 是展开态才出现的「插图 / 附件」：mousedown 就收面板会把按钮连带卸载，
			// 后续的 click 落不到元素上，文件选择器根本弹不出来。
			if (target instanceof Element && target.closest("[data-command-panel-toggle],[data-command-panel-keep-open]")) {
				return;
			}
			onClose();
		}
		// 延后一帧再挂：打开面板的那次 mousedown 否则会立刻把它关掉。
		const timer = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("mousedown", handleClick);
		};
	}, [onClose, open]);

	// 关面板时清掉预览，下次打开从列表态开始。
	useEffect(() => {
		if (!open) setPreviewKey(null);
	}, [open]);

	const fallbackActionBar = useInputActionBarModel();
	const actionBar = inputActions ?? fallbackActionBar;
	const actions = useMemo<CommandPanelActionItem[]>(
		() => [
			...actionBar.builtins.map((builtin) => ({
				id: builtin.id,
				label: builtin.label,
				icon: <span className={`${builtin.iconClass} flex size-3.5 items-center justify-center`} />,
				active: builtin.active,
				onToggle: builtin.onToggle,
			})),
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
			tab,
			query,
			sections,
			activeKey,
			scrollSignal,
			favorites: favorites.favorites,
			preview,
			searching,
			operation,
			actions,
			labels,
			panelRef: panelRef as RefObject<HTMLDivElement | null>,
			onPanelKeyDown,
			className,
			onSelectTab: handleSelectTab,
			onQueryChange: setQuery,
			onActivateEntry: handleActivateEntry,
			onOpenPreview: handleOpenPreview,
			onClosePreview: handleClosePreview,
			onToggleFavorite: favorites.toggle,
			onOpenAbilityPlaza,
		},
	};
}
