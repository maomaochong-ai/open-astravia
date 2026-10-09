#!/usr/bin/env node

/**
 * Contributor automation for pull requests: judge the description, changed files
 * and release notes against the repository conventions, then sync the labels and
 * the sticky comment that drive auto-merge.
 *
 * The workflow runs this from the base branch (`pull_request_target`) and reads
 * the pull request through the REST API only. Pull request code is never checked
 * out, so a fork cannot influence what this script does.
 *
 * Two modes:
 *   --check  evaluate and fail when the conventions are violated (required check)
 *   --sync   evaluate, then apply labels and the sticky comment (never blocks)
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { desktopVersion, releaseNotesPath } from "../release/release-notes.mjs";
import { AUTOMERGE_LABEL, MANAGED_LABELS, QUALITY_BLOCKED_LABEL, QUALITY_LARGE_LABEL } from "./ci-gate.mjs";
import {
	createClientFromEnv,
	ensureLabels,
	resolveRepository,
	syncLabels,
	upsertPullRequestComment,
} from "./github-rest.mjs";
import { isDirectRun } from "./lib.mjs";

export const DEFAULT_BRANCH = "main";
export const INTEGRATION_BRANCH = "dev";
export const ALLOWED_BASE_BRANCHES = [INTEGRATION_BRANCH, DEFAULT_BRANCH];

export const CONVENTIONS_COMMENT_MARKER = "<!-- astravia-pr-conventions -->";

export const REQUIRED_SECTIONS = ["Why", "Validation"];
export const USER_VISIBLE_SECTION = "What users will see";
export const SURFACE_AREA_SECTION = "Surface area";
export const SCREENSHOTS_SECTION = "Screenshots";
export const NONE_OPTION = "None";
export const UI_OPTION = "UI";

export const LARGE_PR_FILE_THRESHOLD = 40;
export const LARGE_PR_LINE_THRESHOLD = 1200;

export const TRUSTED_AUTHOR_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];
export const TRUSTED_BOT_LOGINS = ["dependabot[bot]", "github-actions[bot]", "renovate[bot]"];

export const LINKED_ISSUE_PATTERN = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[^\n#]*#(\d+)/i;

const HEADING_PATTERN = /^#{2,3}\s+(.+?)\s*$/;
const CHECKBOX_PATTERN = /^\s*[-*]\s*\[([ xX])\]\s*(.*)$/;
const PLACEHOLDER_PATTERN = /^[-*_]{1,3}$/;
const PRODUCT_CODE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|swift|kt|kts|go|java|css|html)$/i;

export function stripHtmlComments(text) {
	return String(text ?? "").replaceAll(/<!--[\s\S]*?-->/g, "");
}

/** Body of a `## Heading` section, without nested headings and template comments. */
export function extractSection(body, heading) {
	const lines = String(body ?? "").split(/\r?\n/);
	const wanted = heading.trim().toLowerCase();
	const start = lines.findIndex((line) => {
		const match = HEADING_PATTERN.exec(line.trim());
		return match !== null && match[1].trim().toLowerCase() === wanted;
	});
	if (start === -1) return undefined;
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => HEADING_PATTERN.test(line.trim()));
	const block = end === -1 ? rest : rest.slice(0, end);
	return stripHtmlComments(block.join("\n")).trim();
}

/** True when a section holds something a reviewer can act on, not just a `-` bullet. */
export function isFilled(content) {
	if (typeof content !== "string") return false;
	return (
		content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !PLACEHOLDER_PATTERN.test(line))
			.join(" ")
			.trim().length > 0
	);
}

export function sectionOptions(content) {
	const checked = [];
	const unchecked = [];
	for (const line of String(content ?? "").split(/\r?\n/)) {
		const match = CHECKBOX_PATTERN.exec(line);
		if (!match) continue;
		const label = match[2].replaceAll("**", "").split(" — ")[0].trim();
		if (label.length === 0) continue;
		(match[1].trim().length > 0 ? checked : unchecked).push(label);
	}
	return { checked, unchecked };
}

export function isTrustedAuthor(pullRequest) {
	const login = pullRequest?.user?.login ?? "";
	if (TRUSTED_BOT_LOGINS.includes(login)) return true;
	return TRUSTED_AUTHOR_ASSOCIATIONS.includes((pullRequest?.author_association ?? "").toUpperCase());
}

