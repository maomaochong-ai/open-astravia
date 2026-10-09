// These assertions quote GitHub Actions expressions verbatim from the workflow YAML.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: workflow YAML is quoted verbatim
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AUTOMERGE_LABEL, DO_NOT_MERGE_LABEL, gateCheckNames, PATH_SCOPED_CHECKS } from "./ci-gate.mjs";
import { repoRoot } from "./lib.mjs";
import {
	AUTOMATION_COMMENT_MARKER,
	candidatePullRequests,
	deleteHeadBranch,
	evaluateAutoMergeEligibility,
	mergePullRequest,
	normalizeLabels,
	PROMOTION_WORKFLOW_FILE,
	pullRequestCheckRefs,
	renderAutomationComment,
	requestPromotion,
	runAutoMerge,
} from "./pr-auto-merge.mjs";
import { ALLOWED_BASE_BRANCHES } from "./pr-quality.mjs";

const OWNER = "maomaochong-ai";
const REPO = "open-astravia";
const SLUG = `${OWNER}/${REPO}`;

function greenCheckRuns() {
	return gateCheckNames({ pullRequest: true }).map((name, index) => ({
		id: index + 1,
		name,
		status: "completed",
		conclusion: "success",
		app: { slug: "github-actions" },
	}));
}

function pullRequest(overrides = {}) {
	return {
		number: 7,
		title: "fix(reader): keep the selection",
		state: "open",
		draft: false,
		base: { ref: "dev" },
		head: { sha: "head111", ref: "fix/reader", repo: { full_name: SLUG } },
		merge_commit_sha: "merge222",
		mergeable: true,
		labels: [AUTOMERGE_LABEL],
		user: { login: "octocat" },
		...overrides,
	};
}

function eligibility({ pr = pullRequest(), labels = pr.labels, checkRuns = greenCheckRuns() } = {}) {
	return evaluateAutoMergeEligibility({ pullRequest: pr, labels, checkRuns });
}

describe("auto-merge eligibility", () => {
	it("merges a labelled pull request whose required checks are green", () => {
		const report = eligibility();
		expect(report.eligible).toBe(true);
		expect(report.gate.status).toBe("ready");
		expect(report.blocked).toEqual([]);
		expect(report.waiting).toEqual([]);
	});

	it("waits for the checks that have not reported yet", () => {
		const report = eligibility({ checkRuns: [] });
		expect(report.eligible).toBe(false);
		expect(report.waiting[0]).toContain("waiting for required checks");
		expect(report.blocked).toEqual([]);
	});

	it("blocks on a failing required check", () => {
		const checkRuns = greenCheckRuns().map((run) =>
			run.name === "check + quality tests" ? { ...run, conclusion: "failure" } : run,
		);
		const report = eligibility({ checkRuns });
		expect(report.blocked[0]).toContain("check + quality tests (failure)");
	});

	it("blocks on a failed packaged E2E but ignores one that never ran", () => {
		const failing = greenCheckRuns().concat({
			id: 99,
			name: "Linux packaged E2E",
			status: "completed",
			conclusion: "failure",
			app: { slug: "github-actions" },
		});
		expect(eligibility({ checkRuns: failing }).blocked[0]).toContain("Linux packaged E2E");

		const merged = greenCheckRuns().map((run) => ({ ...run, id: run.id + 100 }));
		expect(eligibility({ checkRuns: merged }).eligible).toBe(true);
	});

	it("ignores check runs from other apps", () => {
		const checkRuns = greenCheckRuns().concat({
			id: 500,
			name: "CodeRabbit",
			status: "completed",
			conclusion: "failure",
			app: { slug: "coderabbitai" },
		});
		expect(eligibility({ checkRuns }).eligible).toBe(true);
	});

	it("requires the opt-in label and honours the stop label", () => {
		expect(eligibility({ labels: [] }).blocked).toContain(`missing the \`${AUTOMERGE_LABEL}\` label`);
		expect(eligibility({ labels: [AUTOMERGE_LABEL, DO_NOT_MERGE_LABEL] }).blocked).toContain(
			`the \`${DO_NOT_MERGE_LABEL}\` label is set`,
		);
	});

	it("never merges a draft, a conflicted branch or an unaccepted base", () => {
		expect(eligibility({ pr: pullRequest({ draft: true }) }).waiting).toContain("the pull request is still a draft");
		expect(eligibility({ pr: pullRequest({ mergeable: false }) }).blocked).toContain("the branch has conflicts");
		expect(eligibility({ pr: pullRequest({ mergeable: null }) }).waiting).toContain(
			"GitHub is still computing mergeability",
		);
		expect(eligibility({ pr: pullRequest({ base: { ref: "release/0.5" } }) }).blocked[0]).toContain(
			"base branch `release/0.5` is not accepted",
		);
		expect(eligibility({ pr: pullRequest({ state: "closed" }) }).blocked[0]).toContain("pull request is closed");
		expect(ALLOWED_BASE_BRANCHES).toContain("dev");
	});

	it("reads the check runs of the head and of the test merge commit", () => {
		expect(pullRequestCheckRefs({ head: { sha: "a" }, merge_commit_sha: "b" })).toEqual(["a", "b"]);
		expect(pullRequestCheckRefs({ head: { sha: "a" }, merge_commit_sha: "a" })).toEqual(["a"]);
		expect(pullRequestCheckRefs({})).toEqual([]);
	});

	it("normalizes labels and candidate pull requests", () => {
		expect([...normalizeLabels(["a", { name: "b" }, {}, null])]).toEqual(["a", "b"]);
		expect(candidatePullRequests({ pull_request: { number: 3 } })).toEqual([3]);
		expect(candidatePullRequests({ workflow_run: { pull_requests: [{ number: 4 }, { number: 4 }, {}] } })).toEqual([
			4,
		]);
		expect(candidatePullRequests({ workflow_run: { head_sha: "abc" } })).toEqual([]);
	});
});

