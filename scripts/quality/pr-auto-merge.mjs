#!/usr/bin/env node

/**
 * Merge a pull request once every required check is green.
 *
 * The gate is `ci-gate.mjs`: only GitHub Actions check runs count, so CodeRabbit
 * and other apps stay a review signal. Merging is opt-in — the pull request must
 * carry the `automerge` label, which `pr-quality.mjs` adds for trusted authors
 * and a maintainer can add for anyone else.
 *
 * The script never checks out pull request code: it reads the pull request, its
 * labels and its check runs through the REST API, and merges with the head SHA so
 * a force-push in between cannot slip unverified commits into the base branch.
 */

import { existsSync, readFileSync } from "node:fs";

import {
	AUTOMERGE_LABEL,
	DO_NOT_MERGE_LABEL,
	describeGate,
	evaluateCheckRuns,
	gateCheckNames,
	PATH_SCOPED_CHECKS,
} from "./ci-gate.mjs";
import { createClientFromEnv, resolveRepository, upsertPullRequestComment } from "./github-rest.mjs";
import { isDirectRun } from "./lib.mjs";
import { ALLOWED_BASE_BRANCHES, INTEGRATION_BRANCH } from "./pr-quality.mjs";

export const AUTOMATION_COMMENT_MARKER = "<!-- astravia-pr-automation -->";
export const PROMOTION_WORKFLOW_FILE = "promote-dev-to-main.yml";
export const MERGE_METHOD = "squash";
const CHECK_RUN_PAGE_LIMIT = 10;

export function readEvent(env = process.env) {
	const path = env.GITHUB_EVENT_PATH;
	if (!path || !existsSync(path)) throw new Error("GITHUB_EVENT_PATH is not set; run this from a workflow");
	return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Check runs of a pull request live on the head commit or on the test merge
 * commit, depending on the event that started the workflow; try both.
 */
export function pullRequestCheckRefs(pullRequest) {
	const refs = [pullRequest?.head?.sha, pullRequest?.merge_commit_sha];
	return [...new Set(refs.filter((ref) => typeof ref === "string" && ref.length > 0))];
}

async function collectCheckRunsForRef(client, { owner, repo, ref }) {
	const runs = [];
	for (let page = 1; page <= CHECK_RUN_PAGE_LIMIT; page += 1) {
		const { data } = await client.get(`/repos/${owner}/${repo}/commits/${ref}/check-runs`, {
			query: { filter: "latest", page },
		});
		const batch = Array.isArray(data?.check_runs) ? data.check_runs : [];
		runs.push(...batch);
		if (batch.length < 100) break;
	}
	return runs;
}

export async function collectPullRequestCheckRuns(client, { owner, repo, pullRequest }) {
	const runs = [];
	for (const ref of pullRequestCheckRefs(pullRequest)) {
		runs.push(...(await collectCheckRunsForRef(client, { owner, repo, ref })));
	}
	return runs;
}

export function normalizeLabels(labels) {
	return new Set(
		(labels ?? [])
			.map((label) => (typeof label === "string" ? label : label?.name))
			.filter((name) => typeof name === "string"),
	);
}

export function evaluateAutoMergeEligibility({ pullRequest, labels, checkRuns }) {
	const set = normalizeLabels(labels);
	const gate = evaluateCheckRuns(checkRuns, {
		required: gateCheckNames({ pullRequest: true }),
		pathScoped: PATH_SCOPED_CHECKS,
	});
	const blocked = [];
	const waiting = [];

	if (pullRequest.state !== "open") blocked.push(`pull request is ${pullRequest.state}`);
	if (!set.has(AUTOMERGE_LABEL)) blocked.push(`missing the \`${AUTOMERGE_LABEL}\` label`);
	if (set.has(DO_NOT_MERGE_LABEL)) blocked.push(`the \`${DO_NOT_MERGE_LABEL}\` label is set`);
	if (!ALLOWED_BASE_BRANCHES.includes(pullRequest.base?.ref)) {
		blocked.push(`base branch \`${pullRequest.base?.ref ?? "?"}\` is not accepted`);
	}
	if (pullRequest.mergeable === false) blocked.push("the branch has conflicts");
	if (pullRequest.mergeable === null || pullRequest.mergeable === undefined) {
		waiting.push("GitHub is still computing mergeability");
	}
	if (pullRequest.draft) waiting.push("the pull request is still a draft");
	if (gate.status === "failing") blocked.push(describeGate(gate));
	if (gate.status === "pending") waiting.push(describeGate(gate));

	return { eligible: blocked.length === 0 && waiting.length === 0, blocked, waiting, gate };
}

export function describeEligibility(report) {
	if (report.eligible) return "all required checks are green";
	if (report.blocked.length > 0) return `blocked: ${report.blocked.join("; ")}`;
	return `waiting: ${report.waiting.join("; ")}`;
}

export function renderAutomationComment({ pullRequest, report, merged, sha }) {
	if (merged) {
		const lines = [
			`Merged into \`${pullRequest.base.ref}\` as ${sha ? `\`${sha}\`` : "a squash commit"} once every required check was green.`,
		];
		if (pullRequest.base.ref === INTEGRATION_BRANCH) {
			lines.push(`\`${INTEGRATION_BRANCH}\` is promoted to \`main\` by a separate workflow run.`);
		}
		return lines.join("\n\n");
	}
	const reasons = report.blocked.length > 0 ? report.blocked : report.waiting;
	return [
		`Auto-merge is on hold because the \`${AUTOMERGE_LABEL}\` label is set but this pull request cannot merge yet:`,
		...reasons.map((reason) => `- ${reason}`),
		"",
		`This comment updates itself; no action is needed if the items above are still in progress.`,
	].join("\n");
}

