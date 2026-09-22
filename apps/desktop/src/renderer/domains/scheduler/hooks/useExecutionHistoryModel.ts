import type { TaskExecutionRecord } from "@shared/store/atoms";
import { openSessionFnRef, scheduledRecordsVersionAtom } from "@shared/store/atoms";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ExecutionHistoryRecordModel {
	readonly durationLabel: string | null;
	readonly error: string | undefined;
	readonly id: string;
	readonly hasSession: boolean;
	readonly preview: string;
	readonly startedAtLabel: string;
	readonly status: TaskExecutionRecord["status"];
	readonly statusLabel: string;
	readonly record: TaskExecutionRecord;
}

export interface ExecutionHistoryModel {
	readonly isLoading: boolean;
	readonly records: readonly ExecutionHistoryRecordModel[];
	readonly onOpenRecord: (record: TaskExecutionRecord) => void;
	readonly onRefresh: () => void;
}

export function useExecutionHistoryModel(taskId: string): ExecutionHistoryModel {
	const { t, i18n } = useTranslation("automation");
	const locale = i18n.language === "en" ? "en-US" : "zh-CN";
	const [records, setRecords] = useState<TaskExecutionRecord[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const recordsVersion = useAtomValue(scheduledRecordsVersionAtom);

	const loadRecords = useCallback(async (): Promise<void> => {
		setIsLoading(true);
		try {
			const loaded = await window.vetta.scheduler.getRecords(taskId);
			setRecords(loaded);
		} finally {
			setIsLoading(false);
		}
	}, [taskId]);

	useEffect(() => {
		void recordsVersion;
		void loadRecords();
	}, [loadRecords, recordsVersion]);

	useEffect(() => {
		return window.vetta.scheduler.onTaskEvent((event) => {
			if ((event.type === "task.started" || event.type === "record.updated") && event.taskId === taskId) {
				void loadRecords();
			}
		});
	}, [loadRecords, taskId]);

	return useMemo(
		() => ({
			isLoading,
			records: records.map((record) => ({
				durationLabel:
					record.durationMs != null && record.durationMs > 0 ? formatDuration(record.durationMs) : null,
				error: record.error,
				hasSession: Boolean(record.sessionPath),
				id: record.id,
				preview: recordPreview(record, t, locale),
				record,
				startedAtLabel: formatTime(record.startedAt, locale),
				status: record.status,
				statusLabel: t(`history.status.${record.status}`),
			})),
			onOpenRecord: (record: TaskExecutionRecord): void => {
				if (record.sessionPath && record.cwd && openSessionFnRef.current) {
					void openSessionFnRef.current(record.cwd, record.sessionPath);
				}
			},
			onRefresh: (): void => {
				void loadRecords();
			},
		}),
		[isLoading, loadRecords, locale, records, t],
	);
}

function formatTime(timestamp: number, locale: string): string {
	return new Date(timestamp).toLocaleString(locale, {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

/** 未执行的记录说明原因；执行过的优先展示错误，其次回复摘要，并附上通知失败。 */
function recordPreview(record: TaskExecutionRecord, t: TFunction<"automation">, locale: string): string {
	if (record.status === "skipped" || record.status === "missed") {
		const reason = record.reason ? t(`history.reason.${record.reason}`) : "";
		if ((record.missedCount ?? 1) > 1 && record.missedUntil) {
			return t("history.missedMany", {
				times: record.missedCount,
				until: formatTime(record.missedUntil, locale),
				reason,
			});
		}
		return reason;
	}
	const body = record.error || record.responsePreview;
	return record.notifyError
		? `${body}${body ? " · " : ""}${t("history.notifyFailed", { error: record.notifyError })}`
		: body;
}
