import type {
	ContextCompositionReport,
	ContextSectionKind,
	ContextSectionUsage,
	ContextSourceOwner,
} from "@vetta/runtime-core";

export type ContextRingDetailGroupKind = "instructions" | "capabilities" | "tools" | "conversation" | "runtime";

export interface ContextRingDetailSection {
	readonly id: string;
	readonly title: string;
	readonly metadata: string;
	readonly tokens: string;
	readonly share: string;
	readonly tokenCount: number;
	readonly itemCount: number;
	readonly unknownCount: number;
}

export interface ContextRingDetailGroup {
	readonly id: ContextRingDetailGroupKind;
	readonly title: string;
	readonly tokens: string;
	readonly share: string;
	readonly tokenCount: number;
	readonly itemCount: number;
	readonly unknownCount: number;
	readonly sections: readonly ContextRingDetailSection[];
}

export interface ContextRingBarSegment {
	readonly id: ContextRingDetailGroupKind;
	readonly percent: number;
}

export interface ContextRingDetailsModel {
	readonly phase: ContextCompositionReport["phase"];
	readonly model: string;
	readonly actualTokens: string | null;
	readonly windowLabel: string;
	readonly groups: readonly ContextRingDetailGroup[];
}

export interface ContextRingDetailLabels {
	readonly unknown: string;
	readonly owner: Record<ContextSourceOwner, string>;
	readonly kind: Record<ContextSectionKind, string>;
	readonly group: Record<ContextRingDetailGroupKind, string>;
}

const GROUP_ORDER: readonly ContextRingDetailGroupKind[] = [
	"instructions",
	"capabilities",
	"tools",
	"conversation",
	"runtime",
];

const CAPABILITY_OWNERS = new Set<ContextSourceOwner>(["extension"]);

export function buildContextRingDetails(
	report: ContextCompositionReport | undefined,
	labels: ContextRingDetailLabels,
): ContextRingDetailsModel | null {
	if (!report) return null;
	const estimatedTotal = report.estimate.tokens;
	const tokenCalibrationScale = resolveTokenCalibrationScale(report);
	const sectionsByGroup = new Map<ContextRingDetailGroupKind, ContextSectionUsage[]>();
	for (const section of report.sections) {
		const group = classifySection(section);
		const sections = sectionsByGroup.get(group) ?? [];
		sections.push(section);
		sectionsByGroup.set(group, sections);
	}

	return {
		phase: report.phase,
		model: `${report.model.provider}/${report.model.modelId}`,
		actualTokens:
			report.providerReportedInputTokens === null || report.providerReportedInputTokens === undefined
				? null
				: formatTokens(report.providerReportedInputTokens),
		windowLabel: report.model.contextWindow > 0 ? formatTokens(report.model.contextWindow) : labels.unknown,
		groups: GROUP_ORDER.flatMap((group) => {
			const sections = sectionsByGroup.get(group);
			if (!sections || sections.length === 0) return [];
			return [buildGroup(group, sections, estimatedTotal, tokenCalibrationScale, labels)];
		}),
	};
}

/**
 * 堆叠条只表达最近一次调用的估算构成，各环节按估算总量归一化到 100%。
 * 非空环节保留一个可点击的最小宽度，避免它在条上完全消失；
 * 若最小宽度导致总和超出 100%，则整体等比缩回。
 */
export function buildContextRingBarSegments(
	groups: readonly ContextRingDetailGroup[],
	minPercent = 1.5,
): ContextRingBarSegment[] {
	if (groups.length === 0) return [];
	const total = groups.reduce((sum, group) => sum + group.tokenCount, 0);
	const segments = groups.map((group) => {
		const percent = total > 0 ? (group.tokenCount / total) * 100 : 100 / groups.length;
		return { id: group.id, percent: percent > 0 ? Math.max(percent, minPercent) : percent };
	});
	const used = segments.reduce((sum, segment) => sum + segment.percent, 0);
	if (used <= 100) return segments;
	return segments.map((segment) => ({ ...segment, percent: (segment.percent / used) * 100 }));
}

function classifySection(section: ContextSectionUsage): ContextRingDetailGroupKind {
	switch (section.kind) {
		case "instruction":
			return CAPABILITY_OWNERS.has(section.source.owner) ? "capabilities" : "instructions";
		case "tool_schema":
			return "tools";
		case "history":
		case "user_input":
			return "conversation";
		case "runtime_context":
			return "runtime";
	}
}