/** Product code that reaches a released build; docs, tests and CI config do not. */
export function isProductCodePath(path) {
	if (!/^(?:apps|packages)\//.test(path)) return false;
	if (/\/(?:test|tests|__tests__)\//.test(path)) return false;
	if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path)) return false;
	return PRODUCT_CODE_EXTENSIONS.test(path);
}

export function linkedIssueNumber(body) {
	const match = LINKED_ISSUE_PATTERN.exec(stripHtmlComments(body));
	return match ? Number(match[1]) : undefined;
}

/**
 * `.github/release-notes/v<version>.md` is the body of the next GitHub Release and
 * the release pipeline fails without it. The base checkout usually holds the file
 * already; when a pull request adds it, the file list is the only evidence we have.
 */
export function releaseNotesState(paths, root = process.cwd()) {
	let version;
	try {
		version = desktopVersion(root);
	} catch {
		return null;
	}
	const path = releaseNotesPath(version);
	const touched = paths.includes(path);
	return { version, path, touched, exists: existsSync(join(root, path)) || touched };
}

export function buildConventionsReport({
	pullRequest,
	files = [],
	filesTruncated = false,
	releaseNotes = null,
	integrationBranchExists = false,
}) {
	const body = typeof pullRequest?.body === "string" ? pullRequest.body : "";
	const baseBranch = pullRequest?.base?.ref ?? "";
	const draft = Boolean(pullRequest?.draft);
	const trusted = isTrustedAuthor(pullRequest);
	const isBot = TRUSTED_BOT_LOGINS.includes(pullRequest?.user?.login ?? "");
	const stats = files.reduce(
		(total, file) => ({
			files: total.files + 1,
			additions: total.additions + (file.additions ?? 0),
			deletions: total.deletions + (file.deletions ?? 0),
		}),
		{ files: 0, additions: 0, deletions: 0 },
	);
	const lines = stats.additions + stats.deletions;
	const context = extractSection(body, SURFACE_AREA_SECTION);
	const surfaceArea = sectionOptions(context);
	const violations = [];
	const warnings = [];

	if (!ALLOWED_BASE_BRANCHES.includes(baseBranch)) {
		violations.push({
			code: "base-branch",
			message: `Base branch \`${baseBranch || "?"}\` is not accepted. Open the pull request against \`${INTEGRATION_BRANCH}\`.`,
		});
	} else if (baseBranch === DEFAULT_BRANCH && integrationBranchExists) {
		warnings.push({
			code: "base-branch-hint",
			message: `This repository integrates on \`${INTEGRATION_BRANCH}\`; a pull request against \`${DEFAULT_BRANCH}\` skips that gate.`,
		});
	}

	// The pull request template is written for people: a dependency bot cannot fill in
	// sections or checkboxes, so a bot is judged on the base branch, the size and the
	// release notes only.
	if (!isBot) {
		for (const heading of REQUIRED_SECTIONS) {
			if (isFilled(extractSection(body, heading))) continue;
			violations.push({ code: `section:${heading}`, message: fillSectionMessage(heading) });
		}
		const noneChecked = surfaceArea.checked.includes(NONE_OPTION);
		if (!noneChecked && !isFilled(extractSection(body, USER_VISIBLE_SECTION))) {
			violations.push({
				code: `section:${USER_VISIBLE_SECTION}`,
				message: fillSectionMessage(USER_VISIBLE_SECTION),
			});
		}
		if (surfaceArea.checked.length === 0) {
			violations.push({
				code: "surface-area",
				message: `\`## ${SURFACE_AREA_SECTION}\` has no checkbox selected. Tick at least one row — \`${NONE_OPTION}\` is a valid answer.`,
			});
		}
	}
	if (releaseNotes && !releaseNotes.exists) {
		violations.push({
			code: "release-notes-missing",
			message: `\`${releaseNotes.path}\` is missing. It is the body of the next GitHub Release and the release pipeline fails without it; add it in this pull request.`,
		});
	}

	const linkedIssue = linkedIssueNumber(body);
	if (!isBot && linkedIssue === undefined) {
		warnings.push({
			code: "linked-issue",
			message:
				"No linked issue found. Use `Fixes #N` so the issue closes on merge, and keep it only when nothing is closed.",
		});
	}
	if (releaseNotes?.exists && !releaseNotes.touched && files.some((file) => isProductCodePath(file.path))) {
		warnings.push({
			code: "release-notes-untouched",
			message: `This pull request changes product code but does not touch \`${releaseNotes.path}\`; add the entry in the same pull request.`,
		});
	}
	if (!isBot && surfaceArea.checked.includes(UI_OPTION) && !isFilled(extractSection(body, SCREENSHOTS_SECTION))) {
		warnings.push({
			code: "screenshots",
			message: `\`## ${SURFACE_AREA_SECTION}\` marks UI but \`## ${SCREENSHOTS_SECTION}\` is empty. Show the entry point, not only the feature in isolation.`,
		});
	}
	const large = filesTruncated || stats.files > LARGE_PR_FILE_THRESHOLD || lines > LARGE_PR_LINE_THRESHOLD;
	if (large) {
		warnings.push({
			code: "large-pr",
			message: `Large pull request: ${filesTruncated ? "3000+" : stats.files} files, +${stats.additions}/-${stats.deletions} lines. One concern per pull request keeps review possible.`,
		});
	}

	const blocked = violations.length > 0 && !draft;
	return {
		number: pullRequest?.number,
		title: pullRequest?.title ?? "",
		url: pullRequest?.html_url ?? "",
		author: pullRequest?.user?.login ?? "",
		authorAssociation: pullRequest?.author_association ?? "",
		trusted,
		draft,
		baseBranch,
		baseBranchAllowed: ALLOWED_BASE_BRANCHES.includes(baseBranch),
		integrationBranchExists,
		linkedIssue,
		releaseNotes,
		surfaceArea: surfaceArea.checked,
		large,
		truncated: filesTruncated,
		stats: { ...stats, lines },
		violations,
		warnings,
		blocked,
		labels: {
			add: [
				...(blocked ? [QUALITY_BLOCKED_LABEL] : []),
				...(large ? [QUALITY_LARGE_LABEL] : []),
				...(trusted && !blocked && !draft ? [AUTOMERGE_LABEL] : []),
			],
			// `automerge` is a maintainer opt-in: never remove it here, the merge gate is authoritative.
			remove: [...(blocked ? [] : [QUALITY_BLOCKED_LABEL]), ...(large ? [] : [QUALITY_LARGE_LABEL])],
		},
	};
}

