import { describe, expect, it, vi } from "vitest";
import { discoverScripts, type ScriptsFs } from "../src/scripts/discover";

/** 假的宿主文件 API：按 relPath 存文件，listFilesRecursive 按宿主合同处理 names。 */
function fakeFs(root: string, files: Record<string, string>, options: { honorNames?: boolean } = {}) {
	const entries = Object.keys(files).map((relPath) => ({
		name: relPath.slice(relPath.lastIndexOf("/") + 1),
		path: `${root}/${relPath}`,
		relPath,
	}));
	const listFilesRecursive = vi.fn<ScriptsFs["listFilesRecursive"]>(async (_root, listOptions) => {
		const names = options.honorNames === false ? undefined : listOptions?.names;
		return names ? entries.filter((entry) => names.includes(entry.name)) : entries;
	});
	const fs: ScriptsFs = {
		listFilesRecursive,
		readFile: async (path) => {
			const content = files[path.slice(root.length + 1)];
			if (content === undefined) throw new Error(`ENOENT ${path}`);
			return { content, encoding: "utf8" };
		},
	};
	return { fs, listFilesRecursive };
}

const MONOREPO = {
	"package.json": JSON.stringify({ name: "acme", packageManager: "bun@1.3.0", scripts: { dev: "turbo dev" } }),
	"bun.lock": "",
	"apps/web/package.json": JSON.stringify({ name: "@acme/web", scripts: { dev: "vite", build: "vite build" } }),
	"apps/legacy/package.json": JSON.stringify({ name: "legacy", scripts: { start: "node ." } }),
	"apps/legacy/yarn.lock": "",
	"packages/types/package.json": JSON.stringify({ name: "@acme/types" }),
	"services/api/Makefile": "run: ## 本地启动\n\tgo run .\n",
	"services/api/makefile": "ignored:\n",
	"broken/package.json": "{ not json",
	"src/index.ts": "export {};",
};

describe("discoverScripts", () => {
	it("按目录分组，根目录在前；子包继承根目录的包管理器，自带锁文件的用自己的", async () => {
		const { fs, listFilesRecursive } = fakeFs("/repo", MONOREPO);

		const projects = await discoverScripts(fs, "/repo");

		expect(listFilesRecursive).toHaveBeenCalledWith("/repo", {
			names: expect.arrayContaining(["package.json", "Makefile", "bun.lock"]),
			ignoredDirectories: expect.arrayContaining(["vendor"]),
		});
		expect(projects.map((project) => [project.relDir, project.packageManager])).toEqual([
			["", "bun"],
			["apps/legacy", "yarn"],
			["apps/web", "bun"],
			["services/api", undefined],
		]);
		const web = projects.find((project) => project.relDir === "apps/web");
		expect(web?.scripts.map((script) => [script.name, script.command, script.dir])).toEqual([
			["dev", "bun run dev", "/repo/apps/web"],
			["build", "bun run build", "/repo/apps/web"],
		]);
		// 同目录的 makefile 按 make 的查找顺序优先于 Makefile。
		const api = projects.find((project) => project.relDir === "services/api");
		expect(api?.scripts.map((script) => script.command)).toEqual(["make -f makefile ignored"]);
	});

	it("旧宿主忽略 names、列出全部文件时照样只认清单文件", async () => {
		const { fs } = fakeFs("/repo", MONOREPO, { honorNames: false });
		const projects = await discoverScripts(fs, "/repo");
		expect(projects.map((project) => project.relDir)).toEqual(["", "apps/legacy", "apps/web", "services/api"]);
	});

	it("没有锁文件也没有 packageManager 时按 npm；没有脚本的目录不出现", async () => {
		const { fs } = fakeFs("/solo", {
			"package.json": JSON.stringify({ scripts: { test: "vitest" } }),
			"docs/package.json": JSON.stringify({ name: "docs" }),
		});
		const projects = await discoverScripts(fs, "/solo");
		expect(projects).toHaveLength(1);
		expect(projects[0]?.scripts[0]?.command).toBe("npm run test");
	});

	it("远程项目的路径原样作为终端 cwd", async () => {
		const { fs } = fakeFs("ssh://build-01/srv/app", { "Makefile": "deploy:\n" });
		const [project] = await discoverScripts(fs, "ssh://build-01/srv/app");
		expect(project?.dir).toBe("ssh://build-01/srv/app");
		expect(project?.scripts[0]?.dir).toBe("ssh://build-01/srv/app");
	});
});
