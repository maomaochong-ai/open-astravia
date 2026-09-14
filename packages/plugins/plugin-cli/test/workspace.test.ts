import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

describe("docs command", () => {
	it("parses the docs command", () => {
		expect(parsePluginDocsCommand(["docs", "--json"])).toEqual({ type: "docs", json: true });
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
			{ type: "docs", json: true },
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
	});

	it("tells the caller to install the SDK when no manual is present", async () => {
		const root = scratch();
		let stderr = "";

		const code = await runPluginCommand(
			{ type: "docs", json: false },
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
