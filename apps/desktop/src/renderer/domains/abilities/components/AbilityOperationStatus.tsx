import { cn } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import type { AbilityOperation, AbilityOperationProgress } from "../types";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	for (const unit of units) {
		if (value < 1024 || unit === units[units.length - 1]) return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
		value /= 1024;
	}
	return `${bytes} B`;
}

/** 列表与详情共用的异步操作反馈；文字同时作为 live region 与按钮可访问名称。 */
export function AbilityOperationStatus({
	operation,
	progress,
	className,
	iconClassName,
}: {
	operation?: AbilityOperation;
	progress?: AbilityOperationProgress;
	className?: string;
	iconClassName?: string;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const progressLabel = progress ? t(`operation.${progress.phase}Runtime`) : undefined;
	const percent =
		progress?.phase === "downloading" &&
		progress.totalBytes !== undefined &&
		progress.totalBytes > 0 &&
		progress.downloadedBytes !== undefined
			? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
			: undefined;
	const progressDetail = progress
		? [
				percent === undefined ? undefined : `${percent}%`,
				progress.downloadedBytes === undefined
					? undefined
					: `${formatBytes(progress.downloadedBytes)}${progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""}`,
			].filter(Boolean).join(" · ")
		: "";
	return (
		<span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5", className)}>
			<span
				aria-hidden="true"
				className={cn("icon-[solar--refresh-linear] h-3.5 w-3.5 animate-spin", iconClassName)}
			/>
			{progressLabel ?? (operation ? t(`operation.${operation}`) : t("operation.processing"))}
			{progressDetail ? ` · ${progressDetail}` : ""}
		</span>
	);
}
