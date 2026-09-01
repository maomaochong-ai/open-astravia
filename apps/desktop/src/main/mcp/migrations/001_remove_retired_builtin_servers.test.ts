import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFileMigrations } from "@vetta/toolkit/file-migrations";
import { describe, expect, it } from "vitest";
import type { McpConfigData } from "../../../preload/api-types/mcp.js";
import {
	removeRetiredBuiltinMcpServers,
	removeRetiredBuiltinMcpServersMigration,
} from "./001_remove_retired_builtin_servers.js";

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

describe("removeRetiredBuiltinMcpServers", () => {
	it("removes the three retired built-in server configurations", () => {
		const input: McpConfigData = {
			mcpServers: {
				notion: { type: "http", url: "https://mcp.notion.com/mcp" },
				figma: {
					command: "npx",
					args: ["-y", "figma-developer-mcp", "--stdio"],
					env: { FIGMA_API_KEY: "secret" },
				},
				github: {
					type: "http",
					url: "https://api.githubcopilot.com/mcp/",
					headers: { Authorization: "Bearer secret" },
				},
				custom: { command: "node", args: ["server.js"] },
			},
		};

		expect(removeRetiredBuiltinMcpServers(input)).toEqual({
			config: { mcpServers: { custom: { command: "node", args: ["server.js"] } } },
			removedNames: ["notion", "figma", "github"],
		});
	});

	it("preserves same-name custom servers whose signatures differ", () => {
		const input: McpConfigData = {
			mcpServers: {
				notion: { type: "http", url: "https://mcp.example.com/notion" },
				figma: { command: "node", args: ["figma.js"] },
				github: { type: "http", url: "https://mcp.example.com/github" },
			},
		};

		const result = removeRetiredBuiltinMcpServers(input);
		expect(result.config).toBe(input);
		expect(result.removedNames).toEqual([]);
	});

	it("clears legacy config, ledger and OAuth state only once", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-mcp-migration-"));
		const agentDirectory = join(root, "agent");
		const authDirectory = join(agentDirectory, "mcp-auth");
		const configPath = join(agentDirectory, "mcp.json");
		try {
			await mkdir(authDirectory, { recursive: true });
			await writeFile(
				configPath,
				JSON.stringify({
					mcpServers: {
						notion: { type: "http", url: "https://mcp.notion.com/mcp" },
						custom: { command: "node", args: ["server.js"] },
					},
				}),
			);
			await writeFile(join(authDirectory, "notion.json"), "{}");
			await writeFile(
				join(root, "abilities.json"),
				JSON.stringify({
					schemaVersion: 2,
					entries: {
						"mcp:notion": { version: "1.0.0", installedAt: "2026-01-01T00:00:00.000Z" },
						"mcp:custom": { version: "1.0.0", installedAt: "2026-01-01T00:00:00.000Z" },
					},
				}),
			);

			const options = {
				root,
				migrations: [removeRetiredBuiltinMcpServersMigration],
				statePath: "agent/mcp-migrations.json",
			} as const;
			await runFileMigrations(options);

			expect(await readJson(configPath)).toEqual({
				mcpServers: { custom: { command: "node", args: ["server.js"] } },
			});
			expect(await readJson(join(root, "abilities.json"))).toEqual({
				schemaVersion: 2,
				entries: {
					"mcp:custom": { version: "1.0.0", installedAt: "2026-01-01T00:00:00.000Z" },
				},
			});
			await expect(readFile(join(authDirectory, "notion.json"), "utf8")).rejects.toThrow();

			await writeFile(
				configPath,
				JSON.stringify({ mcpServers: { notion: { type: "http", url: "https://mcp.notion.com/mcp" } } }),
			);
			const secondRun = await runFileMigrations(options);
			expect(secondRun.applied).toEqual([]);
			expect(await readJson(configPath)).toEqual({
				mcpServers: { notion: { type: "http", url: "https://mcp.notion.com/mcp" } },
			});
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it("keeps ledger and OAuth state for a same-name custom server", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-mcp-migration-custom-"));
		const agentDirectory = join(root, "agent");
		const authDirectory = join(agentDirectory, "mcp-auth");
		try {
			await mkdir(authDirectory, { recursive: true });
			await writeFile(
				join(agentDirectory, "mcp.json"),
				JSON.stringify({ mcpServers: { notion: { type: "http", url: "https://mcp.example.com/notion" } } }),
			);
			await writeFile(join(authDirectory, "notion.json"), "{}");
			const ledger = {
				schemaVersion: 2,
				entries: { "mcp:notion": { version: "1.0.0", installedAt: "2026-01-01T00:00:00.000Z" } },
			};
			await writeFile(join(root, "abilities.json"), JSON.stringify(ledger));

			await runFileMigrations({
				root,
				migrations: [removeRetiredBuiltinMcpServersMigration],
				statePath: "agent/mcp-migrations.json",
			});

			expect(await readJson(join(root, "abilities.json"))).toEqual(ledger);
			expect(await readFile(join(authDirectory, "notion.json"), "utf8")).toBe("{}");
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
