#!/usr/bin/env node

/**
 * Move `main` to whatever `dev` already verified.
 *
 * The promotion never guesses:
 *   - `main` is an ancestor of the `dev` head → fast-forward the ref, which is
 *     reversible and cannot lose a commit;
 *   - the histories diverged → open (or reuse) a review pull request, because a
 *     `main`-only hotfix may be part of the picture and only a human can decide;
 *   - the `dev` head carries no check run at all → a merge made with the default
 *     `GITHUB_TOKEN` does not start workflows, so ask for review instead of
 *     promoting an unverified commit.
 *
 * `workflow_run` only fires when `dev` was pushed by a human or by a token other
 * than the default `GITHUB_TOKEN`; the scheduled run and the dispatch sent by
 * `pr-auto-merge.mjs` cover the remaining cases.
 */

import { describeGate, evaluateCheckRuns, gateCheckNames, PATH_SCOPED_CHECKS } from "./ci-gate.mjs";
import { createClientFromEnv, resolveRepository } from "./github-rest.mjs";
import { isDirectRun } from "./lib.mjs";

export const PROMOTION_SOURCE_BRANCH = "dev";
export const PROMOTION_TARGET_BRANCH = "main";
export const PROMOTION_COMMENT_MARKER = "<!-- astravia-dev-promotion -->";
export const PROMOTION_PR_TITLE_PREFIX = "chore(branch): 将 dev 推进到 main";
export const PROMOTION_TITLES_IN_BODY = 20;

/** Workflows that verify `dev`; a completed run of any of them re-evaluates promotion. */
export const PROMOTION_TRIGGER_WORKFLOWS = [
	"quality",
	"desktop-packaged",
	"im-gateway",
	"kotlin",
	"mobile-apple",
	"docs-site",
];

export function evaluatePromotion({ sourceBranchExists, compareStatus, gate, observedCheckRuns = 0, dryRun = false }) {
	if (!sourceBranchExists) {
		return { action: "nothing", reasons: [`\`${PROMOTION_SOURCE_BRANCH}\` 分支不存在，无需推进`] };
	}
	if (compareStatus === "identical") {
		return {
			action: "nothing",
			reasons: [`\`${PROMOTION_TARGET_BRANCH}\` 已包含 \`${PROMOTION_SOURCE_BRANCH}\` 的全部提交`],
		};
	}
	if (compareStatus === "behind") {
		return {
			action: "nothing",
			reasons: [`\`${PROMOTION_SOURCE_BRANCH}\` 没有 \`${PROMOTION_TARGET_BRANCH}\` 缺失的提交`],
		};
	}
	if (compareStatus === "diverged") {
		return {
			action: "review",
			reasons: [`\`${PROMOTION_TARGET_BRANCH}\` 与 \`${PROMOTION_SOURCE_BRANCH}\` 已经分叉，需要人工决定`],
		};
	}
	if (compareStatus !== "ahead") {
		return { action: "wait", reasons: [`compare 返回未知状态 ${compareStatus}`] };
	}
	if (gate.status === "failing") return { action: "wait", reasons: [describeGate(gate)] };
	if (gate.status === "pending" && observedCheckRuns === 0) {
		return {
			action: "review",
			reasons: [
				"`dev` 头部提交没有任何检查记录（通常是用默认 GITHUB_TOKEN 合并导致 workflow 未触发），无法验证，改为人工合并",
			],
		};
	}
	if (gate.status === "pending") return { action: "wait", reasons: [describeGate(gate)] };
	if (dryRun)
		return { action: "dry-run", reasons: [`可以快进 ${PROMOTION_TARGET_BRANCH} 到 ${PROMOTION_SOURCE_BRANCH} 头部`] };
	return { action: "fast-forward", reasons: [] };
}

async function collectCheckRuns(client, { owner, repo, ref }) {
	const runs = [];
	for (let page = 1; page <= 10; page += 1) {
		const { data } = await client.get(`/repos/${owner}/${repo}/commits/${ref}/check-runs`, {
			query: { filter: "latest", page },
		});
		const batch = Array.isArray(data?.check_runs) ? data.check_runs : [];
		runs.push(...batch);
		if (batch.length < 100) break;
	}
	return runs;
}