function fillSectionMessage(heading) {
	if (heading === "Validation") {
		return `\`## ${heading}\` is empty. List the commands you actually ran; the default minimum is \`bun run check:quick\`.`;
	}
	if (heading === USER_VISIBLE_SECTION) {
		return `\`## ${heading}\` is empty. Describe the user-visible effect, or tick \`${NONE_OPTION}\` under \`## ${SURFACE_AREA_SECTION}\`.`;
	}
	return `\`## ${heading}\` is empty. Explain the use case and the pain this change addresses.`;
}

export function renderConventionsMarkdown(report) {
	const lines = [];
	lines.push("### Conventions check");
	lines.push("");
	if (report.draft && report.violations.length > 0) {
		lines.push(
			`**Draft** — ${report.violations.length} blocking item(s) below. A draft pull request does not fail the required check; fix them before marking it ready for review.`,
		);
	} else if (report.blocked) {
		lines.push(
			`**Needs changes** — the required \`PR conventions\` check fails until the ${report.violations.length} item(s) below are resolved.`,
		);
	} else {
		lines.push("**Passed** — description, linked issue, size and release notes match the repository conventions.");
	}
	lines.push("");
	lines.push(
		`Base branch: \`${report.baseBranch}\` · Surface area: ${report.surfaceArea.length > 0 ? report.surfaceArea.join(", ") : "—"} · Size: ${report.stats.files} files, +${report.stats.additions}/-${report.stats.deletions}`,
	);
	if (report.violations.length > 0) {
		lines.push("");
		lines.push("#### Blocking");
		for (const item of report.violations) lines.push(`- ${item.message}`);
	}
	if (report.warnings.length > 0) {
		lines.push("");
		lines.push("#### Notes");
		for (const item of report.warnings) lines.push(`- ${item.message}`);
	}
	lines.push("");
	lines.push(
		[
			"<sub>",
			"Tests, packaging and platform gates run in the `quality` and `desktop-packaged` workflows; this comment only covers the pull request itself.",
			`Merging is automatic for trusted authors and for pull requests labelled \`${AUTOMERGE_LABEL}\`, once every required check is green; add \`do-not-merge\` to stop it.`,
			"See [`docs/dev/pr-automation.md`](docs/dev/pr-automation.md).",
			"</sub>",
		].join(" "),
	);
	return lines.join("\n");
}

