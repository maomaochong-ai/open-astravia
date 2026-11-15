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
	type AddPanelEntry,
	type AddPanelTab,
	buildAddPanelCatalog,
	buildFavoritesSections,
	flattenAddPanelSections,
	searchAddPanelSections,
	sectionOf,
} from "../components/command-panel/add-panel-catalog";
import type {
	CommandPanelActionItem,
	CommandPanelDetailModel,
	CommandPanelFileAction,
	CommandPanelLabels,
	CommandPanelOperationItem,
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
	/** 打开某个条目在能力广场里的页面（详情栏次要动作）。 */
	onOpenEntryInPlaza?: (entry: AddPanelEntry) => void;
}

export interface CommandPanelModel {
	viewProps: CommandPanelProps & {
		readonly onOpenAbilityPlaza?: () => void;
		readonly onOpenEntryInPlaza?: () => void;
	};
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
	onOpenEntryInPlaza,
}: CommandPanelModelInput): CommandPanelModel {
	const { t, i18n } = useTranslation("chat");
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
	}, [tab, query, normalizedFilter, searching]);

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

	const labels = useMemo<CommandPanelLabels>(() => {
		const categoryLabel = (target: AddPanelTab): string =>
			target === "favorites" ? t("slashPanel.favorites") : t(`slashPanel.sections.${target}`);
		return {
			searchPlaceholder: t("slashPanel.searchPlaceholder"),
			clearSearch: t("slashPanel.clearSearch"),
			favorites: t("slashPanel.favorites"),
			favoritesEmpty: t("slashPanel.favoritesEmpty"),
			favoritesEmptyHint: t("slashPanel.favoritesEmptyHint"),
			openAbilityPlaza: t("slashPanel.openAbilityPlaza"),
			categoryLabel,
			// 键来自关闭的分组表（内置/我的/项目/插件…），不是任意输入；
			// i18next 的强类型键表认不出运行时拼出的变量，这里只在边界收窄一次。
			// 键来自关闭的分组表（内置/我的/项目/插件…），不是任意输入；强类型键表
			// 认不出运行时拼出的变量，这里走不校验键名的接口，缺失时退回键名本身。
			groupLabel: (titleKey: string) => i18n.t(titleKey, { ns: "chat", defaultValue: titleKey }),
			categoryEmpty: t("slashPanel.categoryEmpty"),
			emptyNoMatch: t("slashPanel.emptyNoMatch"),
			emptyNoMatchHint: t("slashPanel.emptyNoMatchHint"),
			emptyNoSkills: t("slashPanel.emptyNoSkills"),
			emptyNoSkillsHint: t("slashPanel.emptyNoSkillsHint"),
			favoriteAdd: t("slashPanel.favoriteAdd"),
			favoriteRemove: t("slashPanel.favoriteRemove"),
			details: t("slashPanel.details"),
			sourceLabel: (source: string) => t(`slashPanel.sourceLabels.${source}`, { defaultValue: source }),
			detail: {
				insert: t("slashPanel.detail.insert"),
				execute: t("slashPanel.detail.execute"),
				connect: t("slashPanel.detail.connect"),
				configure: t("slashPanel.detail.configure"),
				disconnect: t("slashPanel.detail.disconnect"),
				viewPermissions: t("slashPanel.detail.viewPermissions"),
				enable: t("slashPanel.detail.enable"),
				disable: t("slashPanel.detail.disable"),
				viewInPlaza: t("slashPanel.detail.viewInPlaza"),
				viewDetails: t("slashPanel.detail.viewDetails"),
				sourceLabel: t("slashPanel.detail.sourceLabel"),
				statusLabel: t("slashPanel.detail.statusLabel"),
				insertLabel: t("slashPanel.detail.insertLabel"),
				hintSkill: t("slashPanel.detail.hintSkill"),
				hintConnector: t("slashPanel.detail.hintConnector"),
				hintFile: t("slashPanel.detail.hintFile"),
				hintExtension: t("slashPanel.detail.hintExtension"),
				statusConnected: t("slashPanel.detail.statusConnected"),
				statusDisconnected: t("slashPanel.detail.statusDisconnected"),
				statusEnabled: t("slashPanel.detail.statusEnabled"),
				statusDisabled: t("slashPanel.detail.statusDisabled"),
				statusPublished: t("slashPanel.detail.statusPublished"),
				statusDraft: t("slashPanel.detail.statusDraft"),
			},
			hints: {
				navigate: t("slashPanel.hints.navigate"),
				select: t("slashPanel.hints.select"),
				tab: t("slashPanel.hints.tab"),
				insert: t("slashPanel.hints.insert"),
				close: t("slashPanel.hints.close"),
			},
		};
	}, [t]);

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
					// 插件与应用还没有数据源接入：分类常驻轨道，列表为空，走不到这里。
					return;
			}
		},
		[connectors, fileActions, onSelect, onSelectConnector, resolveIcon, skills],
	);

	const handleSelectTab = useCallback((next: AddPanelTab) => {
		setTab(next);
		setQuery("");
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

	const detail = useMemo<CommandPanelDetailModel | null>(() => {
		if (!activeEntry) return null;
		const categoryLabel = labels.categoryLabel(activeEntry.category);
		const group = sections
			.flatMap((section) => section.groups)
			.find((candidate) => candidate.entries.some((entry) => entry.key === activeEntry.key));
		const groupLabel = group ? labels.groupLabel(group.titleKey) : "";
		const subtitle = groupLabel ? `${categoryLabel} · ${groupLabel}` : categoryLabel;
		const base = {
			key: activeEntry.key,
			label: activeEntry.label,
			subtitle,
			description: activeEntry.description,
			primaryIcon: activeEntry.icon,
			primaryIconUrl: activeEntry.iconUrl,
		} as const;

		if (activeEntry.category === "files") {
			return { ...base, meta: [], hint: labels.detail.hintFile, primaryLabel: labels.detail.execute };
		}
		if (activeEntry.category === "skills") {
			const identifier = activeEntry.id.split(":").slice(1).join(":");
			return {
				...base,
				meta: [
					{ label: labels.detail.sourceLabel, value: groupLabel },
					{ label: labels.detail.insertLabel, value: `/${identifier}` },
				],
				hint: labels.detail.hintSkill,
				primaryLabel: labels.detail.insert,
				secondaryLabel: onOpenEntryInPlaza ? labels.detail.viewInPlaza : undefined,
			};
		}
		if (activeEntry.category === "connectors") {
			return {
				...base,
				meta: [{ label: labels.detail.statusLabel, value: labels.detail.statusConnected }],
				hint: labels.detail.hintConnector,
				primaryLabel: labels.detail.configure,
				secondaryLabel: labels.detail.disconnect,
			};
		}
		return {
			...base,
			meta: [{ label: labels.detail.statusLabel, value: labels.detail.statusEnabled }],
			hint: labels.detail.hintExtension,
			primaryLabel: labels.detail.disable,
			secondaryLabel: labels.detail.viewDetails,
		};
	}, [activeEntry, labels, onOpenEntryInPlaza, sections]);

	const keyBindings = useMemo((): ShortcutBinding[] => {
		return [
			{
				key: "arrowdown",
				run: () => {
					if (total === 0) return;
					setActiveIndex((index) => (index + 1) % total);
				},
			},
			{
				key: "arrowup",
				run: () => {
					if (total === 0) return;
					setActiveIndex((index) => (index - 1 + total) % total);
				},
			},
			{
				key: "tab",
				run: () => {
					const order: AddPanelTab[] = ["favorites", ...ADD_PANEL_CATEGORY_ORDER];
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
	}, [activeEntry, activateEntry, activeKey, handleSelectTab, onClose, selectCompaction, tab, total]);

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
			visibleKeys: visibleEntries.map((entry) => entry.key),
			activeKey,
			favorites: favorites.favorites,
			detail,
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
			onToggleFavorite: favorites.toggle,
			onOpenAbilityPlaza,
			onOpenEntryInPlaza: activeEntry && onOpenEntryInPlaza ? () => onOpenEntryInPlaza(activeEntry) : undefined,
		},
	};
}