export function renderPromotionPullRequestBody({ compare, reason, sourceSha }) {
	const commits = Array.isArray(compare?.commits) ? compare.commits : [];
	const total = compare?.total_commits ?? commits.length;
	const list = commits.slice(0, PROMOTION_TITLES_IN_BODY).map((item) => {
		const subject = String(item?.commit?.message ?? "")
			.split("\n")[0]
			.trim();
		const sha = String(item?.sha ?? "").slice(0, 7);
		return `- ${subject} (${sha})`;
	});
	return [
		PROMOTION_COMMENT_MARKER,
		"",
		`自动推进无法完成，需要人工合并 \`${PROMOTION_SOURCE_BRANCH}\` → \`${PROMOTION_TARGET_BRANCH}\`。`,
		"",
		`原因：${reason}`,
		"",
		`\`${PROMOTION_SOURCE_BRANCH}\` 头部提交：\`${sourceSha}\``,
		"",
		`### 待推进提交（${total}）`,
		...(list.length > 0 ? list : ["- （commit 列表为空）"]),
		total > list.length ? `- …其余 ${total - list.length} 个` : "",
		"",
		"### 合并方式",
		"",
		`请使用 **Create a merge commit**（不要 squash、不要 rebase）。这样 \`${PROMOTION_SOURCE_BRANCH}\` 的提交会成为 \`${PROMOTION_TARGET_BRANCH}\` 的祖先，下一次推进才能继续自动快进。`,
		"",
		"确认没有只存在于 `main` 的修复会被覆盖后再合并。",
	].join("\n");
}

async function openReviewPullRequest(client, { owner, repo, sourceSha, compare, reason, log }) {
	const head = `${owner}:${PROMOTION_SOURCE_BRANCH}`;
	const { data: existing } = await client.get(`/repos/${owner}/${repo}/pulls`, {
		query: { state: "open", base: PROMOTION_TARGET_BRANCH, head },
	});
	if (Array.isArray(existing) && existing.length > 0) {
		log(`[promote] 已存在待合并的推进 PR #${existing[0].number}`);
		return { action: "review", number: existing[0].number, created: false };
	}
	const total = compare?.total_commits ?? 0;
	const { data } = await client.post(`/repos/${owner}/${repo}/pulls`, {
		json: {
			title: `${PROMOTION_PR_TITLE_PREFIX}（${total} 个提交）`,
			head: PROMOTION_SOURCE_BRANCH,
			base: PROMOTION_TARGET_BRANCH,
			body: renderPromotionPullRequestBody({ compare, reason, sourceSha }),
		},
	});
	log(`[promote] 已创建推进 PR #${data?.number}`);
	return { action: "review", number: data?.number, created: true };
}

export async function runPromotion({ env = process.env, fetchImpl, log = console.log, dryRun = false } = {}) {
	const plan = dryRun || env.PROMOTION_DRY_RUN === "true";
	const { owner, repo } = resolveRepository(env);
	const client = createClientFromEnv(env, { fetchImpl });

	const { status: branchStatus, data: branch } = await client.get(
		`/repos/${owner}/${repo}/branches/${PROMOTION_SOURCE_BRANCH}`,
		{ tolerate: [404] },
	);
	const sourceBranchExists = branchStatus !== 404;
	const sourceSha = branch?.commit?.sha;
	if (!sourceBranchExists || typeof sourceSha !== "string") {
		log(`[promote] ${PROMOTION_SOURCE_BRANCH} 分支不存在，跳过`);
		return { action: "nothing", reasons: ["source branch is missing"] };
	}

	const { data: compare } = await client.get(
		`/repos/${owner}/${repo}/compare/${PROMOTION_TARGET_BRANCH}...${sourceSha}`,
	);
	const checkRuns = await collectCheckRuns(client, { owner, repo, ref: sourceSha });
	const gate = evaluateCheckRuns(checkRuns, { required: gateCheckNames(), pathScoped: PATH_SCOPED_CHECKS });
	const decision = evaluatePromotion({
		sourceBranchExists,
		compareStatus: compare?.status,
		gate,
		observedCheckRuns: checkRuns.length,
		dryRun: plan,
	});
	log(
		`[promote] ${PROMOTION_SOURCE_BRANCH}@${sourceSha.slice(0, 7)} compare=${compare?.status} ${describeGate(gate)}`,
	);
	for (const reason of decision.reasons) log(`[promote] ${reason}`);

	if (decision.action === "fast-forward") {
		const { status, data } = await client.patch(`/repos/${owner}/${repo}/git/refs/heads/${PROMOTION_TARGET_BRANCH}`, {
			json: { sha: sourceSha, force: false },
			tolerate: [409, 422],
		});
		if (status < 400) {
			log(`[promote] ${PROMOTION_TARGET_BRANCH} 已快进到 ${sourceSha}`);
			return { action: "fast-forward", sha: sourceSha };
		}
		const reason = typeof data?.message === "string" ? data.message : `HTTP ${status}`;
		log(`[promote] 快进被拒绝（${reason}），改为请求人工合并`);
		return await openReviewPullRequest(client, { owner, repo, sourceSha, compare, reason, log });
	}
	if (decision.action === "review") {
		return await openReviewPullRequest(client, {
			owner,
			repo,
			sourceSha,
			compare,
			reason: decision.reasons.join("；"),
			log,
		});
	}
	return { action: decision.action, reasons: decision.reasons };
}

async function main(argv = process.argv.slice(2)) {
	const result = await runPromotion({ dryRun: argv.includes("--dry-run") });
	console.log(`[promote] 结果：${result.action}`);
}

if (isDirectRun(import.meta.url)) {
	main().catch((error) => {
		console.error(`[promote] ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
