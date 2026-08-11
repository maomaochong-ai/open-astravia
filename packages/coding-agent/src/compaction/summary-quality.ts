export interface CompactionSummaryQualityInput {
	readonly summary: string;
	readonly sourceCharacterCount: number;
}

export function isDegradedCompactionSummary(input: CompactionSummaryQualityInput): boolean {
	const summary = input.summary.trim();
	if (summary.length < 20) return true;
	if (!/[\p{L}\p{N}]/u.test(summary)) return true;
	if (
		/^(?:i\s+(?:am\s+)?sorry|sorry|unable to|i cannot|i can't|as an ai|error[:\s]|summarization failed)/i.test(
			summary,
		)
	) {
		return true;
	}
	if (/<analysis>[\s\S]*<\/analysis>/i.test(summary) && !/<summary>[\s\S]+<\/summary>/i.test(summary)) {
		return true;
	}
	return input.sourceCharacterCount >= 2_000 && summary.length < 80;
}
