import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePluginInitCommand } from "../src/command.js";
import { initPluginProject } from "../src/init.js";

const created: string[] = [];

function scratch(): string {
	const root = mkdtempSync(join(tmpdir(), "vetta-plugin-init-"));
	created.push(root);
	mkdirSync(join(root, ".git"), { recursive: true });
	return root;
}

function hub(root: string): string {
	const manifestPath = join(root, ".vetta", "marketplace.json");
	mkdirSync(join(root, ".vetta"), { recursive: true });
	writeFileSync(
		manifestPath,
		JSON.stringify({ schemaVersion: 2, name: "demo-hub", marketplaceVersion: "1", abilities: [] }),
		"utf8",
	);
	return manifestPath;
}

afterEach(() => {
	while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
});

describe("init command parsing", () => {
	it("requires a plugin id", () => {
		expect(parsePluginInitCommand(["init"])).toEqual({ type: "error", message: "Missing --id <plugin-id>" });
	});

	it("reads the target directory, display name and hub opt-out", () => {
		expect(parsePluginInitCommand(["init", "packages/demo", "--id", "demo", "--name", "Demo", "--no-hub"])).toEqual({
			type: "init",
			targetDir: "packages/demo",
			pluginId: "demo",
			displayName: "Demo",
			json: false,
			registerInHub: false,
		});
	});
});

describe("scaffolding a project", () => {
	it("lays down a buildable project with an agent brief", () => {
		const root = scratch();

		const result = initPluginProject({
			targetDir: join(root, "demo"),
			pluginId: "demo",
			displayName: "Demo Plugin",
		});

		expect(result.files).toContain("AGENTS.md");
		const manifest = JSON.parse(readFileSync(join(result.root, "plugin.json"), "utf8")) as Record<string, unknown>;
		expect(manifest.id).toBe("demo");
		expect(manifest.moduleFederation).toEqual({ remoteName: "demo", expose: "./plugin" });

		const pkg = JSON.parse(readFileSync(join(result.root, "package.json"), "utf8")) as {
			scripts: Record<string, string>;
			devDependencies: Record<string, string>;
		};
		// 一条命令走完构建到安装，Agent 不需要记住产物路径。
		expect(pkg.scripts["install:vetta"]).toContain("vetta-plugin-cli add .");
		expect(pkg.devDependencies["@vetta-org/plugin-sdk"]).toMatch(/^\^\d/);

		const brief = readFileSync(join(result.root, "AGENTS.md"), "utf8");
		// 说明书只指路，不复述合同——手册才是真源，而且随 SDK 版本走。
		expect(brief).toContain("vetta-plugin-cli docs");
		expect(brief).not.toContain("agent/docs/plugin");
	});

	it("derives a valid module federation remote name from a kebab-case id", () => {
		const root = scratch();

		const result = initPluginProject({ targetDir: join(root, "x"), pluginId: "my-cool-plugin", displayName: "X" });

		const manifest = JSON.parse(readFileSync(join(result.root, "plugin.json"), "utf8")) as {
			moduleFederation: { remoteName: string };
		};
		expect(manifest.moduleFederation.remoteName).toBe("my_cool_plugin");
	});

	it("rejects an id the host would not accept", () => {
		const root = scratch();

		expect(() => initPluginProject({ targetDir: join(root, "x"), pluginId: "Bad_Id", displayName: "X" })).toThrow(
			/lowercase kebab-case/,
		);
		expect(existsSync(join(root, "x", "plugin.json"))).toBe(false);
	});

	it("refuses to overwrite an existing plugin", () => {
		const root = scratch();
		mkdirSync(join(root, "demo"), { recursive: true });
		writeFileSync(join(root, "demo", "plugin.json"), "{}", "utf8");

		expect(() => initPluginProject({ targetDir: join(root, "demo"), pluginId: "demo", displayName: "Demo" })).toThrow(
			/Refusing to overwrite/,
		);
	});
});

describe("scaffolding inside a marketplace hub", () => {
	it("lists the new plugin in the hub manifest with a repo-relative source path", () => {
		const root = scratch();
		const manifestPath = hub(root);

		const result = initPluginProject({
			targetDir: join(root, "plugins", "demo"),
			pluginId: "demo",
			displayName: "Demo Plugin",
		});

		expect(result.hubManifestPath).toBe(manifestPath);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { abilities: Record<string, unknown>[] };
		expect(manifest.abilities).toHaveLength(1);
		expect(manifest.abilities[0]).toMatchObject({
			type: "plugin",
			slug: "demo",
			version: "0.1.0",
			// 市场按仓库相对路径取包，绝对路径或反斜杠都会让它取不到。
			source: { path: "plugins/demo" },
		});
		expect(readFileSync(join(result.root, "AGENTS.md"), "utf8")).toContain("marketplace.json");
	});

	it("can skip hub registration", () => {
		const root = scratch();
		const manifestPath = hub(root);

		const result = initPluginProject({
			targetDir: join(root, "plugins", "demo"),
			pluginId: "demo",
			displayName: "Demo",
			registerInHub: false,
		});

		expect(result.hubManifestPath).toBeUndefined();
		expect((JSON.parse(readFileSync(manifestPath, "utf8")) as { abilities: unknown[] }).abilities).toHaveLength(0);
	});

	it("refuses to list a slug the hub already carries", () => {
		const root = scratch();
		const manifestPath = hub(root);
		writeFileSync(
			manifestPath,
			JSON.stringify({ schemaVersion: 2, name: "demo-hub", marketplaceVersion: "1", abilities: [{ slug: "demo" }] }),
			"utf8",
		);

		expect(() =>
			initPluginProject({ targetDir: join(root, "plugins", "demo"), pluginId: "demo", displayName: "Demo" }),
		).toThrow(/already listed/);
	});
});
