import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginFileExplorerEntry } from "@astravia-org/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseStatus } from "../src/git/parseStatus";
import { resolveRepoAnchor, statusPorcelain } from "../src/git/run";
import { setGitCommand } from "../src/git/runtime";
import { FileStatusBadges, buildStatusCodes } from "../src/git/statusBadges";

let root: string;

const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function entry(path: string, isDirectory = false): PluginFileExplorerEntry {
	return { name: path.slice(path.lastIndexOf("/") + 1), path, isDirectory, size: 0, modifiedAt: 0 };
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "astravia-status-badges-"));
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.com");
	git("config", "core.hooksPath", join(root, "no-hooks"));
	git("config", "commit.gpgsign", "false");
	git("config", "core.autocrlf", "false");
	setGitCommand({
		run: async (command: string, args: string[], options?: { cwd?: string }) => {
			try {
				const stdout = execFileSync(command, args, {
					cwd: options?.cwd ?? root,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				});
				return { stdout, stderr: "", exitCode: 0 };
			} catch (error) {
				const failed = error as { stdout?: string; stderr?: string; status?: number };
				return { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", exitCode: failed.status ?? 1 };
			}
		},
	} as never);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("git status → file tree badges", () => {
	it("marks edited, staged-new and untracked files on their absolute paths", async () => {
		writeFileSync(join(root, "edited.ts"), "export const a = 1;\n");
		git("add", "edited.ts");
		git("commit", "-m", "init");
		writeFileSync(join(root, "edited.ts"), "export const a = 2;\n");
		writeFileSync(join(root, "added.ts"), "export const b = 1;\n");
		git("add", "added.ts");
		writeFileSync(join(root, "untracked.md"), "# note\n");

		const anchor = await resolveRepoAnchor(root);
		expect(anchor?.prefix).toBe("");
		// macOS 的 /var 是 /private/var 的软链接：git 给出的是真实路径，宿主看到的是软链接路径，
		// 标记必须仍然对得上。
		expect(anchor?.root.endsWith(root.replace(/^\/var\//, "/private/var/"))).toBe(true);

		const badges = new FileStatusBadges();
		badges.replace([
			{
				workspaceRoot: root,
				codes: buildStatusCodes(parseStatus(await statusPorcelain(anchor?.root ?? root))),
				repoPrefix: "",
			},
		]);

		const provider = badges.provider();
		expect(provider.provideDecoration(entry(join(root, "edited.ts")))?.badge).toBe("M");
		expect(provider.provideDecoration(entry(join(root, "added.ts")))?.badge).toBe("A");
		expect(provider.provideDecoration(entry(join(root, "untracked.md")))?.badge).toBe("U");
		// 已提交的文件没有标记，目录也不打字母（父目录由宿主的 propagate 撑起来）。
		expect(provider.provideDecoration(entry(join(root, "edited.ts").replace("edited.ts", "README.md")))).toBeNull();
		expect(provider.provideDecoration(entry(root, true))).toBeNull();
	});
});
