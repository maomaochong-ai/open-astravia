import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileMcpConfigSource, parseMcpConfig } from "../src/index.js";

describe("FileMcpConfigSource", () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("uses explicit paths, project root and environment instead of product defaults", async () => {
		const fixture = await createFixture();
		await writeJson(fixture.globalConfigPath, {
			mcpServers: {
				stdio: {
					command: configVariable("COMMAND"),
					args: [configVariable("MISSING")],
					cwd: configVariable("PROJECT_ROOT"),
					env: { TOKEN: configVariable("TOKEN") },
				},
				remote: {
					type: "http",
					url: `https://${configVariable("HOST")}/mcp`,
					headers: { Authorization: configVariable("TOKEN") },
				},
			},
		});
		const source = new FileMcpConfigSource({
			...fixture,
			projectRoot: fixture.root,
			environment: { COMMAND: "node", TOKEN: "secret", HOST: "example.test" },
		});

		expect(source.loadMerged()).toEqual({
			mcpServers: {
				stdio: {
					command: "node",
					args: [configVariable("MISSING")],
					cwd: fixture.root,
					env: { TOKEN: "secret" },
				},
				remote: {
					type: "http",
					url: "https://example.test/mcp",
					headers: { Authorization: "secret" },
				},
			},
		});
	});

	it("keeps project field overrides shallow and preserves global-only servers", async () => {
		const fixture = await createFixture();
		await writeJson(fixture.globalConfigPath, {
			mcpServers: {
				shared: { command: "global", args: ["one"], env: { FIRST: "1" } },
				global: { command: "global-only" },
			},
		});
		await writeJson(fixture.projectConfigPath, {
			mcpServers: { shared: { command: "project", env: { SECOND: "2" } } },
		});
		const source = new FileMcpConfigSource({ ...fixture, projectRoot: fixture.root });

		expect(source.loadMerged()).toEqual({
			mcpServers: {
				shared: { command: "project", args: ["one"], env: { SECOND: "2" }, cwd: undefined },
				global: { command: "global-only", args: undefined, cwd: undefined, env: undefined },
			},
		});
	});

	it("validates untrusted JSON through the TypeBox-backed parser", () => {
		expect(parseMcpConfig({ mcpServers: { valid: { command: "node" } } })).toEqual({
			mcpServers: { valid: { command: "node" } },
		});
		expect(() => parseMcpConfig({ mcpServers: { invalid: { type: "http", headers: [] } } })).toThrow(
			"missing or invalid 'url'",
		);
		expect(() => parseMcpConfig({ mcpServers: { invalid: { command: "" } } })).toThrow(
			"missing or invalid 'command'",
		);
		expect(() => parseMcpConfig({ mcpServers: { invalid: { type: "http", url: "" } } })).toThrow(
			"missing or invalid 'url'",
		);
		expect(() => parseMcpConfig({ mcpServers: { invalid: { command: "node", startupTimeout: "fast" } } })).toThrow(
			"'startupTimeout' must be a number",
		);
	});

	it("changes its signature for content changes without requiring a new source", async () => {
		const fixture = await createFixture();
		const source = new FileMcpConfigSource({ ...fixture, projectRoot: fixture.root });
		const missing = source.getMergedSignature();
		await writeJson(fixture.globalConfigPath, { mcpServers: { first: { command: "one" } } });
		const first = source.getMergedSignature();
		await writeJson(fixture.globalConfigPath, { mcpServers: { first: { command: "two" } } });

		expect(first).not.toBe(missing);
		expect(source.getMergedSignature()).not.toBe(first);
	});

	async function createFixture() {
		const root = await mkdtemp(join(tmpdir(), "runtime-mcp-config-"));
		temporaryDirectories.push(root);
		return {
			root,
			globalConfigPath: join(root, "agent", "mcp.json"),
			projectConfigPath: join(root, "project", ".vetta", "mcp.json"),
		};
	}
});

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(value), "utf8");
}

function configVariable(name: string): string {
	return `\${${name}}`;
}
