import { enqueueWrite, getGitCommand } from "./runtime";

export type ResetMode = "soft" | "mixed" | "hard";
export interface HeadState {
	hash: string;
	branch: string | null;
}

async function git(root: string, args: string[]): Promise<string> {
	const result = await getGitCommand().run("git", args, { cwd: root, timeoutMs: 60_000 });
	if (result.exitCode !== 0)
		throw new Error(result.stderr.trim() || `git ${args[0]} failed (exit ${result.exitCode})`);
	return result.stdout.trim();
}

function validateHash(hash: string): void {
	if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(hash)) throw new Error("Invalid commit hash");
}

export async function readHeadState(root: string): Promise<HeadState> {
	return {
		hash: await git(root, ["rev-parse", "HEAD"]),
		branch: (await git(root, ["branch", "--show-current"])) || null,
	};
}

/** Create only: the current branch, index and working tree remain untouched. */
export function createBranchAtCommit(root: string, hash: string, name: string): Promise<void> {
	return enqueueWrite(async () => {
		validateHash(hash);
		if (!name || name.startsWith("-") || name.includes("@{")) throw new Error("Invalid branch name");
		await git(root, ["check-ref-format", "--branch", name]);
		await git(root, ["branch", "--", name, hash]);
	});
}

export function detachAtCommit(root: string, hash: string): Promise<void> {
	return enqueueWrite(async () => {
		validateHash(hash);
		await git(root, ["checkout", "--detach", hash]);
	});
}

/** Recheck the confirmed HEAD inside the shared queue so another UI write cannot change its target. */
export function resetToCommit(root: string, hash: string, mode: ResetMode, expected: HeadState): Promise<void> {
	return enqueueWrite(async () => {
		validateHash(hash);
		if (!["soft", "mixed", "hard"].includes(mode)) throw new Error("Invalid reset mode");
		const current = await readHeadState(root);
		if (current.hash !== expected.hash || current.branch !== expected.branch)
			throw new Error("HEAD changed; reopen the reset dialog.");
		await git(root, ["reset", `--${mode}`, hash, "--"]);
	});
}
