// These assertions quote GitHub Actions expressions verbatim from the workflow YAML.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: workflow YAML is quoted verbatim
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateCheckRuns, gateCheckNames, PATH_SCOPED_CHECKS } from "./ci-gate.mjs";
import { repoRoot } from "./lib.mjs";
import {
	evaluatePromotion,
	PROMOTION_COMMENT_MARKER,
	PROMOTION_PR_TITLE_PREFIX,
	PROMOTION_SOURCE_BRANCH,
	PROMOTION_TARGET_BRANCH,
	PROMOTION_TRIGGER_WORKFLOWS,
	renderPromotionPullRequestBody,
	runPromotion,
} from "./promote-dev-to-main.mjs";

const OWNER = "maomaochong-ai";
const REPO = "open-astravia";
const SLUG = `${OWNER}/${REPO}`;
const DEV_SHA = "dev11111111111111111111111111111111111111";

function greenRuns() {
	return gateCheckNames().map((name, index) => ({
		id: index + 1,
		name,
		status: "completed",
		conclusion: "success",
		app: { slug: "github-actions" },
	}));
}

function gate(checkRuns = greenRuns()) {
	return evaluateCheckRuns(checkRuns, { required: gateCheckNames(), pathScoped: PATH_SCOPED_CHECKS });
}

const AHEAD = {
	status: "ahead",
	total_commits: 2,
	commits: [
		{ sha: "a".repeat(40), commit: { message: "feat(reader): keep the selection\n\nLong body." } },
		{ sha: "b".repeat(40), commit: { message: "fix(reader): drop the stale cache" } },
	],
};

describe("promotion decision", () => {
	it("does nothing while dev does not exist or main already contains it", () => {
		expect(evaluatePromotion({ sourceBranchExists: false, compareStatus: undefined, gate: gate() }).action).toBe(
			"nothing",
		);
		expect(evaluatePromotion({ sourceBranchExists: true, compareStatus: "identical", gate: gate() }).action).toBe(
			"nothing",
		);
		expect(evaluatePromotion({ sourceBranchExists: true, compareStatus: "behind", gate: gate() }).action).toBe(
			"nothing",
		);
	});

	it("asks a human when the histories have diverged", () => {
		const decision = evaluatePromotion({ sourceBranchExists: true, compareStatus: "diverged", gate: gate() });
		expect(decision.action).toBe("review");
		expect(decision.reasons[0]).toContain("分叉");
	});

	it("waits for a red or unfinished dev head instead of promoting it", () => {
		const failing = evaluateCheckRuns(
			greenRuns().map((run) => ({ ...run, conclusion: "failure" })),
			{
				required: gateCheckNames(),
				pathScoped: PATH_SCOPED_CHECKS,
			},
		);
		expect(
			evaluatePromotion({ sourceBranchExists: true, compareStatus: "ahead", gate: failing, observedCheckRuns: 5 })
				.action,
		).toBe("wait");
		expect(
			evaluatePromotion({ sourceBranchExists: true, compareStatus: "ahead", gate: gate([]), observedCheckRuns: 5 })
				.action,
		).toBe("wait");
	});

	it("refuses to promote a head that no workflow ever verified", () => {
		const decision = evaluatePromotion({
			sourceBranchExists: true,
			compareStatus: "ahead",
			gate: gate([]),
			observedCheckRuns: 0,
		});
		expect(decision.action).toBe("review");
		expect(decision.reasons[0]).toContain("没有任何检查记录");
	});

	it("keeps the unknown compare status as a wait", () => {
		expect(evaluatePromotion({ sourceBranchExists: true, compareStatus: "weird", gate: gate() }).action).toBe("wait");
	});

	it("fast-forwards a green, advanced dev head", () => {
		expect(evaluatePromotion({ sourceBranchExists: true, compareStatus: "ahead", gate: gate() }).action).toBe(
			"fast-forward",
		);
		expect(
			evaluatePromotion({ sourceBranchExists: true, compareStatus: "ahead", gate: gate(), dryRun: true }).action,
		).toBe("dry-run");
	});
});