/** Minimal GitHub transport: routes are keyed by `METHOD /path`, unknown ones fail loudly. */
function createTransport(routes) {
	const calls = [];
	const fetchImpl = async (url, init = {}) => {
		const parsed = new URL(String(url));
		const method = (init.method ?? "GET").toUpperCase();
		const key = `${method} ${parsed.pathname}`;
		calls.push({ key, query: parsed.search, body: init.body ? JSON.parse(init.body) : undefined });
		const route = routes[key];
		if (route === undefined) throw new Error(`unexpected request: ${key}`);
		const result = typeof route === "function" ? route({ parsed }) : route;
		const status = result.status ?? 200;
		return {
			status,
			ok: status < 400,
			text: async () => (result.body === undefined || status === 204 ? "" : JSON.stringify(result.body)),
		};
	};
	return { fetchImpl, calls };
}

const eventFiles = [];

function eventFile(name, payload) {
	const root = mkdtempSync(join(tmpdir(), `astravia-${name}-`));
	eventFiles.push(root);
	const path = join(root, "event.json");
	writeFileSync(path, JSON.stringify(payload));
	return path;
}

function env(payload, name = "auto-merge") {
	return {
		GITHUB_REPOSITORY: SLUG,
		GITHUB_TOKEN: "test-token",
		GITHUB_EVENT_PATH: eventFile(name, payload),
	};
}