export async function mergePullRequest(client, { owner, repo, pullRequest, log = () => {} }) {
	const { status, data } = await client.put(`/repos/${owner}/${repo}/pulls/${pullRequest.number}/merge`, {
		json: {
			merge_method: MERGE_METHOD,
			sha: pullRequest.head.sha,
			commit_title: `${pullRequest.title} (#${pullRequest.number})`,
		},
		tolerate: [405, 409, 422],
	});
	if (status >= 400) {
		const reason = typeof data?.message === "string" ? data.message : `HTTP ${status}`;
		log(`[auto-merge] #${pullRequest.number} merge refused: ${reason}`);
		return { merged: false, reason };
	}
	log(`[auto-merge] #${pullRequest.number} merged as ${data?.sha ?? "?"}`);
	return { merged: true, sha: data?.sha };
}

export async function deleteHeadBranch(client, { owner, repo, pullRequest, log = () => {} }) {
	const head = pullRequest.head ?? {};
	if (head.repo?.full_name !== `${owner}/${repo}`) return { deleted: false };
	const branch = head.ref;
	if (!branch || branch === INTEGRATION_BRANCH || branch === pullRequest.base?.ref) return { deleted: false };
	const path = branch.split("/").map(encodeURIComponent).join("/");
	const { status } = await client.del(`/repos/${owner}/${repo}/git/refs/heads/${path}`, { tolerate: [404, 409, 422] });
	if (status >= 400) {
		log(`[auto-merge] #${pullRequest.number} kept branch ${branch} (HTTP ${status})`);
		return { deleted: false };
	}
	log(`[auto-merge] #${pullRequest.number} deleted branch ${branch}`);
	return { deleted: true };
}

/**
 * A merge made with the default `GITHUB_TOKEN` does not start the push-triggered
 * workflows that verify the base branch, so ask the promotion workflow to look at
 * the branch directly instead of waiting for an event that will never arrive.
 */
