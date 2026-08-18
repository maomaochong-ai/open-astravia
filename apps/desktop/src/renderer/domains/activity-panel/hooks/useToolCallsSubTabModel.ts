import { activeSessionAtom, debugToolFilterAtom, debugToolSearchAtom } from "@shared/store/atoms";
import type {
	ToolCallFilterOption,
	ToolCallFilterValue,
	ToolCallsSubTabViewLabels,
	ToolCallViewItem,
} from "@vetta/theme-ui/activity";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCallRecord } from "../../../../preload/api.js";

function formatTime(timestamp: string): string {
	try {
		const d = new Date(timestamp);
		return d.toLocaleTimeString("zh-CN", { hour12: false });
	} catch {
		return timestamp;
	}
}

function formatResult(result: unknown): string {
	return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

export interface ToolCallsSubTabModel {
	hasSession: boolean;
	search: string;
	filter: ToolCallFilterValue;
	filterOptions: ToolCallFilterOption[];
	loading: boolean;
	hasAnyRecords: boolean;
	items: ToolCallViewItem[];
	expandedId: string | null;
	labels: ToolCallsSubTabViewLabels;
	onSearchChange: (value: string) => void;
	onFilterChange: (value: ToolCallFilterValue) => void;
	onToggleExpand: (id: string) => void;
	onRefresh: () => void;
}

export function useToolCallsSubTabModel(): ToolCallsSubTabModel {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const [search, setSearch] = useAtom(debugToolSearchAtom);
	const [filter, setFilter] = useAtom(debugToolFilterAtom);
	const [records, setRecords] = useState<ToolCallRecord[]>([]);
	const [loading, setLoading] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const sessionPath = activeSession?.sessionPath ?? null;

	const loadData = useCallback(async () => {
		if (!sessionPath) {
			setRecords([]);
			return;
		}
		setLoading(true);
		try {
			const data = await window.vetta.debug.parseToolCalls(sessionPath);
			setRecords(data);
		} catch {
			setRecords([]);
		} finally {
			setLoading(false);
		}
	}, [sessionPath]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const filtered = useMemo(() => {
		let list = records;
		if (filter === "success") list = list.filter((r) => !r.isError);
		if (filter === "error") list = list.filter((r) => r.isError);
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter((r) => r.toolName.toLowerCase().includes(q));
		}
		return list;
	}, [records, filter, search]);

	const items = useMemo<ToolCallViewItem[]>(
		() =>
			filtered.map((record) => ({
				id: record.id,
				toolName: record.toolName,
				timeLabel: formatTime(record.timestamp),
				isError: record.isError,
				hasResult: record.result !== undefined,
				argsText: JSON.stringify(record.args, null, 2),
				resultText: record.result !== undefined ? formatResult(record.result) : null,
			})),
		[filtered],
	);

	const onToggleExpand = useCallback((id: string) => {
		setExpandedId((prev) => (prev === id ? null : id));
	}, []);

	const filterOptions = useMemo<ToolCallFilterOption[]>(
		() => [
			{ value: "all", label: t("activityPanel.toolCalls.filterAll") },
			{ value: "success", label: t("activityPanel.toolCalls.filterSuccess") },
			{ value: "error", label: t("activityPanel.toolCalls.filterError") },
		],
		[t],
	);

	const labels = useMemo<ToolCallsSubTabViewLabels>(
		() => ({
			noSession: t("activityPanel.toolCalls.noSession"),
			searchPlaceholder: t("activityPanel.toolCalls.searchPlaceholder"),
			statusText: loading
				? t("activityPanel.toolCalls.loading")
				: t("activityPanel.toolCalls.recordCount", { count: filtered.length }),
			refresh: t("activityPanel.toolCalls.refresh"),
			empty: t("activityPanel.toolCalls.empty"),
			noMatch: t("activityPanel.toolCalls.noMatch"),
			args: t("activityPanel.toolCalls.args"),
			result: t("activityPanel.toolCalls.result"),
		}),
		[t, loading, filtered.length],
	);

	const onFilterChange = useCallback(
		(value: ToolCallFilterValue) => {
			setFilter(value);
		},
		[setFilter],
	);

	return {
		hasSession: sessionPath !== null,
		search,
		filter,
		filterOptions,
		loading,
		hasAnyRecords: records.length > 0,
		items,
		expandedId,
		labels,
		onSearchChange: setSearch,
		onFilterChange,
		onToggleExpand,
		onRefresh: () => void loadData(),
	};
}
