import { lastTurnUsageAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const m = Math.floor(seconds / 60);
	const s = Math.round(seconds % 60);
	return `${m}m${s}s`;
}

export interface UsageBarModel {
	text: string;
}

export function useUsageBarModel(): UsageBarModel | null {
	const { t } = useTranslation("chat");
	const turnUsage = useAtomValue(lastTurnUsageAtom);

	if (!turnUsage || (!turnUsage.outputSpeed && !turnUsage.durationSeconds)) return null;

	const parts: string[] = [];
	if (turnUsage.outputSpeed > 0) {
		parts.push(t("usageBar.speedLabel", { speed: turnUsage.outputSpeed.toFixed(1) }));
	}
	if (turnUsage.durationSeconds > 0) {
		parts.push(t("usageBar.durationLabel", { duration: formatDuration(turnUsage.durationSeconds) }));
	}

	if (parts.length === 0) return null;

	return { text: parts.join("  ·  ") };
}
