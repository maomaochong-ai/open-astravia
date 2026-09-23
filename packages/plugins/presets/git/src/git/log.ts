import type { PluginCommandRunResult } from "@vetta-org/plugin-sdk";
import { getGitCommand } from "./runtime";
import type { BranchRef, ChangeEntry, GraphScope, GraphSelection } from "./types";

function git(cwd: string, args: string[]): Promise<PluginCommandRunResult> {
	return getGitCommand().run("git", args, { cwd });
}

// Fixed-field pretty format. git expands %x1f/%x1e into separator bytes in its
// OUTPUT, so the arg stays pure ASCII (execFile forbids NUL/control bytes in
// arguments). parseLog splits the output on 0x1f (fields) and 0x1e (records).
const LOG_FORMAT = "%H%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b%x1e";

/** List branches in a scope for the top switcher, sorted by most-recent commit. */
export async function listBranches(root: string, scope: GraphScope): Promise<BranchRef[]> {
	// refname:short and objectname contain no whitespace, so a space delimiter is safe.
	const args =
		scope === "remote"
			? ["branch", "-r", "--sort=-committerdate", "--format=%(refname:short) %(objectname)"]
			: ["branch", "--sort=-committerdate", "--format=%(refname:short) %(objectname)"];
	const res = await git(root, args);
	if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `git branch failed (exit ${res.exitCode})`);
	const out: BranchRef[] = [];
	for (const line of res.stdout.split("\n")) {
		if (!line.trim()) continue;
		const [name, head] = line.trim().split(/\s+/);
		if (!name) continue;
		// Drop the remote's symbolic HEAD (e.g. "origin/HEAD") and any bare remote name.
		if (scope === "remote" && (name.endsWith("/HEAD") || !name.includes("/"))) continue;
		out.push({ name, head: head ?? "" });
	}
	return out;
}

/** Range refspec for a selection: a specific ref, or the whole scope. */
function rangeArgs(selection: GraphSelection): string[] {
	if (selection.branch) return [selection.branch];
	return selection.scope === "remote" ? ["--remotes"] : ["--branches"];
}

/** Raw `git log` graph output for a selection window (newest first). */
export async function graphLog(root: string, selection: GraphSelection, limit: number, skip: number): Promise<string> {
	const res = await git(root, [
		"log",
		...rangeArgs(selection),
		"--date-order",
		`--max-count=${limit}`,
		`--skip=${skip}`,
		`--pretty=format:${LOG_FORMAT}`,
	]);
	if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `git log failed (exit ${res.exitCode})`);
	return res.stdout;
}

/** Raw `git show --name-status` for a commit's changed files (vs its first parent). */
export async function commitFiles(root: string, hash: string): Promise<string> {
	const res = await git(root, [
		"-c",
		"core.quotePath=false",
		"show",
		hash,
		"-m",
		"--first-parent",
		"--no-color",
		"--name-status",
		"-z",
		"--find-renames",
		"--pretty=format:",
	]);
	if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `git show failed (exit ${res.exitCode})`);
	return res.stdout;
}

/** Unified diff for one file at a commit (vs its first parent). */
export async function commitFileDiff(root: string, hash: string, entry: ChangeEntry): Promise<string> {
	const res = await git(root, [
		"--literal-pathspecs",
		"-c",
		"core.quotePath=false",
		"show",
		hash,
		"-m",
		"--first-parent",
		"--no-color",
		"--pretty=format:",
		"--find-renames",
		"--",
		...(entry.origPath ? [entry.origPath, entry.path] : [entry.path]),
	]);
	if (res.exitCode !== 0) {
		throw new Error(res.stderr.trim() || `git show failed (exit ${res.exitCode})`);
	}
	return res.stdout;
}