function buildGroup(
	group: ContextRingDetailGroupKind,
	sections: readonly ContextSectionUsage[],
	estimatedTotal: number | null,
	tokenCalibrationScale: number | undefined,
	labels: ContextRingDetailLabels,
): ContextRingDetailGroup {
	return {
		id: group,
		title: labels.group[group],
		tokens: formatSectionTokens(sections, tokenCalibrationScale, labels.unknown),
		share: formatSectionShare(sections, estimatedTotal, labels.unknown),
		tokenCount: sumKnownTokens(sections),
		itemCount: sections.length,
		unknownCount: countUnknownSections(sections),
		sections:
			group === "conversation"
				? buildConversationSections(sections, estimatedTotal, tokenCalibrationScale, labels)
				: [...sections]
						.sort((left, right) => (right.estimatedTokens ?? -1) - (left.estimatedTokens ?? -1))
						.map((section) => buildDetailSection(section, estimatedTotal, tokenCalibrationScale, labels)),
	};
}

function buildConversationSections(
	sections: readonly ContextSectionUsage[],
	estimatedTotal: number | null,
	tokenCalibrationScale: number | undefined,
	labels: ContextRingDetailLabels,
): ContextRingDetailSection[] {
	return (["history", "user_input"] as const).flatMap((kind) => {
		const matching = sections.filter((section) => section.kind === kind);
		if (matching.length === 0) return [];
		return [
			{
				id: `conversation:${kind}`,
				title: labels.kind[kind],
				metadata: "",
				tokens: formatSectionTokens(matching, tokenCalibrationScale, labels.unknown),
				share: formatSectionShare(matching, estimatedTotal, labels.unknown),
				tokenCount: sumKnownTokens(matching),
				itemCount: matching.length,
				unknownCount: countUnknownSections(matching),
			},
		];
	});
}

function buildDetailSection(
	section: ContextSectionUsage,
	estimatedTotal: number | null,
	tokenCalibrationScale: number | undefined,
	labels: ContextRingDetailLabels,
): ContextRingDetailSection {
	return {
		id: section.id,
		title: section.source.id,
		metadata: [labels.owner[section.source.owner], labels.kind[section.kind], section.category]
			.filter((value): value is string => Boolean(value))
			.join(" / "),
		tokens: formatSectionTokens([section], tokenCalibrationScale, labels.unknown),
		share: formatSectionShare([section], estimatedTotal, labels.unknown),
		tokenCount: section.estimatedTokens ?? 0,
		itemCount: 1,
		unknownCount: section.estimatedTokens === null ? 1 : 0,
	};
}

function sumKnownTokens(sections: readonly ContextSectionUsage[]): number {
	return sections.reduce((sum, section) => sum + (section.estimatedTokens ?? 0), 0);
}

function resolveTokenCalibrationScale(report: ContextCompositionReport): number | undefined {
	const actual = report.providerReportedInputTokens;
	const estimated = report.estimate.tokens;
	if (
		report.phase !== "completed" ||
		typeof actual !== "number" ||
		!Number.isFinite(actual) ||
		actual < 0 ||
		typeof estimated !== "number" ||
		!Number.isFinite(estimated) ||
		estimated <= 0
	) {
		return undefined;
	}
	return actual / estimated;
}

function formatSectionTokens(
	sections: readonly ContextSectionUsage[],
	tokenCalibrationScale: number | undefined,
	unknown: string,
): string {
	const knownTokens = sumKnownTokens(sections);
	const unknownCount = countUnknownSections(sections);
	if (knownTokens === 0 && unknownCount > 0) return unknown;
	const calibratedTokens = knownTokens * (tokenCalibrationScale ?? 1);
	return `${formatTokens(Math.round(calibratedTokens))}${unknownCount > 0 ? "+" : ""}`;
}

function formatSectionShare(
	sections: readonly ContextSectionUsage[],
	estimatedTotal: number | null,
	unknown: string,
): string {
	if (estimatedTotal === null || estimatedTotal <= 0 || countUnknownSections(sections) > 0) return unknown;
	const tokens = sumKnownTokens(sections);
	return `${((tokens / estimatedTotal) * 100).toFixed(1)}%`;
}

function countUnknownSections(sections: readonly ContextSectionUsage[]): number {
	return sections.filter((section) => section.estimatedTokens === null).length;
}

export function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}
