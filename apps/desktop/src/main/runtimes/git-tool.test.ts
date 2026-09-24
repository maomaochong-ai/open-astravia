import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CommandResult } from "./git-detection.js";
import { type GitToolDeps, GitToolManager } from "./git-tool.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: () => undefined, warn: () => undefined }),
}));

const MANAGED_BIN = join("runtimes", "git", "2.55.0.5", "cmd");
const MANAGED_EXE = join(MANAGED_BIN, "git.exe");
const GOOD_SHA = "good-sha";

interface FakeWorld {
	deps: GitToolDeps;
	files: Set<string>;
	downloads: string[];
	commands: Map<string, CommandResult>;
	/** 按 URL 覆盖下载内容的 sha256，模拟被篡改的镜像。 */
	shaByUrl: Map<string, string>;
	installerLaunches: number;
}

function world(platform: NodeJS.Platform, pathValue: string): FakeWorld {
	const files = new Set<string>();
	const downloads: string[] = [];
	const commands = new Map<string, CommandResult>();
	const shaByUrl = new Map<string, string>();
	let lastUrl = "";
	const fake: FakeWorld = {
		files,
		downloads,
		commands,
		shaByUrl,
		installerLaunches: 0,
		deps: {
			platform,
			env: { PATH: pathValue },
			exists: (path) => files.has(path),
			run: (command, args) =>
				commands.get([command, ...args].join(" ")) ?? { status: 1, stdout: "", stderr: "missing" },
			readOsRelease: () => "ID=ubuntu",
			launchXcodeInstaller: () => {
				fake.installerLaunches += 1;
			},
			download: async (url, dest) => {
				downloads.push(url);
				lastUrl = url;
				if (url.includes("unreachable")) throw new Error("HTTP 404");
				writeFileSync(dest, "zip");
			},
			sha256File: async () => shaByUrl.get(lastUrl) ?? GOOD_SHA,
			extractArchive: async () => {
				files.add(MANAGED_EXE);
			},
			managed: {
				entry: platform === "win32" ? { filename: "MinGit-2.55.0.5-64-bit.zip", sha256: GOOD_SHA } : undefined,
				version: "2.55.0.5",
				tag: "v2.55.0.windows.5",
				sources: ["https://mirror.example/{tag}/{filename}", "https://github.example/{tag}/{filename}"],
				binDir: MANAGED_BIN,
				executablePath: MANAGED_EXE,
				installDir: join("runtimes", "git", "2.55.0.5"),
				cacheDir: mkdtempSync(join(tmpdir(), "vetta-git-tool-")),
			},
		},
	};
	return fake;
}

describe("GitToolManager on Windows", () => {
	it("installs MinGit for Vetta when git is missing and puts it at the end of PATH", async () => {
		const w = world("win32", "C:\\Windows\\System32");
		const manager = new GitToolManager(w.deps);

		expect(manager.getStatus()).toEqual({
			available: false,
			install: { kind: "managed-download", version: "2.55.0.5" },
		});

		w.shaByUrl.set("https://mirror.example/v2.55.0.windows.5/MinGit-2.55.0.5-64-bit.zip", "tampered");
		const [first, second] = await Promise.all([manager.install(), manager.install()]);

		// 镜像内容校验不过就换官方源；并发点击只下载一轮。
		expect(w.downloads).toEqual([
			"https://mirror.example/v2.55.0.windows.5/MinGit-2.55.0.5-64-bit.zip",
			"https://github.example/v2.55.0.windows.5/MinGit-2.55.0.5-64-bit.zip",
		]);
		expect(first).toBe(second);
		expect(first).toMatchObject({ available: true, source: "managed", version: "2.55.0.5" });
		expect(w.deps.env.PATH).toBe(["C:\\Windows\\System32", MANAGED_BIN].join(delimiter));
		expect(existsSync(join(w.deps.managed.cacheDir, "MinGit-2.55.0.5-64-bit.zip"))).toBe(false);

		manager.applyEnv();
		expect(w.deps.env.PATH).toBe(["C:\\Windows\\System32", MANAGED_BIN].join(delimiter));
	});

	it("prefers a system git installed later over the managed copy", () => {
		const w = world("win32", "C:\\Program Files\\Git\\cmd");
		w.files.add(MANAGED_EXE);
		w.files.add("C:\\Program Files\\Git\\cmd\\git.exe");
		w.commands.set("C:\\Program Files\\Git\\cmd\\git.exe --version", {
			status: 0,
			stdout: "git version 2.56.0.windows.1\n",
			stderr: "",
		});

		expect(new GitToolManager(w.deps).detect()).toMatchObject({
			available: true,
			source: "system",
			version: "2.56.0",
		});
	});

	it("leaves PATH untouched when every source fails", async () => {
		const w = world("win32", "C:\\Windows");
		w.deps.managed.sources = ["https://unreachable.example/{filename}"];
		const manager = new GitToolManager(w.deps);

		await expect(manager.install()).rejects.toThrow("HTTP 404");
		expect(w.deps.env.PATH).toBe("C:\\Windows");
		expect(manager.getStatus().available).toBe(false);
	});
});

describe("GitToolManager on macOS", () => {
	it("opens the system installer and unblocks git once Command Line Tools appear", async () => {
		const w = world("darwin", "/usr/bin:/bin");
		w.files.add("/usr/bin/git");
		w.commands.set("xcode-select -p", { status: 2, stdout: "", stderr: "" });
		const manager = new GitToolManager(w.deps);

		const status = await manager.install();
		expect(w.installerLaunches).toBe(1);
		expect(status).toEqual({ available: false, install: { kind: "xcode-clt" } });
		expect(manager.shouldBlockGitCommand()).toBe(true);

		w.commands.set("xcode-select -p", { status: 0, stdout: "/Library/Developer/CommandLineTools\n", stderr: "" });
		w.files.add("/Library/Developer/CommandLineTools/usr/bin/git");
		w.commands.set("/usr/bin/git --version", { status: 0, stdout: "git version 2.39.5 (Apple Git-154)", stderr: "" });

		expect(manager.shouldBlockGitCommand()).toBe(false);
		expect(manager.getStatus()).toMatchObject({ available: true, source: "system", version: "2.39.5" });
	});
});

describe("GitToolManager on Linux", () => {
	it("only offers the package manager command and never blocks git", async () => {
		const w = world("linux", "/usr/bin");
		const manager = new GitToolManager(w.deps);

		expect(manager.getStatus().install).toEqual({ kind: "package-manager", command: "sudo apt install git" });
		expect(manager.shouldBlockGitCommand()).toBe(false);
		await expect(manager.install()).rejects.toThrow("not supported");
	});
});
