import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import {
	canonicalRemoteFilePath,
	displayRemoteFilePath,
	isBlockedForPhone,
	isInsideSessionDirectory,
	type RemotePathContext,
	resolveRemoteFileTarget,
} from "./remote-file-paths.js";

const HOME = "/Users/me";
const CWD = "/Users/me/.vetta/conversation/s1";
const local: RemotePathContext = { cwd: CWD, home: HOME, path: posix };
const ssh: RemotePathContext = { cwd: "ssh://box/srv/app", home: HOME, path: posix };

describe("resolveRemoteFileTarget", () => {
	it("resolves links the way the chat does: relative to the session, absolute, home and file URLs", () => {
		expect(resolveRemoteFileTarget("./report.html", local)).toBe(`${CWD}/report.html`);
		expect(resolveRemoteFileTarget("out/a b.md", local)).toBe(`${CWD}/out/a b.md`);
		expect(resolveRemoteFileTarget("out/a%20b.md", local)).toBe(`${CWD}/out/a b.md`);
		expect(resolveRemoteFileTarget("<out/a b.md>", local)).toBe(`${CWD}/out/a b.md`);
		expect(resolveRemoteFileTarget("../s2/x.md", local)).toBe("/Users/me/.vetta/conversation/s2/x.md");
		expect(resolveRemoteFileTarget("/Users/me/Desktop/x.pdf", local)).toBe("/Users/me/Desktop/x.pdf");
		expect(resolveRemoteFileTarget("~/Desktop/x.pdf", local)).toBe("/Users/me/Desktop/x.pdf");
		expect(resolveRemoteFileTarget("file:///Users/me/Desktop/a%20b.pdf", local)).toBe("/Users/me/Desktop/a b.pdf");
		expect(resolveRemoteFileTarget(".", local)).toBe(CWD);
	});

	it("handles Windows paths on a Windows desktop", () => {
		const windows: RemotePathContext = { cwd: "C:\\Users\\me\\proj", home: "C:\\Users\\me", path: win32 };
		expect(resolveRemoteFileTarget("src/a.ts", windows)).toBe("C:\\Users\\me\\proj\\src\\a.ts");
		expect(resolveRemoteFileTarget("/C:/Users/me/x.md", windows)).toBe("C:\\Users\\me\\x.md");
		expect(canonicalRemoteFilePath("C:\\Users\\me\\proj\\src\\a.ts", windows)).toBe("src/a.ts");
		expect(canonicalRemoteFilePath("C:\\Users\\me\\x.md", windows)).toBe("~/x.md");
	});

	it("keeps remote project links on the project's host", () => {
		expect(resolveRemoteFileTarget("src/a.ts", ssh)).toBe("ssh://box/srv/app/src/a.ts");
		expect(resolveRemoteFileTarget("/srv/app/src/a.ts", ssh)).toBe("ssh://box/srv/app/src/a.ts");
		expect(resolveRemoteFileTarget("src/../../etc/passwd", ssh)).toBe("ssh://box/srv/etc/passwd");
		expect(resolveRemoteFileTarget("ssh://box/srv/app/b.md", ssh)).toBe("ssh://box/srv/app/b.md");
		expect(() => resolveRemoteFileTarget("~/notes.md", ssh)).toThrow(expect.objectContaining({ code: "forbidden" }));
		expect(() => resolveRemoteFileTarget("ssh://other/srv/app/b.md", ssh)).toThrow(
			expect.objectContaining({ code: "forbidden" }),
		);
	});
});

describe("canonicalRemoteFilePath", () => {
	it("never sends the session directory: relative inside it, ~ under home, absolute elsewhere", () => {
		expect(canonicalRemoteFilePath(CWD, local)).toBe("");
		expect(canonicalRemoteFilePath(`${CWD}/out/a.md`, local)).toBe("out/a.md");
		expect(canonicalRemoteFilePath("/Users/me/Desktop/x.pdf", local)).toBe("~/Desktop/x.pdf");
		expect(canonicalRemoteFilePath("/Volumes/data/x.pdf", local)).toBe("/Volumes/data/x.pdf");
		expect(canonicalRemoteFilePath("ssh://box/srv/app/src/a.ts", ssh)).toBe("src/a.ts");
		expect(canonicalRemoteFilePath("ssh://box/srv/other/a.ts", ssh)).toBe("/srv/other/a.ts");
	});

	it("round-trips through the resolver", () => {
		for (const target of [`${CWD}/out/a.md`, "/Users/me/Desktop/x.pdf", "/Volumes/data/x.pdf"]) {
			expect(resolveRemoteFileTarget(canonicalRemoteFilePath(target, local), local)).toBe(target);
		}
		for (const target of ["ssh://box/srv/app/src/a.ts", "ssh://box/srv/other/a.ts"]) {
			expect(resolveRemoteFileTarget(canonicalRemoteFilePath(target, ssh), ssh)).toBe(target);
		}
	});

	it("shows where a file lives with home abbreviated", () => {
		expect(displayRemoteFilePath(`${CWD}/out/a.md`, local)).toBe("~/.vetta/conversation/s1/out/a.md");
		expect(displayRemoteFilePath("/opt/x", local)).toBe("/opt/x");
		expect(displayRemoteFilePath("ssh://box/srv/app/a.md", ssh)).toBe("/srv/app/a.md");
	});
});

describe("isInsideSessionDirectory", () => {
	it("only admits the working directory and what is under it", () => {
		expect(isInsideSessionDirectory(CWD, local)).toBe(true);
		expect(isInsideSessionDirectory(`${CWD}/out`, local)).toBe(true);
		expect(isInsideSessionDirectory("/Users/me/.vetta/conversation/s10", local)).toBe(false);
		expect(isInsideSessionDirectory("/Users/me", local)).toBe(false);
		expect(isInsideSessionDirectory("ssh://box/srv/app/src", ssh)).toBe(true);
		expect(isInsideSessionDirectory("ssh://box/srv/application", ssh)).toBe(false);
		expect(isInsideSessionDirectory("ssh://other/srv/app/src", ssh)).toBe(false);
	});
});

describe("isBlockedForPhone", () => {
	it("blocks credentials and Vetta's own configuration", () => {
		for (const target of [
			"/Users/me/.ssh/id_ed25519",
			"/Users/me/.aws/credentials",
			"/Users/me/.config/gcloud/credentials.db",
			"/Users/me/.netrc",
			"/Users/me/Library/Keychains/login.keychain-db",
			"/Users/me/.vetta/auth.json",
			"/Users/me/.vetta/desktop-config.json",
			"/Users/me/.vetta",
			"/srv/deploy/.ssh/authorized_keys",
			"ssh://box/home/me/.ssh/id_rsa",
		]) {
			expect(isBlockedForPhone(target, local), target).toBe(true);
		}
	});

	it("leaves session workspaces, uploads and ordinary files readable", () => {
		for (const target of [
			`${CWD}/report.html`,
			"/Users/me/.vetta/remote-uploads/k/x/a.png",
			"/Users/me/.vetta/workspace/p/a.md",
			"/Users/me/Desktop/x.pdf",
			"/Users/me/.config/app.toml",
			"ssh://box/srv/app/a.md",
		]) {
			expect(isBlockedForPhone(target, local), target).toBe(false);
		}
	});
});
