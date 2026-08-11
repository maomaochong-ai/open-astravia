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
	readonly itemCount: number;
	readonly unknownCount: number;
}

export interface ContextRingDetailGroup {
	readonly id: ContextRingDetailGroupKind;
	readonly title: string;
	readonly tokens: string;
	readonly share: string;
	readonly itemCount: number;
	readonly unknownCount: number;
	readonly sections: readonly ContextRingDetailSection[];
}

export interface ContextRingDetailsModel {
	readonly phase: ContextCompositionReport["phase"];
	readonly model: string;
	readonly actualTokens: string | null;
	readonly estimatedTokens: string;
	readonly coverage: string;
	readonly groups: readonly ContextRingDetailGroup[];
}

export interface ContextRingDetailLabels {
	readonly unknown: string;
	readonly coverage: Record<ContextCompositionReport["estimate"]["coverage"], string>;
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

const CAPABILITY_OWNERS = new Set<ContextSourceOwner>(["skill", "plugin", "mcp", "extension"]);

export function buildContextRingDetails(
	report: ContextCompositionReport | undefined,
	labels: ContextRingDetailLabels,
): ContextRingDetailsModel | null {
	if (!report) return null;
	const estimatedTotal = report.estimate.tokens;
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
			report.providerReportedInputTokens === undefined || report.providerReportedInputTokens === null
				? null
				: formatTokens(report.providerReportedInputTokens),
		estimatedTokens: formatSectionTokens(report.sections, labels.unknown),
		coverage: labels.coverage[report.estimate.coverage],
		groups: GROUP_ORDER.flatMap((group) => {
			const sections = sectionsByGroup.get(group);
			if (!sections || sections.length === 0) return [];
			return [buildGroup(group, sections, estimatedTotal, labels)];
		}),
	};
}

export function toggleExpandedContextGroup(
	current: ContextRingDetailGroupKind | null,
	selected: ContextRingDetailGroupKind,
): ContextRingDetailGroupKind | null {
	return current === selected ? null : selected;
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
	labels: ContextRingDetailLabels,
): ContextRingDetailGroup {
	return {
		id: group,
		title: labels.group[group],
		tokens: formatSectionTokens(sections, labels.unknown),
		share: formatSectionShare(sections, estimatedTotal, labels.unknown),
		itemCount: sections.length,
		unknownCount: countUnknownSections(sections),
		sections:
			group === "conversation"
				? buildConversationSections(sections, estimatedTotal, labels)
				: [...sections]
						.sort((left, right) => (right.estimatedTokens ?? -1) - (left.estimatedTokens ?? -1))
						.map((section) => buildDetailSection(section, estimatedTotal, labels)),
	};
}

function buildConversationSections(
	sections: readonly ContextSectionUsage[],
	estimatedTotal: number | null,
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
				tokens: formatSectionTokens(matching, labels.unknown),
				share: formatSectionShare(matching, estimatedTotal, labels.unknown),
				itemCount: matching.length,
				unknownCount: countUnknownSections(matching),
			},
		];
	});
}

function buildDetailSection(
	section: ContextSectionUsage,
	estimatedTotal: number | null,
	labels: ContextRingDetailLabels,
): ContextRingDetailSection {
	return {
		id: section.id,
		title: section.source.id,
		metadata: [labels.owner[section.source.owner], labels.kind[section.kind], section.category]
			.filter((value): value is string => Boolean(value))
			.join(" / "),
		tokens: formatSectionTokens([section], labels.unknown),
		share: formatSectionShare([section], estimatedTotal, labels.unknown),
		itemCount: 1,
		unknownCount: section.estimatedTokens === null ? 1 : 0,
	};
}

function formatSectionTokens(sections: readonly ContextSectionUsage[], unknown: string): string {
	const knownTokens = sections.reduce((sum, section) => sum + (section.estimatedTokens ?? 0), 0);
	const unknownCount = countUnknownSections(sections);
	if (unknownCount === 0) return formatTokens(knownTokens);
	return knownTokens > 0 ? `${formatTokens(knownTokens)}+` : unknown;
}

function formatSectionShare(
	sections: readonly ContextSectionUsage[],
	estimatedTotal: number | null,
	unknown: string,
): string {
	if (estimatedTotal === null || estimatedTotal <= 0 || countUnknownSections(sections) > 0) return unknown;
	const tokens = sections.reduce((sum, section) => sum + (section.estimatedTokens ?? 0), 0);
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