describe("promotion pull request body", () => {
	it("lists the commits and prescribes a merge commit", () => {
		const body = renderPromotionPullRequestBody({ compare: AHEAD, reason: "分叉", sourceSha: DEV_SHA });
		expect(body.startsWith(PROMOTION_COMMENT_MARKER)).toBe(true);
		expect(body).toContain("feat(reader): keep the selection (aaaaaaa)");
		expect(body).toContain("待推进提交（2）");
		expect(body).toContain("**Create a merge commit**");
	});

	it("caps the list and says how many commits are left over", () => {
		const commits = Array.from({ length: 25 }, (_, index) => ({
			sha: String(index).repeat(7),
			commit: { message: `commit ${index}` },
		}));
		const body = renderPromotionPullRequestBody({
			compare: { status: "ahead", total_commits: 25, commits },
			reason: "分叉",
			sourceSha: DEV_SHA,
		});
		expect(body.match(/^- commit /gm)).toHaveLength(20);
		expect(body).toContain("其余 5 个");
	});

	it("still renders when the compare carries no commit list", () => {
		const body = renderPromotionPullRequestBody({
			compare: { status: "diverged" },
			reason: "分叉",
			sourceSha: DEV_SHA,
		});
		expect(body).toContain("commit 列表为空");
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

function env(name, extra = {}) {
	const root = mkdtempSync(join(tmpdir(), `astravia-${name}-`));
	eventFiles.push(root);
	const path = join(root, "event.json");
	writeFileSync(path, JSON.stringify({ workflow_run: { head_branch: PROMOTION_SOURCE_BRANCH } }));
	return { GITHUB_REPOSITORY: SLUG, GITHUB_TOKEN: "test-token", GITHUB_EVENT_PATH: path, ...extra };
}

afterEach(() => {
	for (const root of eventFiles.splice(0)) rmSync(root, { recursive: true, force: true });
});

function promotionRoutes(overrides = {}) {
	return {
		[`GET /repos/${SLUG}/branches/${PROMOTION_SOURCE_BRANCH}`]: { body: { name: "dev", commit: { sha: DEV_SHA } } },
		[`GET /repos/${SLUG}/compare/${PROMOTION_TARGET_BRANCH}...${DEV_SHA}`]: { body: AHEAD },
		[`GET /repos/${SLUG}/commits/${DEV_SHA}/check-runs`]: { body: { total_count: 5, check_runs: greenRuns() } },
		...overrides,
	};
}

describe("promotion run", () => {
	it("fast-forwards main onto the verified dev head", async () => {
		const routes = promotionRoutes({
			[`PATCH /repos/${SLUG}/git/refs/heads/${PROMOTION_TARGET_BRANCH}`]: { body: { ref: "refs/heads/main" } },
		});
		const { fetchImpl, calls } = createTransport(routes);
		const result = await runPromotion({ env: env("promote-ff"), fetchImpl, log: () => {} });
		expect(result).toEqual({ action: "fast-forward", sha: DEV_SHA });
		const patch = calls.find((call) => call.key.startsWith("PATCH"));
		expect(patch.body).toEqual({ sha: DEV_SHA, force: false });
	});

	it("falls back to a review pull request when the ref update is refused", async () => {
		const routes = promotionRoutes({
			[`PATCH /repos/${SLUG}/git/refs/heads/${PROMOTION_TARGET_BRANCH}`]: {
				status: 422,
				body: { message: "Update is not a fast forward" },
			},
			[`GET /repos/${SLUG}/pulls`]: { body: [] },
			[`POST /repos/${SLUG}/pulls`]: { body: { number: 55 } },
		});
		const { fetchImpl, calls } = createTransport(routes);
		const result = await runPromotion({ env: env("promote-refused"), fetchImpl, log: () => {} });
		expect(result).toEqual({ action: "review", number: 55, created: true });

		const lookup = calls.find((call) => call.key === `GET /repos/${SLUG}/pulls`);
		expect(decodeURIComponent(lookup.query)).toContain(`head=${OWNER}:${PROMOTION_SOURCE_BRANCH}`);
		expect(decodeURIComponent(lookup.query)).toContain(`base=${PROMOTION_TARGET_BRANCH}`);

		const created = calls.find((call) => call.key === `POST /repos/${SLUG}/pulls`);
		expect(created.body.head).toBe(PROMOTION_SOURCE_BRANCH);
		expect(created.body.base).toBe(PROMOTION_TARGET_BRANCH);
		expect(created.body.title.startsWith(PROMOTION_PR_TITLE_PREFIX)).toBe(true);
		expect(created.body.title).toContain("2 个提交");
		expect(created.body.body).toContain(PROMOTION_COMMENT_MARKER);
	});

	it("reuses the promotion pull request that is already open", async () => {
		const routes = promotionRoutes({
			[`GET /repos/${SLUG}/compare/${PROMOTION_TARGET_BRANCH}...${DEV_SHA}`]: { body: { status: "diverged" } },
			[`GET /repos/${SLUG}/pulls`]: { body: [{ number: 42 }] },
		});
		const { fetchImpl } = createTransport(routes);
		const result = await runPromotion({ env: env("promote-existing"), fetchImpl, log: () => {} });
		expect(result).toEqual({ action: "review", number: 42, created: false });
	});

	it("stops early while dev does not exist", async () => {
		const { fetchImpl, calls } = createTransport({
			[`GET /repos/${SLUG}/branches/${PROMOTION_SOURCE_BRANCH}`]: { status: 404, body: { message: "Not Found" } },
		});
		const result = await runPromotion({ env: env("promote-missing"), fetchImpl, log: () => {} });
		expect(result.action).toBe("nothing");
		expect(calls).toHaveLength(1);
	});

	it("only reports what it would do in a dry run", async () => {
		const { fetchImpl, calls } = createTransport(promotionRoutes());
		const result = await runPromotion({
			env: env("promote-dry", { PROMOTION_DRY_RUN: "true" }),
			fetchImpl,
			log: () => {},
		});
		expect(result.action).toBe("dry-run");
		expect(calls.some((call) => call.key.startsWith("PATCH"))).toBe(false);
	});
});

describe("promote-dev-to-main workflow", () => {
	const source = readFileSync(join(repoRoot, ".github/workflows/promote-dev-to-main.yml"), "utf8");

	it("wakes up on every workflow that verifies dev", () => {
		for (const file of ["pr-automation.yml", "promote-dev-to-main.yml"]) {
			const workflowFile = readFileSync(join(repoRoot, ".github/workflows", file), "utf8");
			const block = workflowFile.split("  workflow_run:")[1].split("    types:")[0];
			const names = [...block.matchAll(/^ {6}- (.+?)\s*$/gm)].map((match) => match[1]);
			expect(names).toEqual(PROMOTION_TRIGGER_WORKFLOWS);
		}
	});

	it("verifies the integration branch before touching main", () => {
		expect(source).toContain(`      - ${PROMOTION_SOURCE_BRANCH}`);
		expect(source).toContain("cron:");
		expect(source).toContain("workflow_dispatch:");
		expect(source).toContain("type: boolean");
	});

	it("is allowed to move a branch and can be switched off", () => {
		expect(source).toContain("contents: write");
		expect(source).toContain("pull-requests: write");
		expect(source).toContain("vars.ASTRAVIA_AUTOMATION_ENABLED != 'false'");
		expect(source).toContain("node scripts/quality/promote-dev-to-main.mjs");
		expect(source).toContain("${{ secrets.ASTRAVIA_AUTOMATION_TOKEN || secrets.GITHUB_TOKEN }}");
	});
});
