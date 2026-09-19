import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENTS_GUIDE_REVISION, renderAgentsGuide } from "../src/agents-template.js";
import { parsePluginDocsCommand, runPluginCommand } from "../src/command.js";
import { findPluginHub, findPluginProject, resolveManualDir } from "../src/workspace.js";

const created: string[] = [];

function scratch(): string {
	const root = mkdtempSync(join(tmpdir(), "vetta-plugin-cli-"));
	created.push(root);
	// 每个夹具都是一个独立仓库：向上查找必须停在这里，不能爬到真实的开发机目录。
	mkdirSync(join(root, ".git"), { recursive: true });
	return root;
}

function write(path: string, content: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content, "utf8");
}

function installManual(root: string, version: string): string {
	const docs = join(root, "node_modules", "@vetta-org", "plugin-sdk", "docs");
	mkdirSync(docs, { recursive: true });
	writeFileSync(join(docs, "README.md"), "# manual", "utf8");
	writeFileSync(
		join(root, "node_modules", "@vetta-org", "plugin-sdk", "package.json"),
		JSON.stringify({ name: "@vetta-org/plugin-sdk", version }),
		"utf8",
	);
	return docs;
}

afterEach(() => {
	while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
});

describe("workspace resolution", () => {
	it("finds the nearest plugin project from a nested directory", () => {
		const root = scratch();
		write(join(root, "plugins", "demo", "plugin.json"), JSON.stringify({ id: "demo", version: "1.2.3" }));
		mkdirSync(join(root, "plugins", "demo", "src"), { recursive: true });

		const project = findPluginProject(join(root, "plugins", "demo", "src"));

		expect(project?.pluginId).toBe("demo");
		expect(project?.version).toBe("1.2.3");
	});

	it("reports no project at the root of a hub that only indexes plugins", () => {
		const root = scratch();
		write(join(root, ".vetta", "marketplace.json"), JSON.stringify({ name: "hub", abilities: [] }));
		write(join(root, "plugins", "demo", "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));

		// hub 根不是任何一个插件；此时必须由调用方指定目标，而不是猜一个。
		expect(findPluginProject(root)).toBeUndefined();
		expect(findPluginHub(root)?.root).toBe(root);
	});

	it("finds the hub from inside one of its plugins", () => {
		const root = scratch();
		write(join(root, ".vetta", "marketplace.json"), JSON.stringify({ name: "hub", abilities: [] }));
		write(join(root, "plugins", "demo", "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));

		expect(findPluginHub(join(root, "plugins", "demo"))?.manifestPath).toBe(
			join(root, ".vetta", "marketplace.json"),
		);
	});

	it("resolves a manual hoisted to the repository root", () => {
		const root = scratch();
		const docs = installManual(root, "0.3.0");
		write(join(root, "plugins", "demo", "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));

		// 工作区把依赖提升到根是常态，插件目录下并没有 node_modules。
		expect(resolveManualDir(join(root, "plugins", "demo", "src"))).toBe(docs);
	});

	it("prefers the manual installed next to the plugin over the hoisted one", () => {
		const root = scratch();
		installManual(root, "0.2.0");
		const pluginRoot = join(root, "plugins", "demo");
		write(join(pluginRoot, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		const own = installManual(pluginRoot, "0.3.0");

		// 一仓多插件时各插件可以钉不同的 SDK，读到的必须是它自己编译所针对的那一份。
		expect(resolveManualDir(pluginRoot)).toBe(own);
	});

	it("stops at the repository boundary instead of walking into the real filesystem", () => {
		const root = scratch();
		mkdirSync(join(root, "nested"), { recursive: true });

		expect(findPluginProject(join(root, "nested"))).toBeUndefined();
		expect(findPluginHub(join(root, "nested"))).toBeUndefined();
	});
});

describe("installing the current project directory", () => {
	function deps(overrides: Partial<Record<string, unknown>> = {}) {
		return {
			cwd: () => process.cwd(),
			resolveNpmArchive: () => Promise.reject(new Error("unused")),
			runAction: () => Promise.resolve({ plugin: { id: "demo", version: "1.0.0" } }),
			writeStdout: () => {},
			writeStderr: () => {},
			...overrides,
		};
	}

	it("installs the archive the project packed", async () => {
		const root = scratch();
		const pluginRoot = join(root, "plugins", "demo");
		write(join(pluginRoot, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		write(join(pluginRoot, "release", "demo-1.0.0.vettapkg"), "package");
		const runAction = vi.fn().mockResolvedValue({ plugin: { id: "demo", version: "1.0.0" } });

		const code = await runPluginCommand({ type: "add", source: pluginRoot, json: false }, deps({ runAction }));

		expect(code).toBe(0);
		expect(runAction).toHaveBeenCalledWith("plugins.manage", {
			operation: "install-from-path",
			path: join(pluginRoot, "release", "demo-1.0.0.vettapkg"),
			enable: true,
		});
	});

	it("names the command to run when the project was never packed", async () => {
		const root = scratch();
		const pluginRoot = join(root, "plugins", "demo");
		write(join(pluginRoot, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		let stderr = "";

		const code = await runPluginCommand(
			{ type: "add", source: pluginRoot, json: false },
			deps({
				writeStderr: (value: string) => {
					stderr += value;
				},
			}),
		);

		expect(code).toBe(5);
		expect(stderr).toContain("vetta-plugin pack");
	});

	it("refuses to guess which plugin a hub root means", async () => {
		const root = scratch();
		write(join(root, ".vetta", "marketplace.json"), JSON.stringify({ name: "hub", abilities: [] }));
		write(join(root, "plugins", "demo", "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		let stderr = "";

		const code = await runPluginCommand(
			{ type: "add", source: root, json: false },
			deps({
				writeStderr: (value: string) => {
					stderr += value;
				},
			}),
		);

		expect(code).toBe(5);
		expect(stderr).toContain("is not one itself");
	});
});

describe("hot reload", () => {
	it("asks the host to load the nearest plugin from its project directory", async () => {
		const root = scratch();
		const pluginRoot = join(root, "plugins", "demo");
		write(join(pluginRoot, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		mkdirSync(join(pluginRoot, "src"), { recursive: true });
		const runAction = vi.fn().mockResolvedValue({ plugin: { id: "demo" } });

		const code = await runPluginCommand(
			{ type: "watch", stop: false, json: false },
			{
				// 站在插件的子目录里也应该命中这个插件。
				cwd: () => join(pluginRoot, "src"),
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction,
				writeStdout: () => {},
				writeStderr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(runAction).toHaveBeenCalledWith("plugins.manage", {
			operation: "dev-watch",
			id: "demo",
			projectDir: pluginRoot,
		});
	});

	it("stops watching without needing the project directory", async () => {
		const root = scratch();
		const pluginRoot = join(root, "demo");
		write(join(pluginRoot, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		const runAction = vi.fn().mockResolvedValue({});

		await runPluginCommand(
			{ type: "watch", stop: true, json: false },
			{
				cwd: () => pluginRoot,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction,
				writeStdout: () => {},
				writeStderr: () => {},
			},
		);

		expect(runAction).toHaveBeenCalledWith("plugins.manage", { operation: "dev-watch-stop", id: "demo" });
	});
});

describe("uninstall", () => {
	it("infers the plugin from the current directory", async () => {
		const root = scratch();
		const pluginRoot = join(root, "demo");
		write(join(pluginRoot, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		const runAction = vi.fn().mockResolvedValue({ id: "demo" });

		const code = await runPluginCommand(
			{ type: "uninstall", json: false },
			{
				cwd: () => pluginRoot,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction,
				writeStdout: () => {},
				writeStderr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(runAction).toHaveBeenCalledWith("plugins.manage", { operation: "uninstall", id: "demo" });
	});

	it("accepts an explicit id from anywhere", async () => {
		const root = scratch();
		const runAction = vi.fn().mockResolvedValue({});

		await runPluginCommand(
			{ type: "uninstall", pluginId: "other", json: false },
			{
				cwd: () => root,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction,
				writeStdout: () => {},
				writeStderr: () => {},
			},
		);

		expect(runAction).toHaveBeenCalledWith("plugins.manage", { operation: "uninstall", id: "other" });
	});

	it("says how to name the plugin when the directory cannot answer", async () => {
		const root = scratch();
		let stderr = "";

		const code = await runPluginCommand(
			{ type: "uninstall", json: false },
			{
				cwd: () => root,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction: () => Promise.reject(new Error("unused")),
				writeStdout: () => {},
				writeStderr: (value) => {
					stderr += value;
				},
			},
		);

		expect(code).toBe(5);
		expect(stderr).toContain("uninstall <plugin-id>");
	});
});

describe("docs command", () => {
	it("parses the docs command", () => {
		expect(parsePluginDocsCommand(["docs", "--json"])).toEqual({ type: "docs", json: true, checkLatest: false });
		expect(parsePluginDocsCommand(["docs", "--check-latest"])).toEqual({
			type: "docs",
			json: false,
			checkLatest: true,
		});
		expect(parsePluginDocsCommand(["add", "x"])).toBeUndefined();
	});

	it("prints where the manual is, which SDK it belongs to, and what it is looking at", async () => {
		const root = scratch();
		installManual(root, "0.3.0");
		const pluginRoot = join(root, "plugins", "demo");
		write(join(pluginRoot, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		write(join(root, ".vetta", "marketplace.json"), JSON.stringify({ name: "hub", abilities: [] }));
		let stdout = "";

		const code = await runPluginCommand(
			{ type: "docs", json: true, checkLatest: false },
			{
				cwd: () => pluginRoot,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction: () => Promise.reject(new Error("unused")),
				writeStdout: (value) => {
					stdout += value;
				},
				writeStderr: () => {},
			},
		);

		expect(code).toBe(0);
		const payload = JSON.parse(stdout) as Record<string, unknown>;
		expect(payload.sdkVersion).toBe("0.3.0");
		expect(payload.project).toMatchObject({ pluginId: "demo" });
		expect(payload.hub).toMatchObject({ root });
		// 手册是个快照，工程不升级它就不会变新。刷新命令必须每次都在输出里。
		expect(payload.refreshCommand).toContain("@vetta-org/plugin-sdk@latest");
		expect(payload).not.toHaveProperty("latestVersion");
	});

	it("reports the manual as behind when the registry has a newer SDK", async () => {
		const root = scratch();
		installManual(root, "0.3.0");
		let stdout = "";

		const code = await runPluginCommand(
			{ type: "docs", json: true, checkLatest: true },
			{
				cwd: () => root,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction: () => Promise.reject(new Error("unused")),
				readLatestSdkVersion: () => Promise.resolve("0.3.2"),
				writeStdout: (value) => {
					stdout += value;
				},
				writeStderr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(JSON.parse(stdout)).toMatchObject({ sdkVersion: "0.3.0", latestVersion: "0.3.2", outdated: true });
	});

	it("does not call the manual stale when the registry cannot be reached", async () => {
		const root = scratch();
		installManual(root, "0.3.0");
		let stdout = "";

		const code = await runPluginCommand(
			{ type: "docs", json: false, checkLatest: true },
			{
				cwd: () => root,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction: () => Promise.reject(new Error("unused")),
				// 离线、私服没有这个包：查不到就是查不到，不能因此断言手册过期。
				readLatestSdkVersion: () => Promise.resolve(undefined),
				writeStdout: (value) => {
					stdout += value;
				},
				writeStderr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(stdout).toContain("Could not reach the registry");
		expect(stdout).not.toContain("behind");
	});

	it("calls out a brief written by an older CLI", async () => {
		const root = scratch();
		installManual(root, "0.3.2");
		write(join(root, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		write(join(root, "AGENTS.md"), "<!-- vetta-guide-revision: 1 -->\n# demo\n");
		let stdout = "";

		const code = await runPluginCommand(
			{ type: "docs", json: false, checkLatest: false },
			{
				cwd: () => root,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction: () => Promise.reject(new Error("unused")),
				writeStdout: (value) => {
					stdout += value;
				},
				writeStderr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(stdout).toContain("This brief is stale");
		expect(stdout).toContain("--refresh-guide");
	});

	it("never points an unmarked brief at the overwrite command", async () => {
		const root = scratch();
		installManual(root, "0.3.2");
		write(join(root, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		// 手写的市场规范和「版本戳之前的模板」长得一样。把它判成 stale 并给出刷新命令，就是在
		// 教用户删掉自己的文件。
		write(join(root, "AGENTS.md"), "# 我们的市场规范\n");
		let stdout = "";

		const code = await runPluginCommand(
			{ type: "docs", json: false, checkLatest: false },
			{
				cwd: () => root,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction: () => Promise.reject(new Error("unused")),
				writeStdout: (value) => {
					stdout += value;
				},
				writeStderr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(stdout).toContain("looks hand-written");
		expect(stdout).toContain("--dry-run");
		expect(stdout).not.toContain("This brief is stale");
	});

	it("stays quiet about a brief this CLI just wrote", async () => {
		const root = scratch();
		installManual(root, "0.3.2");
		write(join(root, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		write(join(root, "AGENTS.md"), renderAgentsGuide({ pluginId: "demo", displayName: "Demo" }));
		let stdout = "";

		const code = await runPluginCommand(
			{ type: "docs", json: true, checkLatest: false },
			{
				cwd: () => root,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction: () => Promise.reject(new Error("unused")),
				writeStdout: (value) => {
					stdout += value;
				},
				writeStderr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(JSON.parse(stdout).guide).toEqual({
			present: true,
			revision: AGENTS_GUIDE_REVISION,
			stale: false,
			unstamped: false,
		});
	});

	it("does not call a missing brief stale", async () => {
		const root = scratch();
		installManual(root, "0.3.2");
		write(join(root, "plugin.json"), JSON.stringify({ id: "demo", version: "1.0.0" }));
		let stdout = "";

		await runPluginCommand(
			{ type: "docs", json: true, checkLatest: false },
			{
				cwd: () => root,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction: () => Promise.reject(new Error("unused")),
				writeStdout: (value) => {
					stdout += value;
				},
				writeStderr: () => {},
			},
		);

		// 「没有」不是「旧」：工程可以根本不用这份说明书，不该每次都催。
		expect(JSON.parse(stdout).guide).toEqual({ present: false, stale: false, unstamped: false });
	});

	it("sends the caller into an ability directory when run at a hub root", async () => {
		const root = scratch();
		write(join(root, ".vetta", "marketplace.json"), JSON.stringify({ name: "hub", abilities: [] }));
		let stderr = "";

		const code = await runPluginCommand(
			{ type: "docs", json: false, checkLatest: false },
			{
				cwd: () => root,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction: () => Promise.reject(new Error("unused")),
				writeStdout: () => {},
				writeStderr: (value) => {
					stderr += value;
				},
			},
		);

		expect(code).toBe(6);
		// 仓库根装一份 SDK 没有意义，手册在各能力目录里。
		expect(stderr).toContain("cd into an ability directory");
	});

	it("tells the caller to install the SDK when no manual is present", async () => {
		const root = scratch();
		let stderr = "";

		const code = await runPluginCommand(
			{ type: "docs", json: false, checkLatest: false },
			{
				cwd: () => root,
				resolveNpmArchive: () => Promise.reject(new Error("unused")),
				runAction: () => Promise.reject(new Error("unused")),
				writeStdout: () => {},
				writeStderr: (value) => {
					stderr += value;
				},
			},
		);

		expect(code).toBe(6);
		expect(stderr).toContain("@vetta-org/plugin-sdk");
	});
});
