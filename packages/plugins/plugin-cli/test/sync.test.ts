import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePluginSyncCommand, runPluginCommand } from "../src/command.js";
import { syncMarketplaceIndex } from "../src/sync.js";

const created: string[] = [];

function scratch(): string {
	const root = mkdtempSync(join(tmpdir(), "vetta-sync-"));
	created.push(root);
	mkdirSync(join(root, ".git"), { recursive: true });
	return root;
}

function write(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}

function writeIndex(root: string, abilities: unknown[], marketplaceVersion = "1.0.0"): string {
	const manifestPath = join(root, ".vetta", "marketplace.json");
	write(
		manifestPath,
		JSON.stringify({
			schemaVersion: 2,
			name: "demo-hub",
			marketplaceVersion,
			repository: "https://github.com/openvetta/demo",
			minAppVersion: "0.55.0",
			abilities,
		}),
	);
	return manifestPath;
}

/** 一个已构建、可上架的插件目录。 */
function writePlugin(
	root: string,
	relativePath: string,
	manifest: Record<string, unknown>,
	options: { built?: boolean } = {},
): void {
	const dir = join(root, relativePath);
	write(join(dir, "plugin.json"), JSON.stringify(manifest));
	if (options.built !== false) {
		write(join(dir, "dist", "mf-manifest.json"), "{}");
		write(join(dir, "dist", "style.css"), "");
	}
}

const basePluginManifest = {
	id: "demo",
	name: "Demo",
	version: "1.0.0",
	pluginApiVersion: "^2.0.0",
	entry: "dist/mf-manifest.json",
	styles: ["dist/style.css"],
	permissions: ["fs.read"],
};

function listedPlugin(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: "plugin",
		slug: "demo",
		name: "Demo",
		version: "1.0.0",
		source: { path: "abilities/plugins/demo" },
		config: { api_version: "^2.0.0", permissions: ["fs.read"] },
		...overrides,
	};
}

afterEach(() => {
	while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
});

describe("reconciling the index", () => {
	it("reports nothing when the index already matches", () => {
		const root = scratch();
		const manifestPath = writeIndex(root, [listedPlugin()]);
		writePlugin(root, "abilities/plugins/demo", basePluginManifest);

		const result = syncMarketplaceIndex({ hubRoot: root, manifestPath, apply: true });

		expect(result.changes).toEqual([]);
		expect(result.problems).toEqual([]);
		expect(result.written).toBe(false);
	});

	it("pulls version, api version and permissions from plugin.json", () => {
		const root = scratch();
		const manifestPath = writeIndex(root, [listedPlugin()]);
		writePlugin(root, "abilities/plugins/demo", {
			...basePluginManifest,
			version: "1.1.0",
			pluginApiVersion: "^2.1.0",
			permissions: ["fs.read", "network.fetch"],
		});

		const result = syncMarketplaceIndex({ hubRoot: root, manifestPath, apply: true });

		expect(result.changes.map((change) => change.field)).toEqual([
			"version",
			"api_version",
			"permissions",
			"marketplaceVersion",
		]);
		const written = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			marketplaceVersion: string;
			abilities: { version: string; config: { api_version: string; permissions: string[] } }[];
		};
		expect(written.abilities[0]?.version).toBe("1.1.0");
		expect(written.abilities[0]?.config.permissions).toEqual(["fs.read", "network.fetch"]);
		// 内容变了却不换 marketplaceVersion，客户端不会拉新快照，而且不报错。
		expect(written.marketplaceVersion).toBe("1.0.1");
	});

	it("leaves the file alone in check mode", () => {
		const root = scratch();
		const manifestPath = writeIndex(root, [listedPlugin()]);
		writePlugin(root, "abilities/plugins/demo", { ...basePluginManifest, version: "2.0.0" });
		const before = readFileSync(manifestPath, "utf8");

		const result = syncMarketplaceIndex({ hubRoot: root, manifestPath, apply: false });

		expect(result.changes).toHaveLength(1);
		expect(result.written).toBe(false);
		expect(readFileSync(manifestPath, "utf8")).toBe(before);
	});

	it("flags a published directory with no build output", () => {
		const root = scratch();
		const manifestPath = writeIndex(root, [listedPlugin()]);
		writePlugin(root, "abilities/plugins/demo", basePluginManifest, { built: false });

		const result = syncMarketplaceIndex({ hubRoot: root, manifestPath, apply: false });

		// 本地能装、市场上装不了，就是这条没守住。
		expect(result.problems.map((problem) => problem.message)).toEqual([
			expect.stringContaining("built entry is missing"),
			expect.stringContaining("declared style is missing"),
		]);
	});

	it("refuses to paper over an id that does not match the slug", () => {
		const root = scratch();
		const manifestPath = writeIndex(root, [listedPlugin()]);
		writePlugin(root, "abilities/plugins/demo", { ...basePluginManifest, id: "renamed" });

		const result = syncMarketplaceIndex({ hubRoot: root, manifestPath, apply: true });

		// 改 id 还是改 slug 都有副作用，工具不替作者选。
		expect(result.problems[0]?.message).toContain("does not match the ability slug");
		expect(result.changes).toEqual([]);
	});

	it("reports a source path that leaves the repository", () => {
		const root = scratch();
		const manifestPath = writeIndex(root, [listedPlugin({ source: { path: "../outside" } })]);

		const result = syncMarketplaceIndex({ hubRoot: root, manifestPath, apply: false });

		expect(result.problems[0]?.message).toContain("inside the repository");
	});

	it("keeps an mcp entry aligned with its mcp.json", () => {
		const root = scratch();
		const manifestPath = writeIndex(root, [
			{ type: "mcp", slug: "context7", name: "Context7", version: "1.0.0", source: { path: "abilities/mcp/context7" } },
		]);
		write(join(root, "abilities", "mcp", "context7", "mcp.json"), JSON.stringify({ slug: "context7", version: "1.2.0" }));

		const result = syncMarketplaceIndex({ hubRoot: root, manifestPath, apply: false });

		expect(result.changes[0]).toMatchObject({ slug: "context7", field: "version", to: "1.2.0" });
	});

	it("lists ability directories that are not in the index without adding them", () => {
		const root = scratch();
		const manifestPath = writeIndex(root, [listedPlugin()]);
		writePlugin(root, "abilities/plugins/demo", basePluginManifest);
		writePlugin(root, "abilities/plugins/draft", { ...basePluginManifest, id: "draft" });

		const result = syncMarketplaceIndex({ hubRoot: root, manifestPath, apply: true });

		// 作者可能正在开发一个还不打算上架的东西，不该被工具擅自上架。
		expect(result.unlisted).toEqual(["abilities/plugins/draft"]);
		const written = JSON.parse(readFileSync(manifestPath, "utf8")) as { abilities: unknown[] };
		expect(written.abilities).toHaveLength(1);
	});

	it("says so when marketplaceVersion cannot be advanced automatically", () => {
		const root = scratch();
		const manifestPath = writeIndex(root, [listedPlugin()], "2026-09-14");
		writePlugin(root, "abilities/plugins/demo", { ...basePluginManifest, version: "1.1.0" });

		const result = syncMarketplaceIndex({ hubRoot: root, manifestPath, apply: true });

		expect(result.problems[0]?.message).toContain("marketplaceVersion");
	});
});

