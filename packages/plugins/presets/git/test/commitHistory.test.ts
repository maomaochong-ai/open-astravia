import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBranchAtCommit, detachAtCommit, readHeadState, resetToCommit } from "../src/git/commitActions";
import { commitFileDiff, commitFiles } from "../src/git/log";
import { parseNameStatus } from "../src/git/parseLog";
import { setGitCommand } from "../src/git/runtime";

let root: string;
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let initial: string;
let latest: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "vetta-git-history-"));
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.com");
	git("config", "core.hooksPath", join(root, "no-hooks"));
	git("config", "commit.gpgsign", "false");
	git("config", "core.autocrlf", "false");
	writeFileSync(join(root, "first.txt"), "one\n");
	writeFileSync(join(root, "second.txt"), "two\n");
	git("add", "--", "first.txt", "second.txt");
	git("commit", "-m", "initial");
	initial = git("rev-parse", "HEAD");
	git("mv", "first.txt", "renamed.txt");
	writeFileSync(join(root, "second.txt"), "changed\n");
	git("add", "--", "second.txt");
	git("commit", "-m", "rename and edit");
	latest = git("rev-parse", "HEAD");
	setGitCommand({
		run: async (_file, args = [], options) => {
			if (options?.cwd !== root) throw new Error("Fixture command escaped temporary repository");
			return { exitCode: 0, stdout: execFileSync("git", args, { cwd: root, encoding: "utf8" }), stderr: "" };
		},
	});
});
afterEach(() => {
	if (root.startsWith(join(tmpdir(), "vetta-git-history-"))) rmSync(root, { recursive: true, force: true });
});

describe("history commands in an isolated repository", () => {
	it("returns all root/normal/merge files and preserves a rename diff", async () => {
		expect(parseNameStatus(await commitFiles(root, initial))).toHaveLength(2);
		const files = parseNameStatus(await commitFiles(root, latest));
		expect(files).toEqual([
			{ path: "renamed.txt", origPath: "first.txt", code: "R" },
			{ path: "second.txt", code: "M" },
		]);
		expect(await commitFileDiff(root, latest, files[0])).toContain("rename from first.txt");
		git("checkout", "-b", "side", initial);
		writeFileSync(join(root, "third.txt"), "three\n");
		git("add", "--", "third.txt");
		git("commit", "-m", "side");
		git("checkout", "main");
		git("merge", "--no-ff", "side", "-m", "merge");
		expect(parseNameStatus(await commitFiles(root, git("rev-parse", "HEAD")))).toEqual([
			{ path: "third.txt", code: "A" },
		]);
	});

	it("creates a branch at the selected commit without switching, then detaches safely", async () => {
		await createBranchAtCommit(root, initial, "feature/history");
		expect(git("rev-parse", "feature/history")).toBe(initial);
		expect(git("branch", "--show-current")).toBe("main");
		await detachAtCommit(root, initial);
		expect(await readHeadState(root)).toEqual({ hash: initial, branch: null });
	});

	it.each(["soft", "mixed", "hard"] as const)(
		"applies %s reset with its promised index/working-tree behavior",
		async (mode) => {
			writeFileSync(join(root, "second.txt"), "uncommitted\n");
			git("add", "--", "second.txt");
			const index = git("write-tree");
			await resetToCommit(root, initial, mode, await readHeadState(root));
			expect(git("rev-parse", "HEAD")).toBe(initial);
			expect(readFileSync(join(root, "second.txt"), "utf8")).toBe(mode === "hard" ? "two\n" : "uncommitted\n");
			expect(git("write-tree")).toBe(mode === "soft" ? index : git("rev-parse", `${initial}^{tree}`));
		},
	);

	it("rejects changed HEAD and unsafe branch/revision arguments before writing", async () => {
		const expected = await readHeadState(root);
		git("checkout", "-b", "other");
		await expect(resetToCommit(root, initial, "hard", expected)).rejects.toThrow("HEAD changed");
		await expect(createBranchAtCommit(root, "--help", "safe")).rejects.toThrow("Invalid commit");
		await expect(createBranchAtCommit(root, initial, "-f")).rejects.toThrow("Invalid branch");
		expect(git("rev-parse", "HEAD")).toBe(latest);
	});
});

it("preserves whitespace and special paths in the NUL-separated file inventory", () => {
	expect(parseNameStatus("M\0folder/with\ttab\nline.txt\0R100\0old name\0new name\0")).toEqual([
		{ path: "folder/with\ttab\nline.txt", code: "M" },
		{ path: "new name", origPath: "old name", code: "R" },
	]);
});
