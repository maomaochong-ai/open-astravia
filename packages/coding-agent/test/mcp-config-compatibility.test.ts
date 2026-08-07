import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodingAgentMcpSupervisor } from "../src/mcp/runtime/supervisor.js";

describe("MCP config compatibility", () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("returns an empty merged config when neither source exists", async () => {
		const fixture = await createFixture();
		const loader = createConfigSource(fixture);

		expect(loader.loadGlobal()).toBeNull();
		expect(loader.loadProject()).toBeNull();
		expect(loader.loadMerged()).toEqual({ mcpServers: {} });
		expect(loader.getConfigPaths()).toEqual({
			global: join(fixture.agentDir, "mcp.json"),
			project: join(fixture.projectRoot, ".vetta", "mcp.json"),
		});
	});

	it("merges project overrides and expands project and environment variables", async () => {
		const fixture = await createFixture();
		process.env.VETTA_MCP_CONFIG_TEST_TOKEN = "resolved-token";
		try {
			await writeJson(join(fixture.agentDir, "mcp.json"), {
				mcpServers: {
					shared: { command: "global", args: ["--global"], env: { TOKEN: "global" } },
					remote: {
						type: "http",
						url: `https://example.test/${configVariable("VETTA_MCP_CONFIG_TEST_TOKEN")}`,
					},
				},
			});
			await writeJson(join(fixture.projectRoot, ".vetta", "mcp.json"), {
				mcpServers: {
					shared: {
						command: "project",
						cwd: configVariable("PROJECT_ROOT"),
						env: { TOKEN: configVariable("VETTA_MCP_CONFIG_TEST_TOKEN") },
					},
				},
			});

			const config = createConfigSource(fixture).loadMerged();

			expect(config).toEqual({
				mcpServers: {
					shared: {
						command: "project",
						args: ["--global"],
						cwd: fixture.projectRoot,
						env: { TOKEN: "resolved-token" },
					},
					remote: { type: "http", url: "https://example.test/resolved-token" },
				},
			});
		} finally {
			delete process.env.VETTA_MCP_CONFIG_TEST_TOKEN;
		}
	});

	it.each([
		[{ invalid: true }, "Invalid MCP config: missing 'mcpServers' object"],
		[{ mcpServers: { broken: { type: "socket", command: "test" } } }, '\'type\' must be "stdio" or "http"'],
		[{ mcpServers: { broken: { command: "" } } }, "missing or invalid 'command'"],
		[{ mcpServers: { broken: { type: "http" } } }, "missing or invalid 'url'"],
		[{ mcpServers: { broken: { type: "http", url: "" } } }, "missing or invalid 'url'"],
		[{ mcpServers: { broken: { args: "bad", command: "test" } } }, "'args' must be an array"],
		[{ mcpServers: { broken: { command: "test", disabled: "yes" } } }, "'disabled' must be a boolean"],
	])("preserves validation failures for %j", async (config, message) => {
		const fixture = await createFixture();
		const path = join(fixture.agentDir, "mcp.json");
		await writeJson(path, config);

		expect(() => createConfigSource(fixture).loadGlobal()).toThrow(message);
	});

	it("keeps the file signature stable until content changes", async () => {
		const fixture = await createFixture();
		const path = join(fixture.agentDir, "mcp.json");
		const loader = createConfigSource(fixture);
		const missingSignature = loader.getMergedSignature();

		await writeJson(path, { mcpServers: { first: { command: "one" } } });
		const firstSignature = loader.getMergedSignature();
		expect(firstSignature).not.toBe(missingSignature);
		expect(loader.getMergedSignature()).toBe(firstSignature);

		await writeJson(path, { mcpServers: { first: { command: "two" } } });
		expect(loader.getMergedSignature()).not.toBe(firstSignature);
	});

	async function createFixture(): Promise<{ projectRoot: string; agentDir: string }> {
		const root = await mkdtemp(join(tmpdir(), "mcp-config-compatibility-"));
		temporaryDirectories.push(root);
		const projectRoot = join(root, "project");
		const agentDir = join(root, "agent");
		await Promise.all([mkdir(projectRoot, { recursive: true }), mkdir(agentDir, { recursive: true })]);
		return { projectRoot, agentDir };
	}
});

function createConfigSource(fixture: { readonly projectRoot: string; readonly agentDir: string }) {
	return createCodingAgentMcpSupervisor(fixture).configSource;
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(value), "utf8");
}

function configVariable(name: string): string {
	return `\${${name}}`;
}
