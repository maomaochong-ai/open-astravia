import type { ContextCompositionReport, ContextSectionKind, ContextSourceOwner } from "@vetta/runtime-core";

export interface ContextRingDetailSection {
	readonly id: string;
	readonly title: string;
	readonly metadata: string;
	readonly tokens: string;
	readonly share: string;
}

export interface ContextRingDetailsModel {
	readonly phase: ContextCompositionReport["phase"];
	readonly model: string;
	readonly actualTokens: string | null;
	readonly estimatedTokens: string;
	readonly coverage: string;
	readonly sections: readonly ContextRingDetailSection[];
}

export interface ContextRingDetailLabels {
	readonly unknown: string;
	readonly coverage: Record<ContextCompositionReport["estimate"]["coverage"], string>;
	readonly owner: Record<ContextSourceOwner, string>;
	readonly kind: Record<ContextSectionKind, string>;
}

export function buildContextRingDetails(
	report: ContextCompositionReport | undefined,
	labels: ContextRingDetailLabels,
): ContextRingDetailsModel | null {
	if (!report) return null;
	const estimatedTotal = report.estimate.tokens;
	return {
		phase: report.phase,
		model: `${report.model.provider}/${report.model.modelId}`,
		actualTokens:
			report.providerReportedInputTokens === undefined || report.providerReportedInputTokens === null
				? null
				: formatTokens(report.providerReportedInputTokens),
		estimatedTokens: estimatedTotal === null ? labels.unknown : formatTokens(estimatedTotal),
		coverage: labels.coverage[report.estimate.coverage],
		sections: report.sections.map((section) => ({
			id: section.id,
			title: section.source.id,
			metadata: [labels.owner[section.source.owner], labels.kind[section.kind], section.category]
				.filter((value): value is string => Boolean(value))
				.join(" / "),
			tokens: section.estimatedTokens === null ? labels.unknown : formatTokens(section.estimatedTokens),
			share:
				estimatedTotal === null || estimatedTotal <= 0 || section.estimatedTokens === null
					? labels.unknown
					: `${((section.estimatedTokens / estimatedTotal) * 100).toFixed(1)}%`,
		})),
	};
}

export function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}
