import { pathBasename } from "@shared/lib/utils";
import { activeSessionAtom, filePreviewAtom } from "@shared/store/atoms";
import type { RequestHistoryItem, RequestHistorySubTabViewLabels } from "@vetta/theme-ui/activity";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RequestFileInfo } from "../../../../preload/api.js";

function formatTime(ts: number): string {
	try {
		const d = new Date(ts);
		return d.toLocaleTimeString("zh-CN", { hour12: false });
	} catch {
		return String(ts);
	}
}

function formatTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

export interface RequestHistorySubTabModel {
	hasSession: boolean;
	loading: boolean;
	files: RequestHistoryItem[];
	labels: RequestHistorySubTabViewLabels;
	onRefresh: () => void;
	onPreview: (file: RequestHistoryItem) => void;
	onShowInFolder: (path: string) => void;
}

export function useRequestHistorySubTabModel(cwd: string): RequestHistorySubTabModel {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const setPreview = useSetAtom(filePreviewAtom);
	const [rawFiles, setRawFiles] = useState<RequestFileInfo[]>([]);
	const [loading, setLoading] = useState(false);

	const projectName = pathBasename(cwd);
	const sessionId = activeSession?.runtimeId ?? null;

	const loadData = useCallback(async () => {
		if (!projectName || !sessionId) {
			setRawFiles([]);
			return;
		}
		setLoading(true);
		try {
			const data = await window.vetta.debug.listRequestFiles(projectName, sessionId);
			setRawFiles(data);
		} catch {
			setRawFiles([]);
		} finally {
			setLoading(false);
		}
	}, [projectName, sessionId]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const files = useMemo<RequestHistoryItem[]>(
		() =>
			rawFiles.map((file) => ({
				filename: file.filename,
				path: file.path,
				timeLabel: formatTime(file.timestamp),
				model: file.model,
				tokensLabel: `${formatTokens(file.inputTokens)}/${formatTokens(file.outputTokens)}`,
			})),
		[rawFiles],
	);

	const onPreview = useCallback(
		(file: RequestHistoryItem) => {
			setPreview({ name: file.filename, path: file.path });
		},
		[setPreview],
	);

	const onShowInFolder = useCallback((filePath: string) => {
		void window.vetta.shell.showItemInFolder(filePath);
	}, []);

	const labels = useMemo<RequestHistorySubTabViewLabels>(
		() => ({
			noSession: t("activityPanel.requestHistory.noSession"),
			loading: t("activityPanel.requestHistory.loading"),
			requestCount: t("activityPanel.requestHistory.requestCount", { count: files.length }),
			refresh: t("activityPanel.requestHistory.refresh"),
			empty: t("activityPanel.requestHistory.empty"),
			showInFolder: t("activityPanel.requestHistory.showInFolder"),
		}),
		[t, files.length],
	);

	return {
		hasSession: sessionId !== null,
		loading,
		files,
		labels,
		onRefresh: () => void loadData(),
		onPreview,
		onShowInFolder,
	};
}
