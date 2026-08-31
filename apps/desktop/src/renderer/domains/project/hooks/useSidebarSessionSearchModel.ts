import { pathBasename } from "@shared/lib/utils";
import type { SessionExecutionMode } from "@shared/store/atoms";
import { pinnedSessionPathsAtom, sessionDisplayLabel, setSessionPinnedAtom } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import type {
	SidebarSessionSearchViewActiveFilter,
	SidebarSessionSearchViewFilterOption,
	SidebarSessionSearchViewItem,
	SidebarSessionSearchViewLabels,
} from "@vetta/theme-ui/project";
import type { TFunction } from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { resolveDesktopSessionOpenTarget } from "@/shared/session-access";
import type { DesktopSessionSearchResult } from "@/shared/session-search";
import { findSearchTextRanges } from "@/shared/session-search-text";
import { useSessionSearch } from "./useSessionSearch";
import { useSessionSearchTimeFilter } from "./useSessionSearchTimeFilter";

interface UseSidebarSessionSearchModelArgs {
	t: TFunction<"project">;
	locale: string;
	onOpenSession: (cwd: string, sessionPath?: string, executionMode?: SessionExecutionMode) => Promise<void>;
}

export function useSidebarSessionSearchModel({ onOpenSession, t, locale }: UseSidebarSessionSearchModelArgs) {
	const navigate = useNavigate();
	const pinnedSessionPaths = useAtomValue(pinnedSessionPathsAtom);
	const setPinned = useSetAtom(setSessionPinnedAtom);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [selectedType, setSelectedType] = useState("all");
	const [selectedProject, setSelectedProject] = useState("all");
	const [filtersExpanded, setFiltersExpanded] = useState(false);
	const timeFilter = useSessionSearchTimeFilter(t, locale);
	const { reset: resetTimeFilter } = timeFilter;
	const timeFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			}),
		[locale],
	);
	const toggleFilters = useCallback(() => setFiltersExpanded((expanded) => !expanded), []);
	const resetFilters = useCallback(() => {
		setSelectedType("all");
		setSelectedProject("all");
		resetTimeFilter();
	}, [resetTimeFilter]);
	const sourceKind =
		selectedType === "conversation" ||
		selectedType === "claw" ||
		selectedType === "project" ||
		selectedType === "batch"
			? selectedType
			: undefined;
	const { results, sources, loading, error, limited, skipped } = useSessionSearch(open && !timeFilter.range.error, {
		query,
		sourceKind,
		projectCwd: selectedProject === "all" ? undefined : selectedProject,
		modifiedFrom: timeFilter.range.modifiedFrom,
		modifiedBefore: timeFilter.range.modifiedBefore,
	});
	const [openError, setOpenError] = useState(false);
	const close = useCallback(() => {
		setOpen(false);
		setQuery("");
		resetFilters();
		setFiltersExpanded(false);
		setOpenError(false);
	}, [resetFilters]);
	const openSearch = useCallback(() => setOpen(true), []);
	const openResult = useCallback(
		(result: DesktopSessionSearchResult) => {
			void (async () => {
				const target = resolveDesktopSessionOpenTarget(result.session.access);
				try {
					if (target === "viewer") {
						await navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(result.session.path) } });
					} else if (target === "interactive") {
						const cwd = result.sourceKind === "batch" ? result.session.cwd : result.sourceCwd;
						await onOpenSession(cwd, result.session.path, result.executionMode);
					} else {
						setOpenError(true);
						return;
					}
					close();
				} catch {
					setOpenError(true);
				}
			})();
		},
		[close, navigate, onOpenSession],
	);

	const typeOptions = useMemo<SidebarSessionSearchViewFilterOption[]>(
		() => [
			{ key: "all", label: t("sidebar.search.allTypes") },
			{ key: "conversation", label: t("filterTabs.conversation") },
			{ key: "claw", label: t("filterTabs.claw") },
			{ key: "project", label: t("sidebar.search.projectType") },
			{ key: "batch", label: t("filterTabs.batch") },
		],
		[t],
	);
	const projectOptions = useMemo<SidebarSessionSearchViewFilterOption[]>(() => {
		const options = new Map<string, string>([["all", t("sidebar.search.allProjects")]]);
		for (const source of sources) {
			if (source.kind === "project" || source.kind === "batch") {
				options.set(source.cwd, source.name?.trim() || pathBasename(source.cwd));
			}
		}
		return Array.from(options, ([key, label]) => ({ key, label }));
	}, [sources, t]);
	const activeFilters = useMemo<SidebarSessionSearchViewActiveFilter[]>(() => {
		const filters: SidebarSessionSearchViewActiveFilter[] = [];
		if (selectedType !== "all") {
			const label = typeOptions.find((option) => option.key === selectedType)?.label ?? selectedType;
			filters.push({
				key: "type",
				label,
				removeLabel: t("sidebar.search.removeFilter", { filter: t("sidebar.search.type"), value: label }),
				onRemove: () => setSelectedType("all"),
			});
		}
		if (selectedProject !== "all") {
			const label =
				projectOptions.find((option) => option.key === selectedProject)?.label ?? pathBasename(selectedProject);
			filters.push({
				key: "project",
				label,
				removeLabel: t("sidebar.search.removeFilter", { filter: t("sidebar.search.project"), value: label }),
				onRemove: () => setSelectedProject("all"),
			});
		}
		if (timeFilter.active) {
			filters.push({
				key: "time",
				label: timeFilter.activeLabel,
				removeLabel: t("sidebar.search.removeFilter", {
					filter: t("sidebar.search.time"),
					value: timeFilter.activeLabel,
				}),
				onRemove: resetTimeFilter,
			});
		}
		return filters;
	}, [
		selectedType,
		selectedProject,
		typeOptions,
		projectOptions,
		t,
		timeFilter.active,
		timeFilter.activeLabel,
		resetTimeFilter,
	]);
	const items = useMemo<SidebarSessionSearchViewItem[]>(
		() =>
			results.map((result) => {
				const pinned = pinnedSessionPaths.has(result.session.path);
				const title = sessionDisplayLabel(result.session);
				const date = new Date(result.session.modifiedAt);
				const validDate = Number.isFinite(date.getTime());
				const timeLabel = validDate ? timeFormatter.format(date) : t("sidebar.search.unknownTime");
				return {
					key: result.session.path,
					title,
					timeLabel,
					timeTitle: t("sidebar.search.lastActive", { time: timeLabel }),
					timeDateTime: validDate ? date.toISOString() : undefined,
					titleHighlights: findSearchTextRanges(title, query),
					sourceLabel:
						result.sourceKind === "project" || result.sourceKind === "batch"
							? result.sourceName?.trim() || pathBasename(result.sourceCwd)
							: (typeOptions.find((option) => option.key === result.sourceKind)?.label ?? ""),
					snippet: result.match.snippet,
					snippetHighlights: findSearchTextRanges(result.match.snippet, query),
					pinned,
					onOpen: () => openResult(result),
					onTogglePin: () => setPinned({ path: result.session.path, pinned: !pinned }),
				};
			}),
		[results, openResult, pinnedSessionPaths, setPinned, typeOptions, query, timeFormatter, t],
	);

	const labels = useMemo<SidebarSessionSearchViewLabels>(
		() => ({
			clear: t("sidebar.search.clear"),
			title: t("sidebar.search.open"),
			close: t("sidebar.search.close"),
			subtitle: t("sidebar.search.subtitle"),
			status: limited
				? t("sidebar.search.limited", { count: results.length })
				: t("sidebar.search.count", { count: results.length }),
			partial: skipped > 0 ? t("sidebar.search.partial") : "",
			emptyQuery: t("sidebar.search.emptyQuery"),
			error: openError ? t("sidebar.search.openError") : t("sidebar.search.error"),
			loading: t("sidebar.search.loading"),
			loadingDescription: t("sidebar.search.loadingDescription"),
			loadingMore: t("sidebar.search.loadingMore"),
			noResults: t("sidebar.search.noResults"),
			pin: t("contextMenu.pin"),
			placeholder: t("sidebar.search.placeholder"),
			project: t("sidebar.search.project"),
			type: t("sidebar.search.type"),
			unpin: t("contextMenu.unpin"),
			filters: t("sidebar.search.filters"),
			filtersActive: t("sidebar.search.filtersActive", { count: activeFilters.length }),
			resetFilters: t("sidebar.search.resetFilters"),
			time: t("sidebar.search.time"),
			startDate: t("sidebar.search.startDate"),
			endDate: t("sidebar.search.endDate"),
			timeHint: t("sidebar.search.timeHint"),
			newestFirst: t("sidebar.search.newestFirst"),
			invalidFilters: t("sidebar.search.invalidFilters"),
		}),
		[t, results.length, limited, skipped, openError, activeFilters.length],
	);

	return {
		timeFilter: timeFilter.view,
		activeFilters,
		filtersExpanded,
		toggleFilters,
		resetFilters,
		close,
		openSearch,
		error: error || openError,
		items,
		labels,
		loading,
		open,
		projectOptions,
		query,
		selectedProject,
		selectedType,
		setSelectedProject,
		setSelectedType,
		typeOptions,
		setQuery,
		triggerLabel: open ? t("sidebar.search.close") : t("sidebar.search.open"),
	};
}
