import type { PluginCommandRunResult } from "@vetta-org/plugin-sdk";
import { enqueueWrite, getGitCommand } from "./runtime";
import type { ChangeEntry } from "./types";

/** Max git processes in flight for a per-file fan-out (one `git diff` each). */
const FANOUT_CONCURRENCY = 8;

/**
 * Untracked files to line-count in {@link diffStat}. Each one costs a `git diff
 * --no-index` process, and `--no-index` takes exactly two paths so there is no
 * batch form; a repo without a `.gitignore` (node_modules checked in) would
 * otherwise spawn thousands of processes on every refresh. Past the cap the
 * total is reported as approximate.
 */
const UNTRACKED_STAT_LIMIT = 50;

function git(cwd: string, args: string[]): Promise<PluginCommandRunResult> {
	return getGitCommand().run("git", args, { cwd });
}

/** `Promise.all(items.map(fn))` with a ceiling on how many run at once. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			out[index] = await fn(items[index] as T);
		}
	});
	await Promise.all(workers);
	return out;
}

/** Resolve the working tree root for a directory, or null when it is not a repo. */
export async function resolveRepoRoot(cwd: string): Promise<string | null> {
	try {
		const res = await git(cwd, ["rev-parse", "--show-toplevel"]);
		if (res.exitCode === 0 && res.stdout.trim().length > 0) return res.stdout.trim();
		return null;
	} catch {
		return null;
	}
}

