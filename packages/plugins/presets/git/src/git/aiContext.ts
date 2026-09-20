/**
 * Context gathering for AI-generated commit messages: what is about to be
 * committed, how the project says to write messages, and how this repository has
 * written them so far.
 */

/** Per-file budget for a project rules document before it gets condensed. */
const RULES_BUDGET = 8_000;
/** Budget for the diff body before it degrades to a stat + head-of-hunk summary. */
const DIFF_BUDGET = 60_000;
/** Lines of surrounding context kept around a rules paragraph that matched. */
const RULES_CONTEXT_LINES = 2;
/** Commits shown to align with the repository's existing subject style. */
const LOG_COUNT = 8;

/** Which diff a generated message must describe. */
export type DiffScope = "index" | "worktree";

/**
 * The invariant: the diff shown to the model is exactly what pressing the commit
 * button will commit.
 *
 * With a non-empty index, committing records the index (`--cached`); with an empty
 * index, the button stages everything first, so the scope is the whole worktree.
 * Both the commit path and the generation path derive their range from here, so
 * they cannot drift apart.
 */
export function resolveDiffScope(hasStagedChanges: boolean): DiffScope {
	return hasStagedChanges ? "index" : "worktree";
}

/** `git diff` arguments for a scope, optionally in summary form. */
export function diffArgsForScope(scope: DiffScope, summary: boolean): string[] {
	const base = scope === "index" ? ["diff", "--cached"] : ["diff", "HEAD"];
	return summary ? [...base, "--stat"] : base;
}

/**
 * Keep a rules document within budget.
 *
 * Whole-file is the most faithful input when the document is about commits (this
 * repository's own CLAUDE.md is exactly that). When it is a 50 KB build manual
 * instead, keeping it whole would crowd out the diff, so oversized documents are
 * reduced to the paragraphs that mention commits or git, plus their neighbours.
 */
export function condenseRules(text: string): string {
	if (text.length <= RULES_BUDGET) return text;

	const lines = text.split("\n");
	const keyword = /commit|git|message|提交|信息/i;
	const keep = new Set<number>();
	lines.forEach((line, index) => {
		if (!keyword.test(line)) return;
		for (let offset = -RULES_CONTEXT_LINES; offset <= RULES_CONTEXT_LINES; offset++) {
			const target = index + offset;
			if (target >= 0 && target < lines.length) keep.add(target);
		}
	});
	if (keep.size === 0) return text.slice(0, RULES_BUDGET);

	const ordered = [...keep].sort((a, b) => a - b);
	const chunks: string[] = [];
	let previous = -2;
	for (const index of ordered) {
		// A gap means we skipped unrelated lines; mark it so the model does not read
		// two distant paragraphs as contiguous.
		if (index !== previous + 1 && chunks.length > 0) chunks.push("…");
		chunks.push(lines[index] as string);
		previous = index;
	}
	return chunks.join("\n").slice(0, RULES_BUDGET);
}

/** Whether a diff body is small enough to send verbatim. */
export function diffFitsBudget(diff: string): boolean {
	return diff.length <= DIFF_BUDGET;
}

export const AI_CONTEXT_LIMITS = { RULES_BUDGET, DIFF_BUDGET, LOG_COUNT } as const;
