import {
	ExecutionHistoryView as ThemeExecutionHistoryView,
	type ExecutionHistoryViewLabels,
} from "@vetta/theme-ui/scheduler";
import { useTranslation } from "react-i18next";
import type { ExecutionHistoryRecordModel } from "../hooks/useExecutionHistoryModel";

export type { ExecutionHistoryStatus } from "@vetta/theme-ui/scheduler";

export interface ExecutionHistoryViewProps {
	readonly embedded?: boolean;
	readonly isLoading: boolean;
	readonly records: readonly ExecutionHistoryRecordModel[];
	readonly onOpenRecord: (record: ExecutionHistoryRecordModel["record"]) => void;
	readonly onRefresh: () => void;
}

export function ExecutionHistoryView({
	embedded = false,
	isLoading,
	records,
	onOpenRecord,
	onRefresh,
}: ExecutionHistoryViewProps): JSX.Element {
	const { t } = useTranslation("automation");
	const labels: ExecutionHistoryViewLabels = {
		empty: t("history.empty"),
		refresh: t("history.refresh"),
		title: t("history.title"),
	};

	const byId = new Map(records.map((r) => [r.id, r] as const));

	return (
		<ThemeExecutionHistoryView
			embedded={embedded}
			isLoading={isLoading}
			labels={labels}
			records={records.map((r) => ({
				durationLabel: r.durationLabel,
				error: r.error,
				hasSession: r.hasSession,
				id: r.id,
				preview: r.preview,
				startedAtLabel: r.startedAtLabel,
				status: r.status,
				statusLabel: r.statusLabel,
			}))}
			onOpenRecord={(id) => {
				const rec = byId.get(id);
				if (rec) onOpenRecord(rec.record);
			}}
			onRefresh={onRefresh}
		/>
	);
}