export async function requestPromotion(client, { owner, repo, log = () => {} }) {
	const { data: repository } = await client.get(`/repos/${owner}/${repo}`);
	const ref = repository?.default_branch ?? "main";
	const { status } = await client.post(
		`/repos/${owner}/${repo}/actions/workflows/${PROMOTION_WORKFLOW_FILE}/dispatches`,
		{
			json: { ref, inputs: { dry_run: "false" } },
			tolerate: [404, 422],
		},
	);
	if (status >= 400) {
		log(
			`[auto-merge] could not dispatch ${PROMOTION_WORKFLOW_FILE} (HTTP ${status}); the promotion workflow will catch up`,
		);
		return { dispatched: false };
	}
	log(`[auto-merge] dispatched ${PROMOTION_WORKFLOW_FILE} on ${ref}`);
	return { dispatched: true };
}

export function candidatePullRequests(event) {
	const numbers = new Set();
	if (Number.isInteger(event?.pull_request?.number)) numbers.add(event.pull_request.number);
	for (const item of event?.workflow_run?.pull_requests ?? []) {
		if (Number.isInteger(item?.number)) numbers.add(item.number);
	}
	return [...numbers];
}

async function loadPullRequest(client, { owner, repo, number }) {
	const { data: pullRequest } = await client.get(`/repos/${owner}/${repo}/pulls/${number}`);
	const checkRuns = await collectPullRequestCheckRuns(client, { owner, repo, pullRequest });
	return { pullRequest, checkRuns };
}

export async function runAutoMerge({ env = process.env, fetchImpl, log = console.log } = {}) {
	const { owner, repo } = resolveRepository(env);
	const event = readEvent(env);
	const client = createClientFromEnv(env, { fetchImpl });
	let numbers = candidatePullRequests(event);
	if (numbers.length === 0 && typeof event?.workflow_run?.head_sha === "string") {
		const { items } = await client.paginate(`/repos/${owner}/${repo}/commits/${event.workflow_run.head_sha}/pulls`, {
			limit: 2,
		});
		numbers = items.map((item) => item?.number).filter((number) => Number.isInteger(number));
	}
	if (numbers.length === 0) {
		log("[auto-merge] no pull request in this event");
		return { merged: [], skipped: [] };
	}

	const merged = [];
	const skipped = [];
	for (const number of numbers) {
		const { pullRequest, checkRuns } = await loadPullRequest(client, { owner, repo, number });
		const report = evaluateAutoMergeEligibility({ pullRequest, labels: pullRequest.labels, checkRuns });
		log(`[auto-merge] #${number} ${describeEligibility(report)}`);
		const comment = (body) =>
			upsertPullRequestComment(client, { owner, repo, number, marker: AUTOMATION_COMMENT_MARKER, body, log });
		const labelled = normalizeLabels(pullRequest.labels).has(AUTOMERGE_LABEL);
		if (!report.eligible || pullRequest.state !== "open") {
			if (labelled && pullRequest.state === "open" && report.blocked.length > 0) {
				await comment(renderAutomationComment({ pullRequest, report }));
			}
			skipped.push({ number, report });
			continue;
		}
		const result = await mergePullRequest(client, { owner, repo, pullRequest, log });
		if (!result.merged) {
			// The gate said yes and GitHub said no: say why, instead of leaving the
			// `automerge` label on a pull request with no explanation.
			const refused = { ...report, blocked: [result.reason], waiting: [] };
			await comment(renderAutomationComment({ pullRequest, report: refused }));
			skipped.push({ number, report: refused });
			continue;
		}
		await deleteHeadBranch(client, { owner, repo, pullRequest, log });
		await comment(renderAutomationComment({ pullRequest, report, merged: true, sha: result.sha }));
		if (pullRequest.base.ref === INTEGRATION_BRANCH) {
			await requestPromotion(client, { owner, repo, log });
		}
		merged.push({ number, sha: result.sha });
	}
	return { merged, skipped };
}

async function main(argv = process.argv.slice(2)) {
	const dryRun = argv.includes("--dry-run");
	if (dryRun) {
		const { skipped, merged } = await runAutoMerge({});
		console.log(`[auto-merge] dry run: merged=${merged.length} skipped=${skipped.length}`);
		return;
	}
	await runAutoMerge({});
}

if (isDirectRun(import.meta.url)) {
	main().catch((error) => {
		console.error(`[auto-merge] ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
