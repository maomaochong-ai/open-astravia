import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../runtimes/manager.js", () => ({ getRuntimeManager: () => ({ shouldBlockGitCommand: () => false }) }));

import { cloneProject, deriveRepoDirName, isCloneableRepoUrl } from "./project-clone.js";

describe("isCloneableRepoUrl", () => {
	it.each([
		"https://github.com/open-astravia/open-astravia.git",
		"http://example.com/a/b",
		"ssh://git@example.com/a/b.git",
		"git@github.com:open-astravia/open-astravia.git",
		"file:///tmp/repo",
		"/tmp/repo",
	])("accepts %s", (url) => expect(isCloneableRepoUrl(url)).toBe(true));

	it.each(["", "--upload-pack=evil", "-c core.sshCommand=x", "not a url", "ftp://example.com/a"])(
		"rejects %s",
		(url) => expect(isCloneableRepoUrl(url)).toBe(false),
	);
});

describe("deriveRepoDirName", () => {
	it.each([
		["https://github.com/open-astravia/open-astravia.git", "open-astravia"],
		["https://github.com/open-astravia/open-astravia/", "open-astravia"],
		["git@github.com:open-astravia/open-astravia.git", "open-astravia"],
		["/tmp/some/repo.git", "repo"],
	])("%s → %s", (url, expected) => expect(deriveRepoDirName(url)).toBe(expected));

	it("returns null when no usable name", () => {
		expect(deriveRepoDirName("https://example.com/..")).toBeNull();
		expect(deriveRepoDirName("https://example.com/.git")).toBeNull();
	});
});

describe("cloneProject", () => {
	let root: string;
	let source: string;
	let parent: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "astravia-clone-"));
		source = join(root, "demo-repo");
		parent = join(root, "workspace");
		mkdirSync(source);
		mkdirSync(parent);
		const git = (...args: string[]): void => {
			execFileSync("git", ["-C", source, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
		};
		git("init", "-q");
		writeFileSync(join(source, "README.md"), "hello");
		git("add", ".");
		git("commit", "-q", "-m", "init");
	});

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("clones into <parent>/<repo name>", async () => {
		const result = await cloneProject({ requestId: "r1", url: `file://${source}`, parentDir: parent });
		expect(result).toEqual({ path: join(parent, "demo-repo"), name: "demo-repo" });
		expect(existsSync(join(parent, "demo-repo", "README.md"))).toBe(true);
	});

	it("refuses to overwrite an existing directory", async () => {
		mkdirSync(join(parent, "demo-repo"));
		const result = await cloneProject({ requestId: "r2", url: `file://${source}`, parentDir: parent });
		expect(result).toMatchObject({ error: { code: "target-exists" } });
	});

	it("reports git's reason and leaves no directory behind on failure", async () => {
		const result = await cloneProject({
			requestId: "r3",
			url: `file://${join(root, "missing-repo")}`,
			parentDir: parent,
		});
		expect(result).toMatchObject({ error: { code: "clone-failed" } });
		expect(existsSync(join(parent, "missing-repo"))).toBe(false);
	});

	it("rejects option-like urls before spawning git", async () => {
		const result = await cloneProject({ requestId: "r4", url: "--upload-pack=touch /tmp/x", parentDir: parent });
		expect(result).toMatchObject({ error: { code: "invalid-url" } });
	});
});
