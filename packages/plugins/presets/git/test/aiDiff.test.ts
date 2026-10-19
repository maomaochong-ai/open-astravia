import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginFsApi } from "@astravia-org/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDiff } from "../src/git/aiMessage";
import { setFsApi, setGitCommand } from "../src/git/runtime";

let root: string;
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "astravia-ai-diff-"));
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.com");
	git("config", "core.hooksPath", join(root, "no-hooks"));
	git("config", "commit.gpgsign", "false");
	git("config", "core.autocrlf", "false");

	// The host fs API, restricted to this fixture so a runaway path is visible.
	setFsApi({
		readFile: async (path: string) => {
			if (!path.startsWith(`${root}/`)) throw new Error(`fs read escaped fixture: ${path}`);
			return { content: readFileSync(path, "utf8"), encoding: "utf8" as const };
		},
	} as unknown as PluginFsApi);
	setGitCommand({
		run: async (_file, args = [], options) => {
			if (options?.cwd !== root) throw new Error("Fixture command escaped temporary repository");
			try {
				return { exitCode: 0, stdout: execFileSync("git", args, { cwd: root, encoding: "utf8" }), stderr: "" };
			} catch (error) {
				const failure = error as { status?: number; stderr?: Buffer };
				return { exitCode: failure.status ?? 1, stdout: "", stderr: failure.stderr?.toString() ?? "" };
			}
		},
	});
});

afterEach(() => {
	if (root.startsWith(join(tmpdir(), "astravia-ai-diff-"))) rmSync(root, { recursive: true, force: true });
});

describe("commit-message diff collection", () => {
	it("includes files git has never seen, since the commit button stages them too", async () => {
		writeFileSync(join(root, "tracked.txt"), "one\n");
		git("add", "--", "tracked.txt");
		git("commit", "-m", "initial");
		writeFileSync(join(root, "tracked.txt"), "one\ntwo\n");
		writeFileSync(join(root, "brand-new.ts"), "export const answer = 42;\n");

		const diff = await readDiff(root, "worktree");

		expect(diff).toContain("+two");
		expect(diff).toContain("+++ b/brand-new.ts");
		expect(diff).toContain("+export const answer = 42;");
	});

	it("still describes a repository that has no commit yet", async () => {
		writeFileSync(join(root, "staged.txt"), "staged\n");
		git("add", "--", "staged.txt");
		writeFileSync(join(root, "loose.txt"), "loose\n");

		const diff = await readDiff(root, "worktree");

		expect(diff).toContain("+staged");
		expect(diff).toContain("loose.txt");
	});

	it("leaves untracked files out when the commit records the index alone", async () => {
		writeFileSync(join(root, "staged.txt"), "staged\n");
		git("add", "--", "staged.txt");
		writeFileSync(join(root, "loose.txt"), "loose\n");

		const diff = await readDiff(root, "index");

		expect(diff).toContain("+staged");
		expect(diff).not.toContain("loose.txt");
	});
});
