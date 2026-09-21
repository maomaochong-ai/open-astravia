import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeResourceAccess } from "@vetta/runtime-node/host";
import { createLoopbackSshConnection } from "@vetta/ssh-transport/testing";
import { describe, expect, it } from "vitest";
import { createProjectResourceAccess } from "./project-resource-access.js";

function createAccess() {
	const connection = createLoopbackSshConnection();
	const requestedHosts: string[] = [];
	const access = createProjectResourceAccess(createNodeResourceAccess(), (hostId) => {
		requestedHosts.push(hostId);
		return connection;
	});
	return { access, requestedHosts };
}

describe("路径运算认得远程项目的 URI", () => {
	const { paths } = createAccess().access;

	it("向上遍历停在远端根目录，不会穿进本机的祖先目录", () => {
		// 回归：交给 node:path 时 resolve 得到 `<进程 cwd>/ssh:/h/srv/app`，随后一路向上
		// 经过本机 cwd 及其祖先，把本机的 AGENTS.md 当成远端项目的规则读进来。
		const visited: string[] = [];
		let current = paths.resolve("ssh://h1/srv/app/packages/web");
		for (;;) {
			visited.push(current);
			const parent = paths.dirname(current);
			if (parent === current) break;
			current = parent;
		}
		expect(visited).toEqual([
			"ssh://h1/srv/app/packages/web",
			"ssh://h1/srv/app/packages",
			"ssh://h1/srv/app",
			"ssh://h1/srv",
			"ssh://h1/",
		]);
	});

	it("由远程 cwd 拼出的路径仍然属于远端", () => {
		expect(paths.join("ssh://h1/srv/app", ".agents", "skills")).toBe("ssh://h1/srv/app/.agents/skills");
		expect(paths.resolve("ssh://h1/srv/app", "../lib/AGENTS.md")).toBe("ssh://h1/srv/lib/AGENTS.md");
		expect(paths.isAbsolute("ssh://h1/srv/app")).toBe(true);
		expect(paths.basename("ssh://h1/srv/app/AGENTS.md")).toBe("AGENTS.md");
		expect(paths.relative("ssh://h1/srv/app", "ssh://h1/srv/app/docs/a.md")).toBe("docs/a.md");
	});

	it("resolve 遇到后面的本机绝对路径时以它为准，与 path.resolve 同义", () => {
		expect(paths.resolve("ssh://h1/srv/app", "/Users/me/.vetta/skills")).toBe("/Users/me/.vetta/skills");
	});

	it("本机路径原样沿用本机语义", () => {
		expect(paths.join("/work", "app")).toBe(join("/work", "app"));
		expect(paths.isAbsolute("relative/path")).toBe(false);
	});
});

describe("文件读取按路径归属分发（远端经回环 SSH）", () => {
	function createRemoteProject(): string {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-resources-")));
		mkdirSync(join(root, ".agents/skills/deploy"), { recursive: true });
		writeFileSync(join(root, "AGENTS.md"), "# 远端项目规则\n");
		writeFileSync(join(root, ".agents/skills/deploy/SKILL.md"), "---\nname: deploy\n---\n");
		symlinkSync(join(root, "AGENTS.md"), join(root, "CLAUDE.md"));
		return root;
	}

	it("读到远端项目自己的 AGENTS.md 与技能目录", async () => {
		const root = createRemoteProject();
		const { access, requestedHosts } = createAccess();
		const uri = `ssh://build-01${root}`;

		await expect(access.files.readText(`${uri}/AGENTS.md`)).resolves.toBe("# 远端项目规则\n");
		await expect(access.files.stat(`${uri}/AGENTS.md`)).resolves.toMatchObject({ kind: "file" });
		await expect(access.files.stat(`${uri}/missing.md`)).resolves.toBeUndefined();
		const entries = await access.files.readDirectory(`${uri}/.agents/skills`);
		expect(entries).toEqual([{ name: "deploy", kind: "directory", symbolicLink: false }]);
		expect(new Set(requestedHosts)).toEqual(new Set(["build-01"]));
	});

	it("符号链接按它指向的内容回答，真实路径仍带着主机归属", async () => {
		const root = createRemoteProject();
		const { access } = createAccess();
		const uri = `ssh://build-01${root}`;

		await expect(access.files.stat(`${uri}/CLAUDE.md`)).resolves.toMatchObject({ kind: "file" });
		await expect(access.files.realPath(`${uri}/CLAUDE.md`)).resolves.toBe(`${uri}/AGENTS.md`);
	});

	it("本机路径不经过 SSH", async () => {
		const root = createRemoteProject();
		const { access, requestedHosts } = createAccess();

		await expect(access.files.readText(join(root, "AGENTS.md"))).resolves.toBe("# 远端项目规则\n");
		expect(requestedHosts).toEqual([]);
	});
});
