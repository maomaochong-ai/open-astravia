import { describe, expect, it } from "vitest";
import { condenseRules, diffArgsForScope, resolveDiffScope } from "../src/git/aiContext";
import { cleanGeneratedMessage } from "../src/git/aiMessage";

describe("resolveDiffScope", () => {
	it("describes the index when something is staged", () => {
		expect(resolveDiffScope(true)).toBe("index");
		expect(diffArgsForScope("index", false)).toEqual(["diff", "--cached"]);
	});

	it("describes the whole worktree when the index is empty", () => {
		// The commit button stages everything in this case, so the generated message
		// must cover the same range — this is the invariant the two paths share.
		expect(resolveDiffScope(false)).toBe("worktree");
		expect(diffArgsForScope("worktree", false)).toEqual(["diff", "HEAD"]);
	});

	it("adds --stat only in summary form", () => {
		expect(diffArgsForScope("index", true)).toEqual(["diff", "--cached", "--stat"]);
		expect(diffArgsForScope("worktree", true)).toEqual(["diff", "HEAD", "--stat"]);
	});
});

describe("cleanGeneratedMessage", () => {
	it("keeps a plain message untouched", () => {
		expect(cleanGeneratedMessage("feat(auth): add token refresh")).toBe("feat(auth): add token refresh");
	});

	it("strips a wrapping code fence with a language tag", () => {
		expect(cleanGeneratedMessage("```text\nfix: handle empty index\n```")).toBe("fix: handle empty index");
	});

	it("strips a wrapping code fence without a language tag", () => {
		expect(cleanGeneratedMessage("```\nfix: handle empty index\n```")).toBe("fix: handle empty index");
	});

	it("drops an English lead-in line", () => {
		expect(cleanGeneratedMessage("Here is the commit message:\nfix: stop the leak")).toBe("fix: stop the leak");
	});

	it("drops a Chinese lead-in line", () => {
		expect(cleanGeneratedMessage("好的，这是提交信息：\nfix: 修复泄漏")).toBe("fix: 修复泄漏");
	});

	it("keeps a colon-ending first line that is the actual subject", () => {
		// Only recognised lead-ins are removed; an unusual subject must survive.
		expect(cleanGeneratedMessage("refactor: split the parser:\n\nbody text")).toBe("refactor: split the parser:\n\nbody text");
	});

	it("unwraps quotes around the whole message", () => {
		expect(cleanGeneratedMessage('"fix: guard against null"')).toBe("fix: guard against null");
	});

	it("preserves the blank line between subject and body", () => {
		expect(cleanGeneratedMessage("feat: add panel\n\nWhy it matters.")).toBe("feat: add panel\n\nWhy it matters.");
	});

	it("collapses runs of blank lines", () => {
		expect(cleanGeneratedMessage("feat: add panel\n\n\n\nWhy.")).toBe("feat: add panel\n\nWhy.");
	});
});

describe("condenseRules", () => {
	it("returns a short document verbatim", () => {
		const text = "# Commit rules\nUse conventional commits.";
		expect(condenseRules(text)).toBe(text);
	});

	it("keeps the commit-related paragraphs of an oversized document", () => {
		const filler = Array.from({ length: 400 }, (_, index) => `unrelated build note ${index}`).join("\n");
		const text = [filler, "All commit messages must use conventional commits.", filler, "Reference issues as owner/repo#123 in the commit body.", filler].join(
			"\n",
		);

		const condensed = condenseRules(text);

		expect(condensed).toContain("must use conventional commits");
		expect(condensed).toContain("owner/repo#123");
		expect(condensed).not.toContain("unrelated build note 10");
		// The two kept paragraphs are far apart; the gap is marked so they do not read
		// as one contiguous passage.
		expect(condensed).toContain("…");
	});

	it("falls back to a head slice when nothing matches", () => {
		const text = "x".repeat(20_000);

		const condensed = condenseRules(text);

		expect(condensed.length).toBe(8_000);
	});
});
