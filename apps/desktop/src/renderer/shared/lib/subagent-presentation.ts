import type { SubagentTask } from "@shared/store/atoms";
import type { TFunction } from "i18next";

export interface SubagentErrorPresentation {
	readonly label: string;
	readonly detail: string;
}

export function subagentObjective(task: string): string {
	const match = task.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/u);
	return (match?.[1] ?? task).trim();
}

export function subagentUsageLabel(usage: SubagentTask["usage"], t: TFunction<"chat">): string {
	if (!usage) return "";
	const tokens = usage.input + usage.output;
	if (tokens === 0 && usage.costTotal === 0) return "";
	return t("activityPanel.subagents.usage", {
		tokens: compactNumber(tokens),
		cost: usage.costTotal.toLocaleString(undefined, {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: usage.costTotal < 0.01 ? 3 : 2,
			maximumFractionDigits: usage.costTotal < 0.01 ? 3 : 2,
		}),
	});
}

export function subagentErrorPresentation(
	errorMessage: string | undefined,
	t: TFunction<"chat">,
): SubagentErrorPresentation | undefined {
	if (!errorMessage?.trim()) return undefined;
	const normalized = errorMessage.toLowerCase();
	const label = normalized.match(/permission|denied|unauthorized|forbidden/u)
		? t("activityPanel.subagents.errorPermission")
		: normalized.match(/context|token|maximum length|too long/u)
			? t("activityPanel.subagents.errorContext")
			: normalized.match(/network|timeout|timed out|connection|unavailable/u)
				? t("activityPanel.subagents.errorConnection")
				: t("activityPanel.subagents.errorExecution");
	return { label, detail: clipText(errorMessage.trim(), 360) };
}

function compactNumber(value: number): string {
	return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function clipText(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
