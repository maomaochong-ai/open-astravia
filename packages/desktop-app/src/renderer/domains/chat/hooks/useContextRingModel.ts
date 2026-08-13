import { contextUsageAtom, isCompactingAtom } from "@shared/store/atoms";
import { CONTEXT_RING_CIRCUMFERENCE } from "@vetta/theme-ui/chat";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { buildContextRingDetails, type ContextRingDetailsModel, formatTokens } from "../services/context-ring-details";

export interface ContextRingModel {
	percent: number;
	offset: number;
	color: string;
	isCompacting: boolean;
	tooltip: string;
	details: ContextRingDetailsModel | null;
}

export function useContextRingModel(includeDetails = true): ContextRingModel | null {
	const { t } = useTranslation("chat");
	const ctx = useAtomValue(contextUsageAtom);
	const isCompacting = useAtomValue(isCompactingAtom);
	const composition = ctx?.composition;

	const detailLabels = useMemo(
		() =>
			includeDetails
				? ({
						unknown: t("contextRing.details.unknown"),
						coverage: {
							complete: t("contextRing.details.coverage.complete"),
							partial: t("contextRing.details.coverage.partial"),
							none: t("contextRing.details.coverage.none"),
						},
						owner: {
							core: t("contextRing.details.owner.core"),
							skill: t("contextRing.details.owner.skill"),
							plugin: t("contextRing.details.owner.plugin"),
							mcp: t("contextRing.details.owner.mcp"),
							extension: t("contextRing.details.owner.extension"),
							runtime: t("contextRing.details.owner.runtime"),
							user: t("contextRing.details.owner.user"),
							unknown: t("contextRing.details.owner.unknown"),
						},
						kind: {
							instruction: t("contextRing.details.kind.instruction"),
							tool_schema: t("contextRing.details.kind.tool_schema"),
							history: t("contextRing.details.kind.history"),
							runtime_context: t("contextRing.details.kind.runtime_context"),
							user_input: t("contextRing.details.kind.user_input"),
						},
						group: {
							instructions: t("contextRing.details.group.instructions"),
							capabilities: t("contextRing.details.group.capabilities"),
							tools: t("contextRing.details.group.tools"),
							conversation: t("contextRing.details.group.conversation"),
							runtime: t("contextRing.details.group.runtime"),
						},
					} as const)
				: null,
		[includeDetails, t],
	);
	const details = useMemo(
		() => (detailLabels ? buildContextRingDetails(composition, detailLabels) : null),
		[composition, detailLabels],
	);

	if (!ctx || !ctx.contextWindow) return null;

	const percent = ctx.percent ?? 0;
	const clamped = Math.min(100, Math.max(0, percent));
	const offset = CONTEXT_RING_CIRCUMFERENCE - (clamped / 100) * CONTEXT_RING_CIRCUMFERENCE;

	const color = percent > 90 ? "var(--destructive)" : "var(--primary)";

	const tooltip = isCompacting
		? t("contextRing.tooltip.compacting")
		: ctx.percent !== null
			? t("contextRing.tooltip.usage", { percent: percent.toFixed(1), window: formatTokens(ctx.contextWindow) })
			: t("contextRing.tooltip.unknown", { window: formatTokens(ctx.contextWindow) });

	return {
		percent,
		offset,
		color,
		isCompacting,
		tooltip,
		details,
	};
}