describe("sync command", () => {
	function deps(cwd: string, sink: { out: string; err: string }) {
		return {
			cwd: () => cwd,
			resolveNpmArchive: () => Promise.reject(new Error("unused")),
			runAction: () => Promise.reject(new Error("unused")),
			writeStdout: (value: string) => {
				sink.out += value;
			},
			writeStderr: (value: string) => {
				sink.err += value;
			},
		};
	}

	it("parses check mode", () => {
		expect(parsePluginSyncCommand(["sync", "--check"])).toEqual({ type: "sync", check: true, json: false });
	});

	it("fails check mode when the index drifted, and names the fix", async () => {
		const root = scratch();
		writeIndex(root, [listedPlugin()]);
		writePlugin(root, "abilities/plugins/demo", { ...basePluginManifest, version: "9.9.9" });
		const sink = { out: "", err: "" };

		// 从插件子目录里跑也应该找到仓库根的索引。
		const code = await runPluginCommand(
			{ type: "sync", check: true, json: false },
			deps(join(root, "abilities", "plugins", "demo"), sink),
		);

		expect(code).toBe(7);
		expect(sink.out).toContain("vetta-plugin-cli sync");
	});

	it("warns about index drift right after installing, when it is still on the author's mind", async () => {
		const root = scratch();
		writeIndex(root, [listedPlugin()]);
		const pluginDir = join(root, "abilities", "plugins", "demo");
		writePlugin(root, "abilities/plugins/demo", { ...basePluginManifest, version: "1.1.0" });
		write(join(pluginDir, "release", "demo-1.1.0.zip"), "zip");
		const sink = { out: "", err: "" };

		const code = await runPluginCommand({ type: "add", source: pluginDir, json: false }, {
			...deps(pluginDir, sink),
			runAction: () => Promise.resolve({ plugin: { id: "demo", version: "1.1.0" } }),
		});

		expect(code).toBe(0);
		// 装完立刻说，而不是等他某天想起来跑 CI。
		expect(sink.out).toContain("vetta-plugin-cli sync");
		expect(sink.out).toContain("1.0.0");
	});

	it("stays quiet about drift outside a marketplace repository", async () => {
		const root = scratch();
		const pluginDir = join(root, "demo");
		writePlugin(root, "demo", basePluginManifest);
		write(join(pluginDir, "release", "demo-1.0.0.zip"), "zip");
		const sink = { out: "", err: "" };

		await runPluginCommand({ type: "add", source: pluginDir, json: false }, {
			...deps(pluginDir, sink),
			runAction: () => Promise.resolve({ plugin: { id: "demo", version: "1.0.0" } }),
		});

		expect(sink.out).not.toContain("sync");
	});

	it("explains itself outside a marketplace repository", async () => {
		const root = scratch();
		const sink = { out: "", err: "" };

		const code = await runPluginCommand({ type: "sync", check: false, json: false }, deps(root, sink));

		expect(code).toBe(6);
		expect(sink.err).toContain("marketplace repositories");
	});
});
