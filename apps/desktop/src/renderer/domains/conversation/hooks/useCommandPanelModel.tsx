import type { SkillInfo } from "@preload/api";
import { useShortcutScope, type ShortcutBinding } from "@shared/shortcuts";
import { activeSessionAtom, contextCompactionEligibilityAtom } from "@shared/store/atoms";
import { getQueueForSession, messageQueueBySessionAtom } from "@shared/store/message-queue-atoms";
import { showToast } from "@shared/store/toast-atoms";
import { useAtomValue } from "jotai";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ADD_PANEL_CATEGORY_ORDER,
	type AddPanelCategory,
	type AddPanelEntry,
	type AddPanelSection,
	type AddPanelTab,
	buildAddPanelCatalog,
	buildFavoritesSections,
	flattenAddPanelSections,
	searchAddPanelSections,
	sectionOf,
	visibleCategories,
} from "../components/command-panel/add-panel-catalog";
import { buildCommandPanelLabels } from "../components/command-panel/command-panel-labels";
import type {
	CommandPanelActionItem,
	CommandPanelFileAction,
	CommandPanelOperationItem,
	CommandPanelPreviewModel,
	CommandPanelProps,
} from "../components/command-panel/types";
import { type InputActionBarModel, useInputActionBarModel } from "../components/useInputActionBarModel";
import { focusInputEditor, removeInputTrigger } from "../components/input-bar/editor/inputEditorHandle";
import { formatUsagePercent } from "../services/context-ring-details";
import { useAddPanelFavorites } from "./useAddPanelFavorites";
import { type ConnectorGridItem, useConnectorGrid } from "./useConnectorGrid";
import { useDefaultContextRingModel } from "./useContextRingModel";
import { skillIconOf, useSkillIconMap } from "./useSkillIconMap";
import { useSkillList } from "./useSkillList";

