// These assertions quote GitHub Actions expressions verbatim from the workflow YAML.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: workflow YAML is quoted verbatim
import { readFileSync } from "node:fs";

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRANCH_GATE_CHECKS, PULL_REQUEST_GATE_CHECKS } from "./ci-gate.mjs";
import { repoRoot } from "./lib.mjs";
import {
	buildConventionsReport,
	CONVENTIONS_COMMENT_MARKER,
	extractSection,
	isFilled,
	isProductCodePath,
	isTrustedAuthor,
	linkedIssueNumber,
	renderConventionsLog,
	renderConventionsMarkdown,
	TRUSTED_BOT_LOGINS,
} from "./pr-quality.mjs";

const TEMPLATE_PATH = join(repoRoot, ".github/pull_request_template.md");
const NOTES = { version: "0.5.61", path: ".github/release-notes/v0.5.61.md", touched: true, exists: true };

/** The shipped template with the sections a contributor has to write filled in. */
function fillTemplate({ surfaceArea = ["None"], userVisible = "\nA reader sees the new label.\n", issue = 12 } = {}) {
	let body = readFileSync(TEMPLATE_PATH, "utf8");
	body = body.replace("Fixes #", `Fixes #${issue}`);
	body = body.replace("## Why\n", "\n## Why\n\nThe current flow drops the reader's selection.\n");
	body = body.replace("## What users will see\n", `\n## What users will see\n${userVisible}\n`);
	body = body.replace("## Validation\n", "## Validation\n\n- `bun run check:quick`\n");
	for (const option of surfaceArea) body = body.replace(`- [ ] **${option}**`, `- [x] **${option}**`);
	return body;
}

function pullRequest(overrides = {}) {
	return {
		number: 42,
		title: "fix(reader): keep the selection",
		html_url: "https://example.test/pull/42",
		user: { login: "octocat" },
		author_association: "MEMBER",
		base: { ref: "dev" },
		draft: false,
		body: fillTemplate(),
		...overrides,
	};
}

const SMALL_DIFF = [{ path: "packages/agent/src/reader.ts", additions: 12, deletions: 3 }];

function report(overrides = {}) {
	return buildConventionsReport({
		pullRequest: pullRequest(overrides.pullRequest),
		files: overrides.files ?? SMALL_DIFF,
		releaseNotes: overrides.releaseNotes === undefined ? NOTES : overrides.releaseNotes,
		integrationBranchExists: overrides.integrationBranchExists ?? true,
	});
}