/** Raw `git status --porcelain=v2 -z` output (working tree + index + untracked). */
export async function statusPorcelain(root: string): Promise<string> {
	const res = await git(root, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
	if (res.exitCode !== 0) {
		throw new Error(res.stderr.trim() || `git status failed (exit ${res.exitCode})`);
	}
	return res.stdout;
}

/** Initialize a repository at the given directory. */
export function initRepo(cwd: string): Promise<void> {
	return enqueueWrite(async () => {
		const res = await git(cwd, ["init"]);
		if (res.exitCode !== 0) {
			throw new Error(res.stderr.trim() || `git init failed (exit ${res.exitCode})`);
		}
	});
}

/**
 * Unified diff text for one changed file: all uncommitted changes vs HEAD.
 * Untracked files are synthesized as an addition via `--no-index`.
 */
export async function fileDiff(root: string, entry: ChangeEntry): Promise<string> {
	if (entry.code === "U") {
		// --no-index: 0 = identical, 1 = differs (the normal case), >1 = real error.
		const res = await git(root, ["diff", "--no-index", "--", "/dev/null", entry.path]);
		if (res.exitCode !== 0 && res.exitCode !== 1) {
			throw new Error(res.stderr.trim() || `git diff failed (exit ${res.exitCode})`);
		}
		return res.stdout;
	}
	const head = await git(root, ["diff", "HEAD", "--", entry.path]);
	if (head.exitCode === 0 || head.exitCode === 1) return head.stdout;
	// No HEAD yet (repo without commits): combine staged + unstaged.
	const staged = await git(root, ["diff", "--cached", "--", entry.path]);
	if (staged.stdout.trim().length > 0) return staged.stdout;
	const unstaged = await git(root, ["diff", "--", entry.path]);
	return unstaged.stdout;
}

/** Commits the upstream is ahead/behind by, or null when there is no upstream. */
export async function aheadBehind(root: string): Promise<{ ahead: number; behind: number } | null> {
	const res = await git(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
	if (res.exitCode !== 0) return null;
	const [behind, ahead] = res.stdout.trim().split(/\s+/).map(Number);
	if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null;
	return { ahead, behind };
}

/** Sum the +/- columns of `--numstat` output (binary rows show "-" and are skipped). */
function sumNumstat(out: string, addsOnly = false): { a: number; d: number } {
	let a = 0;
	let d = 0;
	for (const line of out.split("\n")) {
		if (!line.trim()) continue;
		const parts = line.split("\t");
		if (parts.length < 2) continue;
		const na = Number(parts[0]);
		const nd = Number(parts[1]);
		if (Number.isFinite(na)) a += na;
		if (!addsOnly && Number.isFinite(nd)) d += nd;
	}
	return { a, d };
}

/**
 * Added/deleted line totals across all uncommitted changes, including untracked
 * files. `untrackedTruncated` marks the totals as a lower bound: more untracked
 * files existed than {@link UNTRACKED_STAT_LIMIT} allowed us to count.
 */
export async function diffStat(root: string): Promise<{ additions: number; deletions: number; untrackedTruncated: boolean }> {
	let additions = 0;
	let deletions = 0;

	const head = await git(root, ["diff", "HEAD", "--numstat"]);
	if (head.exitCode === 0) {
		const s = sumNumstat(head.stdout);
		additions += s.a;
		deletions += s.d;
	} else {
		// No HEAD yet: combine staged + unstaged.
		const cached = sumNumstat((await git(root, ["diff", "--cached", "--numstat"])).stdout);
		const unstaged = sumNumstat((await git(root, ["diff", "--numstat"])).stdout);
		additions += cached.a + unstaged.a;
		deletions += cached.d + unstaged.d;
	}

	// Untracked files: every line counts as an addition (one --no-index diff each),
	// capped and rate-limited — see UNTRACKED_STAT_LIMIT.
	const others = await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
	const files = others.stdout.split("\0").filter(Boolean);
	const counted = files.slice(0, UNTRACKED_STAT_LIMIT);
	const adds = await mapLimit(counted, FANOUT_CONCURRENCY, (f) =>
		git(root, ["diff", "--no-index", "--numstat", "--", "/dev/null", f])
			.then((r) => sumNumstat(r.stdout, true).a)
			.catch(() => 0),
	);
	additions += adds.reduce((sum, n) => sum + n, 0);

	return { additions, deletions, untrackedTruncated: files.length > counted.length };
}

/**
 * Added/deleted line totals for a specific set of change entries (not the whole
 * tree) — used by the turn card to stat only THIS turn's files. Untracked
 * entries count every line as an addition via `--no-index`.
 */
export async function diffStatForEntries(
	root: string,
	entries: readonly ChangeEntry[],
): Promise<{ additions: number; deletions: number }> {
	const per = await mapLimit(entries, FANOUT_CONCURRENCY, async (entry) => {
		if (entry.code === "U") {
			const r = await git(root, ["diff", "--no-index", "--numstat", "--", "/dev/null", entry.path]).catch(() => null);
			return r ? { a: sumNumstat(r.stdout, true).a, d: 0 } : { a: 0, d: 0 };
		}
		const head = await git(root, ["diff", "HEAD", "--numstat", "--", entry.path]);
		if (head.exitCode === 0 || head.exitCode === 1) return sumNumstat(head.stdout);
		// No HEAD yet: combine staged + unstaged for this path.
		const cached = sumNumstat((await git(root, ["diff", "--cached", "--numstat", "--", entry.path])).stdout);
		const unstaged = sumNumstat((await git(root, ["diff", "--numstat", "--", entry.path])).stdout);
		return { a: cached.a + unstaged.a, d: cached.d + unstaged.d };
	});
	let additions = 0;
	let deletions = 0;
	for (const p of per) {
		additions += p.a;
		deletions += p.d;
	}
	return { additions, deletions };
}

/**
 * Run a mutating git command. NOT queued — callers inside an {@link enqueueWrite}
 * task must use this one, since enqueuing from within a queued task would wait
 * on the chain that is itself waiting on that task.
 */
async function runGitRaw(root: string, args: string[]): Promise<void> {
	const res = await getGitCommand().run("git", args, { cwd: root, timeoutMs: 60_000 });
	if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `git ${args[0]} failed (exit ${res.exitCode})`);
}

/** Run a mutating git command, serialized against every other write. */
function runGit(root: string, args: string[]): Promise<void> {
	return enqueueWrite(() => runGitRaw(root, args));
}

/** Fetch from all remotes. */
export function gitFetch(root: string): Promise<void> {
	return runGit(root, ["fetch", "--all"]);
}

/** Pull the current branch (honors the user's pull config). */
export function gitPull(root: string): Promise<void> {
	return runGit(root, ["pull"]);
}

/** Push the current branch. */
export function gitPush(root: string): Promise<void> {
	return runGit(root, ["push"]);
}

/** Sync = pull then push (push only if the pull succeeds), as one queued unit. */
export function gitSync(root: string): Promise<void> {
	return enqueueWrite(async () => {
		await runGitRaw(root, ["pull"]);
		await runGitRaw(root, ["push"]);
	});
}
