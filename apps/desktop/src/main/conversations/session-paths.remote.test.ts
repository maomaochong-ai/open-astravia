import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSessionWorkingCwd, readDesktopSessionHeader } from "./session-paths.js";

/**
 * 远程项目的 cwd 是 `ssh://<hostId>/<绝对路径>`。会话记录始终落在本机，但这个标识
 * 一路会流经若干本来只见过本地路径的函数——任何一处拿 node:path 去处理它，都会得到
 * 一个既不是远端路径、也不指向真实位置的本地路径。
 */
describe("会话路径对远程项目的处理", () => {
	it("不会为远程项目在本机建目录", async () => {
		// 拿 `ssh://…` 去 mkdir 会在进程目录下建出一个名叫 `ssh:` 的空目录。
		const scratch = await mkdtemp(join(tmpdir(), "vetta-remote-cwd-"));
		const before = await readdir(scratch);

		await ensureSessionWorkingCwd("ssh://build-01/srv/app");

		expect(await readdir(scratch)).toEqual(before);
	});

	it("仍然为本地项目建目录", async () => {
		const scratch = await mkdtemp(join(tmpdir(), "vetta-local-cwd-"));
		const target = join(scratch, "nested", "project");

		await ensureSessionWorkingCwd(target);

		expect(await readdir(join(scratch, "nested"))).toEqual(["project"]);
	});

	it("读得出远程会话的头部，不把它整条丢掉", async () => {
		// 按本地绝对路径判 cwd 会让远程项目的历史会话在列表里完全消失。
		const scratch = await mkdtemp(join(tmpdir(), "vetta-remote-header-"));
		const sessionPath = join(scratch, "session.jsonl");
		await writeFile(sessionPath, `${JSON.stringify({ type: "session", cwd: "ssh://build-01/srv/app" })}\n`);

		await expect(readDesktopSessionHeader(sessionPath)).resolves.toEqual({
			type: "session",
			cwd: "ssh://build-01/srv/app",
		});
	});

	it("仍然拒绝既不是绝对路径也不是远程标识的 cwd", async () => {
		const scratch = await mkdtemp(join(tmpdir(), "vetta-bad-header-"));
		const sessionPath = join(scratch, "session.jsonl");
		await writeFile(sessionPath, `${JSON.stringify({ type: "session", cwd: "relative/path" })}\n`);

		await expect(readDesktopSessionHeader(sessionPath)).resolves.toBeUndefined();
	});
});