export function renderConventionsLog(report) {
	const parts = [
		`[pr-conventions] #${report.number} by ${report.author} (${report.authorAssociation || "NONE"})`,
		`base=${report.baseBranch}`,
		`files=${report.stats.files}`,
		`lines=+${report.stats.additions}/-${report.stats.deletions}`,
		`trusted=${report.trusted}`,
		`draft=${report.draft}`,
		`large=${report.large}`,
	];
	const lines = [parts.join(" ")];
	for (const item of report.violations) lines.push(`[pr-conventions] blocking ${item.code}: ${item.message}`);
	for (const item of report.warnings) lines.push(`[pr-conventions] note ${item.code}: ${item.message}`);
	lines.push(
		report.blocked
			? `[pr-conventions] blocked: ${report.violations.length} item(s) need changes`
			: "[pr-conventions] ok: conventions satisfied",
	);
	return lines.join("\n");
}

export function readPullRequestNumber(env = process.env) {
	const path = env.GITHUB_EVENT_PATH;
	if (!path || !existsSync(path)) throw new Error("GITHUB_EVENT_PATH is not set; run this from a workflow");
	const event = JSON.parse(readFileSync(path, "utf8"));
	const number = event?.pull_request?.number ?? event?.number;
	if (!Number.isInteger(number)) throw new Error("The event payload does not reference a pull request");
	return number;
}

export async function collectPullRequestFacts(client, { owner, repo, number, repoRoot = process.cwd() }) {
	const { data: pullRequest } = await client.get(`/repos/${owner}/${repo}/pulls/${number}`);
	const { items, truncated } = await client.paginate(`/repos/${owner}/${repo}/pulls/${number}/files`, { limit: 30 });
	const files = items
		.filter((file) => typeof file?.filename === "string")
		.map((file) => ({
			path: file.filename,
			additions: file.additions ?? 0,
			deletions: file.deletions ?? 0,
			status: file.status ?? "modified",
		}));
	const { status } = await client.get(`/repos/${owner}/${repo}/branches/${INTEGRATION_BRANCH}`, { tolerate: [404] });
	return {
		pullRequest,
		files,
		filesTruncated: truncated,
		integrationBranchExists: status !== 404,
		releaseNotes: releaseNotesState(
			files.map((file) => file.path),
			repoRoot,
		),
	};
}

export async function applyPullRequestFeedback(client, { owner, repo, pullRequest, report, log = () => {} }) {
	await ensureLabels(client, { owner, repo, labels: MANAGED_LABELS, log });
	const current = (pullRequest.labels ?? [])
		.map((label) => (typeof label === "string" ? label : label?.name))
		.filter((name) => typeof name === "string");
	await syncLabels(client, {
		owner,
		repo,
		number: report.number,
		current,
		add: report.labels.add,
		remove: report.labels.remove,
		log,
	});
	await upsertPullRequestComment(client, {
		owner,
		repo,
		number: report.number,
		marker: CONVENTIONS_COMMENT_MARKER,
		body: renderConventionsMarkdown(report),
		log,
	});
}

export async function runPullRequestAutomation({
	mode = "check",
	env = process.env,
	fetchImpl,
	log = console.log,
} = {}) {
	const { owner, repo } = resolveRepository(env);
	const number = readPullRequestNumber(env);
	const client = createClientFromEnv(env, { fetchImpl });
	const facts = await collectPullRequestFacts(client, {
		owner,
		repo,
		number,
		repoRoot: env.GITHUB_WORKSPACE || process.cwd(),
	});
	const report = buildConventionsReport(facts);
	log(renderConventionsLog(report));
	if (env.GITHUB_STEP_SUMMARY) {
		appendFileSync(env.GITHUB_STEP_SUMMARY, `${renderConventionsMarkdown(report)}\n`);
	}
	if (mode !== "sync") return { report, exitCode: report.blocked ? 1 : 0 };
	await applyPullRequestFeedback(client, { owner, repo, pullRequest: facts.pullRequest, report, log });
	return { report, exitCode: 0 };
}

async function main(argv = process.argv.slice(2)) {
	const mode = argv.includes("--sync") ? "sync" : "check";
	const { exitCode } = await runPullRequestAutomation({ mode });
	process.exitCode = exitCode;
}

if (isDirectRun(import.meta.url)) {
	main().catch((error) => {
		console.error(`[pr-conventions] ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