describe("pull request conventions", () => {
	it("accepts the shipped template once the contributor fills it in", () => {
		const result = report();
		expect(result.violations).toEqual([]);
		expect(result.blocked).toBe(false);
	});

	it("blocks a pull request that leaves the template untouched", () => {
		const result = report({ pullRequest: { body: readFileSync(TEMPLATE_PATH, "utf8") } });
		expect(result.violations.map((item) => item.code)).toEqual([
			"section:Why",
			"section:Validation",
			"section:What users will see",
			"surface-area",
		]);
		expect(result.blocked).toBe(true);
	});

	it("accepts an empty user-visible section when the surface area is None", () => {
		const result = report({ pullRequest: { body: fillTemplate({ userVisible: "" }) } });
		expect(result.violations).toEqual([]);
	});

	it("requires the user-visible section for a user-visible change", () => {
		const result = report({
			pullRequest: { body: fillTemplate({ surfaceArea: ["UI"], userVisible: "" }) },
		});
		expect(result.violations.map((item) => item.code)).toContain("section:What users will see");
		expect(result.warnings.map((item) => item.code)).toContain("screenshots");
	});

	it("blocks a pull request whose base branch is not accepted", () => {
		const result = report({ pullRequest: { base: { ref: "release/0.5" } } });
		expect(result.violations.map((item) => item.code)).toEqual(["base-branch"]);
		expect(result.baseBranchAllowed).toBe(false);
	});

	it("allows main as a base but hints at dev once dev exists", () => {
		const withDev = report({ pullRequest: { base: { ref: "main" } } });
		expect(withDev.violations).toEqual([]);
		expect(withDev.warnings.map((item) => item.code)).toEqual(["base-branch-hint"]);

		const withoutDev = report({ pullRequest: { base: { ref: "main" } }, integrationBranchExists: false });
		expect(withoutDev.warnings).toEqual([]);
	});

	it("blocks a pull request that leaves the release notes missing", () => {
		const result = report({ releaseNotes: { version: "0.5.61", path: NOTES.path, touched: false, exists: false } });
		expect(result.violations.map((item) => item.code)).toEqual(["release-notes-missing"]);
	});

	it("notes product code that does not touch the release notes", () => {
		const result = report({ releaseNotes: { ...NOTES, touched: false } });
		expect(result.warnings.map((item) => item.code)).toEqual(["release-notes-untouched"]);
	});

	it("notes a large pull request", () => {
		const files = Array.from({ length: 41 }, (_, index) => ({
			path: `packages/agent/src/f${index}.ts`,
			additions: 1,
			deletions: 0,
		}));
		const result = report({ files });
		expect(result.large).toBe(true);
		expect(result.warnings.map((item) => item.code)).toContain("large-pr");
	});

	it("keeps violations out of the way while the pull request is a draft", () => {
		const result = report({
			pullRequest: { body: readFileSync(TEMPLATE_PATH, "utf8"), draft: true },
		});
		expect(result.violations.length).toBeGreaterThan(0);
		expect(result.blocked).toBe(false);
		expect(result.labels.add).not.toContain("automerge");
	});

	it("labels a clean pull request from a trusted author for auto-merge", () => {
		const result = report();
		expect(result.trusted).toBe(true);
		expect(result.labels.add).toContain("automerge");
		expect(result.labels.remove).toContain("quality:blocked");
	});

	it("never labels a first-time contributor for auto-merge", () => {
		const result = report({ pullRequest: { author_association: "FIRST_TIME_CONTRIBUTOR" } });
		expect(result.trusted).toBe(false);
		expect(result.labels.add).not.toContain("automerge");
	});

	it("judges a dependency bot on its size and release notes, not on the template", () => {
		const bot = { user: { login: TRUSTED_BOT_LOGINS[0] }, author_association: "NONE", body: "" };
		const result = report({ pullRequest: bot });
		expect(result.trusted).toBe(true);
		expect(result.violations).toEqual([]);
		expect(result.warnings).toEqual([]);
		expect(result.labels.add).toContain("automerge");

		const missingNotes = report({ pullRequest: bot, releaseNotes: { ...NOTES, touched: false, exists: false } });
		expect(missingNotes.violations.map((item) => item.code)).toEqual(["release-notes-missing"]);
	});
});

describe("conventions helpers", () => {
	it("reads a section without nested headings or template comments", () => {
		const body =
			"## Why\n\n<!-- comment -->\nBecause.\n\n### Detail\n\nignored\n\n## Validation\n\n- `bun run check:quick`\n";
		expect(extractSection(body, "Why")).toBe("Because.");
		expect(extractSection(body, "Validation")).toBe("- `bun run check:quick`");
		expect(extractSection(body, "Screenshots")).toBeUndefined();
	});

	it("treats a lone bullet as an empty section", () => {
		expect(isFilled("-")).toBe(false);
		expect(isFilled("---")).toBe(false);
		expect(isFilled("\n\n")).toBe(false);
		expect(isFilled("- `bun run check:quick`")).toBe(true);
	});

	it("finds the linked issue of any closing keyword", () => {
		expect(linkedIssueNumber("Fixes #12")).toBe(12);
		expect(linkedIssueNumber("closes #7\n")).toBe(7);
		expect(linkedIssueNumber("Resolved #1034")).toBe(1034);
		expect(linkedIssueNumber("Fixes #")).toBeUndefined();
		expect(linkedIssueNumber("## Why\n\nSee #12.")).toBeUndefined();
	});

	it("only counts product code that reaches a released build", () => {
		expect(isProductCodePath("packages/agent/src/reader.ts")).toBe(true);
		expect(isProductCodePath("apps/desktop/src/main/index.ts")).toBe(true);
		expect(isProductCodePath("apps/desktop/test/reader.test.ts")).toBe(false);
		expect(isProductCodePath("packages/agent/src/reader.test.ts")).toBe(false);
		expect(isProductCodePath("docs/dev/quality-gates.md")).toBe(false);
		expect(isProductCodePath(".github/workflows/quality.yml")).toBe(false);
	});

	it("trusts members, owners, collaborators and the known bots", () => {
		expect(isTrustedAuthor({ user: { login: "someone" }, author_association: "OWNER" })).toBe(true);
		expect(isTrustedAuthor({ user: { login: "renovate[bot]" }, author_association: "NONE" })).toBe(true);
		expect(isTrustedAuthor({ user: { login: "someone" }, author_association: "NONE" })).toBe(false);
	});
});

