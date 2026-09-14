import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePluginInitCommand } from "../src/command.js";
import { initHubRepository, initPluginProject } from "../src/init.js";

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

	it("reads the target directory and display name", () => {
		expect(parsePluginInitCommand(["init", "packages/demo", "--id", "demo", "--name", "Demo"])).toEqual({
			type: "init",
			targetDir: "packages/demo",
			pluginId: "demo",
			displayName: "Demo",
			json: false,
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

describe("scaffolding stays out of the repository's business", () => {
	it("does not touch a marketplace index that happens to sit above it", () => {
		const root = scratch();
		const manifestPath = hub(root);

		initPluginProject({ targetDir: join(root, "plugins", "demo"), pluginId: "demo", displayName: "Demo" });

		// 能力目录不该知道自己在谁肚子里；索引由仓库根的 sync 负责对账。
		expect((JSON.parse(readFileSync(manifestPath, "utf8")) as { abilities: unknown[] }).abilities).toHaveLength(0);
	});

	it("keeps dist out of gitignore so a repo-distributed plugin stays installable", () => {
		const root = scratch();

		const result = initPluginProject({ targetDir: join(root, "demo"), pluginId: "demo", displayName: "Demo" });

		// 宿主按 plugin.json 的 entry/styles 直接读目录，不会替你构建。
		expect(readFileSync(join(result.root, ".gitignore"), "utf8")).not.toContain("dist/");
	});
});

describe("scaffolding a marketplace repository", () => {
	it("lays down a conformant index, ability directories, an agent brief and a CI guard", () => {
		const root = scratch();

		const result = initHubRepository({
			targetDir: join(root, "market"),
			name: "my-market",
			repository: "https://github.com/me/my-market",
			minAppVersion: "0.55.0",
		});

		const manifest = JSON.parse(readFileSync(join(result.root, ".vetta", "marketplace.json"), "utf8")) as Record<
			string,
			unknown
		>;
		// 这几个字段缺一个，客户端就不认这份索引。
		expect(manifest).toMatchObject({
			schemaVersion: 2,
			name: "my-market",
			marketplaceVersion: "1.0.0",
			repository: "https://github.com/me/my-market",
			minAppVersion: "0.55.0",
			abilities: [],
		});
		expect(result.files).toContain("AGENTS.md");
		expect(existsSync(join(result.root, "abilities", "plugins", ".gitkeep"))).toBe(true);
		expect(readFileSync(join(result.root, ".github", "workflows", "marketplace.yml"), "utf8")).toContain(
			"sync --check",
		);
		const brief = readFileSync(join(result.root, "AGENTS.md"), "utf8");
		// 落在仓库根的 Agent 最需要知道的两件事。
		expect(brief).toContain("cd abilities/plugins");
		// 仓库根没有 node_modules，裸 bin 解析不到，必须写全名。
		expect(brief).toContain("npx @vetta-org/plugin-cli sync");
	});

	it("keeps dist publishable by not ignoring it", () => {
		const root = scratch();

		const result = initHubRepository({
			targetDir: join(root, "market"),
			name: "my-market",
			repository: "https://github.com/me/my-market",
			minAppVersion: "0.55.0",
		});

		expect(readFileSync(join(result.root, ".gitignore"), "utf8")).not.toContain("dist/");
	});

	it("rejects inputs the client would reject", () => {
		const root = scratch();
		const base = {
			targetDir: join(root, "market"),
			name: "my-market",
			repository: "https://github.com/me/my-market",
			minAppVersion: "0.55.0",
		};

		expect(() => initHubRepository({ ...base, name: "My_Market" })).toThrow(/kebab-case/);
		expect(() => initHubRepository({ ...base, repository: "git@github.com:me/x.git" })).toThrow(/Invalid repository/);
		expect(() => initHubRepository({ ...base, repository: "http://github.com/me/x" })).toThrow(/https/);
		expect(() => initHubRepository({ ...base, minAppVersion: "latest" })).toThrow(/min-app-version/);
	});

	it("refuses to overwrite an existing marketplace", () => {
		const root = scratch();
		const base = {
			targetDir: join(root, "market"),
			name: "my-market",
			repository: "https://github.com/me/my-market",
			minAppVersion: "0.55.0",
		};
		initHubRepository(base);

		expect(() => initHubRepository(base)).toThrow(/Refusing to overwrite/);
	});
});

describe("init hub parsing", () => {
	it("requires the fields a publishable index cannot do without", () => {
		expect(parsePluginInitCommand(["init", "hub"])).toEqual({ type: "error", message: "Missing --name <slug>" });
		expect(parsePluginInitCommand(["init", "hub", "--name", "m"])).toMatchObject({ type: "error" });
		// minAppVersion 没有安全默认值：太低放行装不动新 schema 的旧客户端，太高则部分用户看不到。
		expect(
			parsePluginInitCommand(["init", "hub", "--name", "m", "--repository", "https://github.com/me/m"]),
		).toMatchObject({ type: "error", message: expect.stringContaining("min-app-version") });
	});

	it("parses a complete hub invocation", () => {
		expect(
			parsePluginInitCommand([
				"init",
				"hub",
				"market",
				"--name",
				"my-market",
				"--repository",
				"https://github.com/me/my-market",
				"--min-app-version",
				"0.55.0",
			]),
		).toEqual({
			type: "init-hub",
			targetDir: "market",
			name: "my-market",
			repository: "https://github.com/me/my-market",
			minAppVersion: "0.55.0",
			json: false,
		});
	});
});
