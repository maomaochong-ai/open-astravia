import type { SerializedMemberMention } from "@shared/lib/input-tokens";

export interface TeamDraftMemberMentions {
	readonly sourceText: string;
	readonly mentions: readonly SerializedMemberMention[];
}

function isValidMention(text: string, mention: SerializedMemberMention): boolean {
	return (
		mention.start >= 0 &&
		mention.end > mention.start &&
		mention.end <= text.length &&
		text.slice(mention.start, mention.end) === `@${mention.handle}` &&
		(mention.start === 0 || /\s/u.test(text[mention.start - 1] ?? "")) &&
		(mention.end === text.length || /\s/u.test(text[mention.end] ?? ""))
	);
}

/**
 * Carries structural member annotations across one text edit. Mentions wholly
 * outside the changed range keep their identity; editing through a mention
 * deliberately degrades it to ordinary visible text.
 */
export function rebaseTeamDraftMemberMentions(
	sourceText: string,
	nextText: string,
	mentions: readonly SerializedMemberMention[],
): readonly SerializedMemberMention[] {
	const validMentions = mentions.filter((mention) => isValidMention(sourceText, mention));
	if (sourceText === nextText) return validMentions;

	let prefixLength = 0;
	const prefixLimit = Math.min(sourceText.length, nextText.length);
	while (prefixLength < prefixLimit && sourceText[prefixLength] === nextText[prefixLength]) {
		prefixLength += 1;
	}

	let sourceSuffixStart = sourceText.length;
	let nextSuffixStart = nextText.length;
	while (
		sourceSuffixStart > prefixLength &&
		nextSuffixStart > prefixLength &&
		sourceText[sourceSuffixStart - 1] === nextText[nextSuffixStart - 1]
	) {
		sourceSuffixStart -= 1;
		nextSuffixStart -= 1;
	}

	const offsetDelta = nextSuffixStart - sourceSuffixStart;
	return validMentions.flatMap((mention) => {
		const rebased =
			mention.end <= prefixLength
				? mention
				: mention.start >= sourceSuffixStart
					? { ...mention, start: mention.start + offsetDelta, end: mention.end + offsetDelta }
					: null;
		return rebased && isValidMention(nextText, rebased) ? [rebased] : [];
	});
}

export function rebaseTeamDraftMentionRecord(
	record: TeamDraftMemberMentions,
	nextText: string,
): TeamDraftMemberMentions {
	return {
		sourceText: nextText,
		mentions: rebaseTeamDraftMemberMentions(record.sourceText, nextText, record.mentions),
	};
}