describe("conventions report rendering", () => {
	it("explains every blocking item and the auto-merge rules", () => {
		const markdown = renderConventionsMarkdown(report({ pullRequest: { body: "" } }));
		expect(markdown).toContain("**Needs changes**");
		expect(markdown).toContain("#### Blocking");
		expect(markdown).toContain("do-not-merge");
		expect(markdown).toContain("docs/dev/pr-automation.md");
		expect(CONVENTIONS_COMMENT_MARKER).toMatch(/^<!-- .+ -->$/);
	});

	it("reports the parsed facts on one log line", () => {
		const log = renderConventionsLog(report());
		expect(log).toContain("[pr-conventions] #42 by octocat (MEMBER)");
		expect(log).toContain("base=dev");
		expect(log).toContain("trusted=true");
		expect(log).toContain("ok: conventions satisfied");
	});
});

const WORKFLOW_DIR = join(repoRoot, ".github/workflows");

function workflow(name) {
	return readFileSync(join(WORKFLOW_DIR, name), "utf8");
}

/** Job-level `name:` values, with the OS matrix expanded the way GitHub names the checks. */
function jobNames(name) {
	const names = [...workflow(name).matchAll(/^ {4}name: (.+?)\s*$/gm)].map((match) => match[1]);
	const expanded = new Set(names);
	for (const job of names) {
		for (const os of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
			expanded.add(job.replace("${{ matrix.os }}", os));
		}
	}
	return expanded;
}

describe("pr-quality workflow", () => {
	// The job name is the required check name; renaming it silently disables the
	// gate in ci-gate.mjs, so the two have to move together.
	it("publishes the required check the gate waits for", () => {
		expect(PULL_REQUEST_GATE_CHECKS).toEqual(["PR conventions"]);
		expect(jobNames("pr-quality.yml")).toEqual(new Set(["PR conventions"]));
	});

	it("runs read-only against the base revision", () => {
		const source = workflow("pr-quality.yml");
		expect(source).toContain("pull_request_target:");
		expect(source).toContain("ref: ${{ github.event.pull_request.base.sha }}");
		expect(source).toContain("node scripts/quality/pr-quality.mjs --check");
		expect(source).toContain("${{ secrets.ASTRAVIA_AUTOMATION_TOKEN || secrets.GITHUB_TOKEN }}");
		expect(source).not.toContain("head.sha");
		expect(source).not.toContain("contents: write");
	});
});

describe("gate check names", () => {
	// ci-gate.mjs decides on real check names: a rename in a workflow would leave
	// the branch gate waiting forever, so every name has to exist somewhere.
	it("exists as a job in some workflow", () => {
		const published = new Set([
			...jobNames("quality.yml"),
			...jobNames("desktop-packaged.yml"),
			...jobNames("pr-quality.yml"),
		]);
		for (const check of BRANCH_GATE_CHECKS) expect(published).toContain(check);
	});
});
