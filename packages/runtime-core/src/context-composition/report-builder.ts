import type {
	BuildContextCompositionReportInput,
	ContextCompositionEstimate,
	ContextCompositionReport,
	ContextSectionUsage,
	TokenEstimator,
} from "./contracts.js";

export async function buildContextCompositionReport(
	input: BuildContextCompositionReportInput,
	estimator: TokenEstimator,
): Promise<ContextCompositionReport> {
	const sections = await Promise.all(
		input.sections.map(async (section): Promise<ContextSectionUsage> => {
			const characters = section.content === undefined ? undefined : Array.from(section.content).length;
			const estimate =
				section.content === undefined
					? { tokens: null, method: "unknown" as const }
					: await estimator.estimate({
							model: input.model,
							section: {
								id: section.id,
								kind: section.kind,
								category: section.category,
								source: section.source,
							},
							content: section.content,
						});
			return {
				id: section.id,
				kind: section.kind,
				category: section.category,
				source: section.source,
				estimatedTokens: estimate.tokens,
				estimateMethod: estimate.method,
				tokenizerId: estimate.tokenizerId,
				characters,
				percentOfWindow:
					estimate.tokens === null || input.model.contextWindow <= 0
						? null
						: (estimate.tokens / input.model.contextWindow) * 100,
			};
		}),
	);
	return {
		version: 1,
		callId: input.callId,
		snapshotId: input.snapshotId,
		phase: "prepared",
		createdAt: input.createdAt,
		model: input.model,
		estimate: summarizeEstimate(sections),
		sections,
	};
}

export function completeContextCompositionReport(
	prepared: ContextCompositionReport,
	providerReportedInputTokens: number | null,
): ContextCompositionReport {
	return { ...prepared, phase: "completed", providerReportedInputTokens };
}

function summarizeEstimate(sections: readonly ContextSectionUsage[]): ContextCompositionEstimate {
	const known = sections.flatMap((section) => (section.estimatedTokens === null ? [] : [section.estimatedTokens]));
	const knownTokens = known.reduce((sum, tokens) => sum + tokens, 0);
	if (known.length === 0) return { tokens: null, knownTokens: 0, coverage: "none" };
	if (known.length !== sections.length) return { tokens: null, knownTokens, coverage: "partial" };
	return { tokens: knownTokens, knownTokens, coverage: "complete" };
}
