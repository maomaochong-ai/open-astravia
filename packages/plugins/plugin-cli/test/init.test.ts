import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePluginInitCommand } from "../src/command.js";
import {
	AGENTS_GUIDE_REVISION,
	readAgentsGuideRevision,
	renderAgentsGuide,
} from "../src/agents-template.js";
import { initHubRepository, initPluginProject, refreshAgentsGuide } from "../src/init.js";

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

describe("refreshing the agent brief in an existing directory", () => {
	it("rewrites a scaffolded brief, touching nothing else", () => {
		const root = scratch();
		initPluginProject({ targetDir: root, pluginId: "demo", displayName: "Demo" });
		const before = readFileSync(join(root, "src", "index.tsx"), "utf8");

		const result = refreshAgentsGuide(root);

		expect(result).toMatchObject({ root, kind: "plugin", written: true });
		const guide = readFileSync(join(root, "AGENTS.md"), "utf8");
		expect(guide).toContain("Demo");
		expect(guide).toContain("--check-latest");
		// 只有 AGENTS.md 是纯派生的；用户写过的源码不能被一次刷新抹掉。
		expect(readFileSync(join(root, "src", "index.tsx"), "utf8")).toBe(before);
	});

	it("rewrites the hub brief at a marketplace root", () => {
		const root = scratch();
		initHubRepository({ targetDir: root, name: "my-market", repository: "https://example.com/r", minAppVersion: "0.55.0" });

		expect(refreshAgentsGuide(root)).toMatchObject({ kind: "hub", written: true });
		expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("--check-latest");
	});

	it("refuses to overwrite a brief with no revision marker", () => {
		const root = scratch();
		initPluginProject({ targetDir: root, pluginId: "demo", displayName: "Demo" });
		// 能力市场仓库的根 AGENTS.md 常常是一整本手写的市场规范，与「版本戳之前的模板」无从区分。
		const handWritten = "# 我们的市场规范\n\n（443 行手写内容）\n";
		writeFileSync(join(root, "AGENTS.md"), handWritten, "utf8");

		expect(() => refreshAgentsGuide(root)).toThrow(/looks hand-written/);
		expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(handWritten);
	});

	it("replaces an unmarked brief only when forced", () => {
		const root = scratch();
		initPluginProject({ targetDir: root, pluginId: "demo", displayName: "Demo" });
		writeFileSync(join(root, "AGENTS.md"), "# hand written\n", "utf8");

		expect(refreshAgentsGuide(root, { force: true }).written).toBe(true);
		expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("vetta-guide-revision");
	});

	it("dry-run returns the new brief without touching the file", () => {
		const root = scratch();
		initPluginProject({ targetDir: root, pluginId: "demo", displayName: "Demo" });
		const handWritten = "# 我们的市场规范\n";
		writeFileSync(join(root, "AGENTS.md"), handWritten, "utf8");

		const result = refreshAgentsGuide(root, { dryRun: true });

		// dry-run 要在「拒绝覆盖」的目录上也能用——它正是人工合并的入口。
		expect(result.written).toBe(false);
		expect(result.content).toContain("vetta-guide-revision");
		expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(handWritten);
	});

	it("resolves a localized plugin name instead of printing the placeholder", () => {
		const root = scratch();
		initPluginProject({ targetDir: root, pluginId: "demo", displayName: "Demo" });
		writeFileSync(
			join(root, "plugin.json"),
			JSON.stringify({ id: "demo", name: "%plugin.name%", defaultLocale: "zh" }),
			"utf8",
		);
		mkdirSync(join(root, "locales"), { recursive: true });
		writeFileSync(join(root, "locales", "zh.json"), JSON.stringify({ "plugin.name": "演示插件" }), "utf8");

		expect(refreshAgentsGuide(root, { force: true }).content).toContain("# 演示插件");
	});

	it("falls back to the plugin id when the placeholder cannot be resolved", () => {
		const root = scratch();
		initPluginProject({ targetDir: root, pluginId: "demo", displayName: "Demo" });
		writeFileSync(join(root, "plugin.json"), JSON.stringify({ id: "demo", name: "%plugin.name%" }), "utf8");

		const content = refreshAgentsGuide(root, { force: true }).content;
		expect(content).toContain("# demo");
		expect(content).not.toContain("%plugin.name%");
	});

	it("lists only the npm scripts the project actually has", () => {
		const root = scratch();
		initPluginProject({ targetDir: root, pluginId: "demo", displayName: "Demo" });
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { build: "vite build" } }), "utf8");

		const content = refreshAgentsGuide(root, { force: true }).content;
		expect(content).toContain("npm run build");
		// 照着不存在的 script 跑只会得到一句 "Missing script"。
		expect(content).not.toContain("npm run dev");
		expect(content).not.toContain("npm run install:vetta");
		expect(content).toContain("vetta-plugin-cli add .");
	});

	it("refuses a directory that is neither", () => {
		expect(() => refreshAgentsGuide(scratch())).toThrow(/Not a plugin project or marketplace repository/);
	});
});

describe("the brief stays thin", () => {
	const guide = renderAgentsGuide({ pluginId: "demo", displayName: "Demo" });

	it("carries a revision stamp that round-trips", () => {
		expect(readAgentsGuideRevision(guide)).toBe(AGENTS_GUIDE_REVISION);
	});

	it("keeps the rules in the manual instead of the brief", () => {
		// 写进说明书的规则会在所有存量工程里就地凝固。这几条属于手册——它随 SDK 升级一起到位。
		for (const rule of ["Tailwind", "notify", "agent_mode", "workspace:*"]) {
			expect(guide).not.toContain(rule);
		}
		const manual = readFileSync(join(__dirname, "..", "..", "..", "..", "docs", "plugin", "README.md"), "utf8");
		expect(manual).toContain("## 不可违反的红线");
		for (const rule of ["Tailwind", "notify", "agent_mode", "workspace:*"]) {
			expect(manual).toContain(rule);
		}
	});
});