afterEach(() => {
	for (const root of eventFiles.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("auto-merge actions", () => {
	it("merges with the head sha so a force-push cannot slip through", async () => {
		const { fetchImpl, calls } = createTransport({
			[`PUT /repos/${SLUG}/pulls/7/merge`]: { body: { sha: "squash33", merged: true } },
		});
		const client = { put: (path, options) => fetchVia(fetchImpl, "PUT", path, options) };
		const result = await mergePullRequest(client, { owner: OWNER, repo: REPO, pullRequest: pullRequest() });
		expect(result).toEqual({ merged: true, sha: "squash33" });
		expect(calls[0].body).toEqual({
			merge_method: "squash",
			sha: "head111",
			commit_title: "fix(reader): keep the selection (#7)",
		});
	});

	it("reports why GitHub refused the merge", async () => {
		const { fetchImpl } = createTransport({
			[`PUT /repos/${SLUG}/pulls/7/merge`]: { status: 405, body: { message: "Pull request is not mergeable" } },
		});
		const client = { put: (path, options) => fetchVia(fetchImpl, "PUT", path, options) };
		const result = await mergePullRequest(client, { owner: OWNER, repo: REPO, pullRequest: pullRequest() });
		expect(result).toEqual({ merged: false, reason: "Pull request is not mergeable" });
	});

	it("deletes the head branch only when it belongs to this repository", async () => {
		const routes = {
			[`DELETE /repos/${SLUG}/git/refs/heads/fix/reader`]: { status: 204 },
		};
		const { fetchImpl, calls } = createTransport(routes);
		const client = { del: (path, options) => fetchVia(fetchImpl, "DELETE", path, options) };

		expect(await deleteHeadBranch(client, { owner: OWNER, repo: REPO, pullRequest: pullRequest() })).toEqual({
			deleted: true,
		});
		expect(calls).toHaveLength(1);

		const fork = pullRequest({ head: { sha: "h", ref: "fix/reader", repo: { full_name: "someone/open-astravia" } } });
		expect(await deleteHeadBranch(client, { owner: OWNER, repo: REPO, pullRequest: fork })).toEqual({
			deleted: false,
		});

		const integration = pullRequest({ head: { sha: "h", ref: "dev", repo: { full_name: SLUG } } });
		expect(await deleteHeadBranch(client, { owner: OWNER, repo: REPO, pullRequest: integration })).toEqual({
			deleted: false,
		});
		expect(calls).toHaveLength(1);
	});

	it("asks the promotion workflow to look at the freshly merged branch", async () => {
		const { fetchImpl, calls } = createTransport({
			[`GET /repos/${SLUG}`]: { body: { default_branch: "main" } },
			[`POST /repos/${SLUG}/actions/workflows/${PROMOTION_WORKFLOW_FILE}/dispatches`]: { status: 204 },
		});
		const client = {
			get: (path, options) => fetchVia(fetchImpl, "GET", path, options),
			post: (path, options) => fetchVia(fetchImpl, "POST", path, options),
		};
		expect(await requestPromotion(client, { owner: OWNER, repo: REPO })).toEqual({ dispatched: true });
		expect(calls[1].key).toBe(`POST /repos/${SLUG}/actions/workflows/${PROMOTION_WORKFLOW_FILE}/dispatches`);
		expect(calls[1].body).toEqual({ ref: "main", inputs: { dry_run: "false" } });
	});
});

async function fetchVia(fetchImpl, method, path, options = {}) {
	const url = new URL(`https://api.github.com${path}`);
	for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));
	const response = await fetchImpl(url.toString(), {
		method,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();
	return { status: response.status, data: text.length > 0 ? JSON.parse(text) : undefined, ok: response.ok };
}

describe("auto-merge run", () => {
	function happyRoutes(pr = pullRequest()) {
		return {
			[`GET /repos/${SLUG}/pulls/7`]: { body: pr },
			[`GET /repos/${SLUG}/commits/head111/check-runs`]: { body: { total_count: 6, check_runs: greenCheckRuns() } },
			[`GET /repos/${SLUG}/commits/merge222/check-runs`]: { body: { total_count: 6, check_runs: [] } },
			[`PUT /repos/${SLUG}/pulls/7/merge`]: { body: { sha: "squash33" } },
			[`DELETE /repos/${SLUG}/git/refs/heads/fix/reader`]: { status: 204 },
			[`GET /repos/${SLUG}/issues/7/comments`]: { body: [] },
			[`POST /repos/${SLUG}/issues/7/comments`]: { body: { id: 99 } },
			[`GET /repos/${SLUG}`]: { body: { default_branch: "main" } },
			[`POST /repos/${SLUG}/actions/workflows/${PROMOTION_WORKFLOW_FILE}/dispatches`]: { status: 204 },
		};
	}

	it("merges, cleans up, comments and triggers the promotion", async () => {
		const { fetchImpl, calls } = createTransport(happyRoutes());
		const result = await runAutoMerge({
			env: env({ workflow_run: { head_sha: "head111", pull_requests: [{ number: 7 }] } }),
			fetchImpl,
			log: () => {},
		});
		expect(result).toEqual({ merged: [{ number: 7, sha: "squash33" }], skipped: [] });
		const comment = calls.find((call) => call.key === `POST /repos/${SLUG}/issues/7/comments`);
		expect(comment.body).toContain(AUTOMATION_COMMENT_MARKER);
		expect(comment.body).toContain("Merged into `dev`");
		expect(comment.body).toContain("promoted to `main`");
		expect(calls.map((call) => call.key)).toContain(
			`POST /repos/${SLUG}/actions/workflows/${PROMOTION_WORKFLOW_FILE}/dispatches`,
		);
	});

	it("finds the pull request through the head commit when the event has none", async () => {
		const routes = happyRoutes();
		routes[`GET /repos/${SLUG}/commits/head111/pulls`] = { body: [{ number: 7 }] };
		const { fetchImpl } = createTransport(routes);
		const result = await runAutoMerge({
			env: env({ workflow_run: { head_sha: "head111" } }, "auto-merge-head"),
			fetchImpl,
			log: () => {},
		});
		expect(result.merged).toHaveLength(1);
	});

	it("explains a hold instead of merging, without touching the branch", async () => {
		const routes = happyRoutes();
		routes[`GET /repos/${SLUG}/commits/head111/check-runs`] = {
			body: {
				total_count: 6,
				check_runs: greenCheckRuns().map((run) =>
					run.name === "check + quality tests" ? { ...run, conclusion: "failure" } : run,
				),
			},
		};
		delete routes[`PUT /repos/${SLUG}/pulls/7/merge`];
		const { fetchImpl, calls } = createTransport(routes);
		const result = await runAutoMerge({
			env: env({ pull_request: { number: 7 } }, "auto-merge-blocked"),
			fetchImpl,
			log: () => {},
		});
		expect(result.merged).toEqual([]);
		expect(result.skipped).toHaveLength(1);
		const comment = calls.find((call) => call.key === `POST /repos/${SLUG}/issues/7/comments`);
		expect(comment.body).toContain("Auto-merge is on hold");
		expect(comment.body).toContain("check + quality tests (failure)");
	});

	it("comments the refusal when GitHub rejects the merge itself", async () => {
		const routes = happyRoutes();
		routes[`PUT /repos/${SLUG}/pulls/7/merge`] = { status: 405, body: { message: "Pull request is not mergeable" } };
		const { fetchImpl, calls } = createTransport(routes);
		const result = await runAutoMerge({
			env: env({ pull_request: { number: 7 } }, "auto-merge-refused"),
			fetchImpl,
			log: () => {},
		});
		expect(result.merged).toEqual([]);
		const comment = calls.find((call) => call.key === `POST /repos/${SLUG}/issues/7/comments`);
		expect(comment.body).toContain("Pull request is not mergeable");
	});

	it("stays silent for a pull request that did not opt in", async () => {
		const routes = happyRoutes(pullRequest({ labels: [] }));
		delete routes[`PUT /repos/${SLUG}/pulls/7/merge`];
		delete routes[`GET /repos/${SLUG}/issues/7/comments`];
		delete routes[`POST /repos/${SLUG}/issues/7/comments`];
		const { fetchImpl } = createTransport(routes);
		const result = await runAutoMerge({
			env: env({ pull_request: { number: 7 } }, "auto-merge-unlabelled"),
			fetchImpl,
			log: () => {},
		});
		expect(result).toEqual({
			merged: [],
			skipped: [{ number: 7, report: expect.objectContaining({ eligible: false }) }],
		});
	});

	it("does nothing when the event carries no pull request", async () => {
		const { fetchImpl } = createTransport({});
		const result = await runAutoMerge({
			env: env({ workflow_run: {} }, "auto-merge-empty"),
			fetchImpl,
			log: () => {},
		});
		expect(result).toEqual({ merged: [], skipped: [] });
	});
});

describe("auto-merge comment", () => {
	it("keeps the paragraphs of the merged message apart", () => {
		const body = renderAutomationComment({
			pullRequest: pullRequest(),
			report: { blocked: [], waiting: [] },
			merged: true,
		});
		expect(body).toContain("\n\n");
	});

	it("lists the reasons a labelled pull request is held back", () => {
		const body = renderAutomationComment({
			pullRequest: pullRequest(),
			report: { blocked: ["the branch has conflicts"], waiting: [] },
		});
		expect(body).toContain("Auto-merge is on hold");
		expect(body).toContain("- the branch has conflicts");
		expect(body).toContain("updates itself");
	});
});

const WORKFLOW_DIR = join(repoRoot, ".github/workflows");

function workflow(name) {
	return readFileSync(join(WORKFLOW_DIR, name), "utf8");
}

describe("pr-automation workflow", () => {
	const source = workflow("pr-automation.yml");

	it("re-evaluates on every relevant event", () => {
		expect(source).toContain("pull_request_target:");
		expect(source).toContain("workflow_run:");
		expect(source).toContain("- labeled");
		// The merge job decides from check runs, so a finished workflow has to wake it up.
		for (const name of ["quality", "desktop-packaged", "im-gateway", "kotlin", "mobile-apple", "docs-site"]) {
			expect(source).toContain(`      - ${name}`);
		}
	});

	it("can be switched off with a repository variable", () => {
		expect(source.match(/vars\.ASTRAVIA_AUTOMATION_ENABLED != 'false'/g)).toHaveLength(2);
	});

	it("keeps the write permissions in the merge job only", () => {
		const [head, tail] = source.split("  merge:");
		expect(head).toContain("pull-requests: write");
		expect(tail).toContain("contents: write");
		expect(tail).toContain("actions: write");
		expect(head).not.toContain("contents: write");
	});

	it("never checks out pull request code", () => {
		expect(source).toContain("ref: ${{ github.event.pull_request.base.sha }}");
		expect(source).not.toContain("head.sha");
	});

	it("runs the two modes of the automation", () => {
		expect(source).toContain("node scripts/quality/pr-quality.mjs --sync");
		expect(source).toContain("node scripts/quality/pr-auto-merge.mjs");
		expect(source).toContain("${{ secrets.ASTRAVIA_AUTOMATION_TOKEN || secrets.GITHUB_TOKEN }}");
	});
});

describe("path-scoped checks", () => {
	// A renamed packaged E2E job would make the gate ignore a real failure.
	it("exists as a matrix job in the packaging workflow", () => {
		const source = workflow("desktop-packaged.yml");
		for (const check of PATH_SCOPED_CHECKS) {
			const platform = check.replace(" packaged E2E", "");
			expect(source).toContain(`platform: ${platform}`);
		}
		expect(source).toContain("name: ${{ matrix.platform }} packaged E2E");
	});
});
