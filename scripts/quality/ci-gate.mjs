/**
 * The single source of truth for the CI checks and labels that gate a merge.
 *
 * Check names must match the `name:` of the workflow jobs in `.github/workflows`:
 * a rename there silently weakens every gate that reads this file.
 *
 * Only GitHub Actions check runs count. CodeRabbit and every other app are a
 * review signal we keep, never a merge gate, so `evaluateCheckRuns` filters by
 * the app that produced the check run.
 */

export const GITHUB_ACTIONS_APP_SLUG = "github-actions";

/** Runs on every branch push and on every pull request. */
export const BRANCH_GATE_CHECKS = [
	"check + quality tests",
	"affected unit tests (ubuntu-latest)",
	"affected unit tests (windows-latest)",
	"Desktop packaging contract",
	"Detect packaged smoke scope",
];

/** Only a pull request produces this one; a branch push never does. */
export const PULL_REQUEST_GATE_CHECKS = ["PR conventions"];

/** Path-filtered: no check run at all means packaging was not affected. */
export const PATH_SCOPED_CHECKS = ["Windows packaged E2E", "macOS packaged E2E", "Linux packaged E2E"];

export const PASSING_CONCLUSIONS = ["success", "skipped", "neutral"];

export function gateCheckNames({ pullRequest = false } = {}) {
	return pullRequest ? [...BRANCH_GATE_CHECKS, ...PULL_REQUEST_GATE_CHECKS] : [...BRANCH_GATE_CHECKS];
}

function latestRunsByName(checkRuns) {
	const latest = new Map();
	for (const run of checkRuns ?? []) {
		if (run?.app?.slug !== GITHUB_ACTIONS_APP_SLUG) continue;
		const name = run?.name;
		if (typeof name !== "string") continue;
		const previous = latest.get(name);
		if (!previous || (run.id ?? 0) > (previous.id ?? 0)) latest.set(name, run);
	}
	return latest;
}

/**
 * Reduce the check runs of one commit to `ready` / `pending` / `failing`.
 *
 * `pending` covers both "still running" and "has not been reported yet", which is
 * what a caller needs: come back on the next event instead of deciding now.
 */
export function evaluateCheckRuns(checkRuns, { required = [], pathScoped = [] } = {}) {
	const latest = latestRunsByName(checkRuns);
	const missing = [];
	const pending = [];
	const failures = [];

	const inspect = (name, optional) => {
		const run = latest.get(name);
		if (!run) {
			if (!optional) missing.push(name);
			return;
		}
		if (run.status !== "completed") {
			pending.push(name);
			return;
		}
		const conclusion = run.conclusion ?? "unknown";
		if (!PASSING_CONCLUSIONS.includes(conclusion)) failures.push({ name, conclusion });
	};

	for (const name of required) inspect(name, false);
	for (const name of pathScoped) inspect(name, true);

	const status = failures.length > 0 ? "failing" : pending.length > 0 || missing.length > 0 ? "pending" : "ready";
	return { status, missing, pending, failures, observed: [...latest.keys()].sort() };
}

export const AUTOMERGE_LABEL = "automerge";
export const DO_NOT_MERGE_LABEL = "do-not-merge";
export const QUALITY_BLOCKED_LABEL = "quality:blocked";
export const QUALITY_LARGE_LABEL = "quality:large";

/** Created on demand so a maintainer can label a pull request without a manual setup step. */
export const MANAGED_LABELS = [
	{
		name: AUTOMERGE_LABEL,
		color: "0e8a16",
		description: "Squash-merge once every required check is green",
	},
	{
		name: DO_NOT_MERGE_LABEL,
		color: "b60205",
		description: "Keep this pull request open: the automation must not merge it",
	},
	{
		name: QUALITY_BLOCKED_LABEL,
		color: "d93f0b",
		description: "The repository conventions check has unresolved items",
	},
	{
		name: QUALITY_LARGE_LABEL,
		color: "fbca04",
		description: "Large change: check whether it should be split",
	},
];

export function describeGate(gate) {
	if (gate.status === "ready") return "all required checks are green";
	if (gate.status === "failing") {
		const failed = gate.failures.map(({ name, conclusion }) => `${name} (${conclusion})`).join(", ");
		return `failing required checks: ${failed}`;
	}
	const waiting = [...gate.missing, ...gate.pending];
	return waiting.length > 0 ? `waiting for required checks: ${waiting.join(", ")}` : "waiting for required checks";
}