/** 压缩上下文那一行在键盘索引里占第 0 位，与改造前一致。 */
const OPERATION_KEY = "__operation__";

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
	const activeSession = useAtomValue(activeSessionAtom);
	const compactionEligibility = useAtomValue(contextCompactionEligibilityAtom);
	const queueMap = useAtomValue(messageQueueBySessionAtom);
	const contextRing = useDefaultContextRingModel(false);
	const [queueingCompaction, setQueueingCompaction] = useState(false);
	const queuedCompaction = activeSession
		? getQueueForSession(queueMap, activeSession.runtimeId).some((item) => item.kind === "context_compaction")
		: false;
	const operationMatches =
		normalizedFilter.length === 0 ||
		["compact", "compaction", "context", "压缩", "上下文"].some((term) =>
			term.includes(normalizedFilter.toLocaleLowerCase()),
		);

	// 预取：面板第一次展开时不必再等扫盘，避免与揭幕动画抢主线程。
	const { items: skills } = useSkillList({
		open,
		cwd,
		filter: normalizedFilter,
		surface: "commandPalette",
		prefetch: true,
	});
	const { items: connectors } = useConnectorGrid(open, true);
	const iconMap = useSkillIconMap(open, true);
	const resolveIcon = useCallback((skill: SkillInfo) => skillIconOf(iconMap, skill), [iconMap]);
	const favorites = useAddPanelFavorites();

	const [tab, setTab] = useState<AddPanelTab>("skills");
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	/** 键盘移动序号：只在 `↑`/`↓` 时递增，列表据此决定要不要把高亮行滚进视口。 */
	const [scrollSignal, setScrollSignal] = useState(0);
	const [previewKey, setPreviewKey] = useState<string | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const catalog = useMemo(
		() =>
			buildAddPanelCatalog({
				files: fileActions?.map((action) => ({ id: action.id, label: action.label, icon: action.icon })),
				skills,
				connectors,
				resolveSkillIcon: resolveIcon,
			}),
		[connectors, fileActions, resolveIcon, skills],
	);

	const categories = useMemo(() => visibleCategories(catalog), [catalog]);

	// 当前分类被数据掏空（例如连接器全被移除）时退回第一个可见分类，不留一个空轨道选中态。
	useEffect(() => {
		if (tab === "favorites") return;
		if (categories.includes(tab)) return;
		const next = categories[0];
		if (next) setTab(next);
	}, [categories, tab]);

	const searching = query.trim().length > 0;
	const sections = useMemo(() => {
		if (searching) return searchAddPanelSections(catalog, query);
		if (tab === "favorites") return buildFavoritesSections(catalog, favorites.favorites);
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

	// 数据变化（切分类、改搜索词、收藏增删）后高亮项可能已不在列表里：拉回第 0 位。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 依赖是「重置时机」而非读取值
	useEffect(() => {
		setActiveIndex(0);
	}, [tab, query, normalizedFilter, searching, previewKey]);

	const selectCompaction = useCallback(() => {
		if (!activeSession || queueingCompaction || queuedCompaction || contextRing?.isCompacting) return;
		setQueueingCompaction(true);
		removeInputTrigger();
		onClose();
		focusInputEditor();
		void window.astravia.session
			.queueContextCompaction(activeSession.runtimeId)
			.catch((error) => {
				console.warn("[useCommandPanelModel] queue context compaction failed", error);
				showToast({
					variant: "error",
					title: t("slashPanel.compaction.errorTitle"),
					message: error instanceof Error ? error.message : t("slashPanel.compaction.errorMessage"),
				});
			})
			.finally(() => setQueueingCompaction(false));
	}, [activeSession, contextRing?.isCompacting, onClose, queuedCompaction, queueingCompaction, t]);

	const operation = useMemo<CommandPanelOperationItem | undefined>(() => {
		if (!allowCompaction || !activeSession || !operationMatches || compactionEligibility.status === "ineligible")
			return undefined;
		// `contextRing.percent` 已经是 0–100 的进度口径；取整走与压缩环提示相同的格式化，
		// 否则同一份用量会在两个地方显示成不同数字。
		const percent = contextRing ? formatUsagePercent(contextRing.percent) : null;
		const description = contextRing?.isCompacting
			? t("slashPanel.compaction.compacting")
			: queuedCompaction || queueingCompaction
				? t("slashPanel.compaction.queued")
				: percent === null
					? t("slashPanel.compaction.descriptionUnknown")
					: t("slashPanel.compaction.description", { percent });
		return {
			id: OPERATION_KEY,
			label: t("slashPanel.compaction.label"),
			description,
			contextRing: contextRing
				? {
						percent: contextRing.percent,
						offset: contextRing.offset,
						color: contextRing.color,
						isCompacting: contextRing.isCompacting,
						tooltip: contextRing.tooltip,
					}
				: null,
			disabled: queuedCompaction || queueingCompaction || Boolean(contextRing?.isCompacting),
			onSelect: selectCompaction,
		};
	}, [
		activeSession,
		allowCompaction,
		compactionEligibility.status,
		contextRing,
		operationMatches,
		queuedCompaction,
		queueingCompaction,
		selectCompaction,
		t,
	]);

	const operationOffset = operation ? 1 : 0;
	const total = visibleEntries.length + operationOffset;
	const activeEntry =
		operationOffset === 1 && activeIndex === 0 ? null : (visibleEntries[activeIndex - operationOffset] ?? null);
	const activeKey = operationOffset === 1 && activeIndex === 0 ? OPERATION_KEY : (activeEntry?.key ?? null);

	const labels = useMemo(() => buildCommandPanelLabels((key) => t(key)), [t]);

	const activateEntry = useCallback(
		(entry: AddPanelEntry) => {
			switch (entry.category) {
				case "files": {
					fileActions?.find((candidate) => candidate.id === entry.id)?.onSelect();
					return;
				}
				case "skills": {
					const skill = skills.find((candidate) => `${candidate.type}:${candidate.name}` === entry.id);
					if (skill) onSelect(skill, resolveIcon(skill));
					return;
				}
				case "connectors": {
					const connector = connectors.find((candidate) => candidate.name === entry.id);
					if (connector) onSelectConnector(connector);
					return;
				}
				default:
					// 插件与应用还没有数据源接入，不会出现在目录里。
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

	const handleHoverEntry = useCallback(
		(key: string) => {
			if (key === OPERATION_KEY) {
				setActiveIndex(0);
				return;
			}
			const index = visibleEntries.findIndex((entry) => entry.key === key);
			if (index >= 0) setActiveIndex(index + operationOffset);
		},
		[operationOffset, visibleEntries],
	);

	const handleActivateEntry = useCallback(
		(key: string) => {
			if (key === OPERATION_KEY) {
				selectCompaction();
				return;
			}
			const entry = visibleEntries.find((candidate) => candidate.key === key);
			if (entry) activateEntry(entry);
		},
		[activateEntry, selectCompaction, visibleEntries],
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
		} as const;

		if (entry.category === "files") {
			return { ...base, meta: [], hint: labels.preview.hintFile };
		}
		if (entry.category === "skills") {
			const identifier = entry.id.split(":").slice(1).join(":");
			return {
				...base,
				meta: [
					{ label: labels.preview.sourceLabel, value: groupLabel },
					{ label: labels.preview.insertLabel, value: `/${identifier}` },
				],
				hint: labels.preview.hintSkill,
			};
		}
		if (entry.category === "connectors") {
			return {
				...base,
				meta: [{ label: labels.preview.statusLabel, value: labels.preview.statusConnected }],
				hint: labels.preview.hintConnector,
			};
		}
		return { ...base, meta: [], hint: labels.preview.hintExtension };
	}, [labels, previewKey, sections, visibleEntries]);

	const handleOpenPreview = useCallback((key: string) => setPreviewKey(key), []);
	const handleClosePreview = useCallback(() => setPreviewKey(null), []);

	const keyBindings = useMemo((): ShortcutBinding[] => {
		// 预览态下方向键与 Enter 不该再去动列表：用户此刻在读内容。
		if (previewKey) {
			return [
				{ key: "escape", run: () => handleClosePreview() },
				{ key: "arrowleft", run: () => handleClosePreview() },
			];
		}
		return [
			{
				key: "arrowdown",
				run: () => {
					if (total === 0) return;
					setScrollSignal((value) => value + 1);
					setActiveIndex((index) => (index + 1) % total);
				},
			},
			{
				key: "arrowup",
				run: () => {
					if (total === 0) return;
					setScrollSignal((value) => value + 1);
					setActiveIndex((index) => (index - 1 + total) % total);
				},
			},
			{
				key: "tab",
				run: () => {
					const order: AddPanelTab[] = ["favorites", ...categories];
					const at = order.indexOf(tab);
					handleSelectTab(order[(at + 1) % order.length] ?? "skills");
				},
			},
			{
				key: "enter",
				run: () => {
					if (activeKey === OPERATION_KEY) {
						selectCompaction();
						return;
					}
					if (activeEntry) activateEntry(activeEntry);
				},
			},
			{
				key: "escape",
				run: () => onClose(),
			},
		];
	}, [
		activeEntry,
		activateEntry,
		activeKey,
		categories,
		handleClosePreview,
		handleSelectTab,
		onClose,
		previewKey,
		selectCompaction,
		tab,
		total,
	]);

	useShortcutScope({
		id: "overlay:command-panel",
		kind: "overlay",
		active: open,
		exclusive: false,
		bindings: keyBindings,
	});

	useEffect(() => {
		if (!open) return;
		function handleClick(event: MouseEvent): void {
			const target = event.target as Node;
			if (!panelRef.current || panelRef.current.contains(target)) return;
			// 「+」按钮自己负责开合，别让这里先把它关掉（否则它永远只能开、不能收）。
			// keep-open 是展开态才出现的「插图 / 附件」：mousedown 就收面板会把按钮连带卸载，
			// 后续的 click 落不到元素上，文件选择器根本弹不出来。
			if (
				target instanceof Element &&
				target.closest("[data-command-panel-toggle],[data-command-panel-keep-open]")
			) {
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
			categories: categories as readonly AddPanelCategory[],
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
			className,
			onSelectTab: handleSelectTab,
			onQueryChange: setQuery,
			onHoverEntry: handleHoverEntry,
			onActivateEntry: handleActivateEntry,
			onOpenPreview: handleOpenPreview,
			onClosePreview: handleClosePreview,
			onToggleFavorite: favorites.toggle,
			onOpenAbilityPlaza,
		},
	};
}

/** 供测试与调用方复用的分类顺序常量。 */
export { ADD_PANEL_CATEGORY_ORDER };
export type { AddPanelSection };
