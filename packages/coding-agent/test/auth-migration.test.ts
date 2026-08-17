import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.js";
import { migrateAuthToAuthJson, runMigrations } from "../src/migrations.js";
import { createFileAuthStorage } from "./fixtures/file-auth-storage.js";

describe("auth credential migration", () => {
	let agentDir: string;
	let originalAgentDir: string | undefined;

	beforeEach(() => {
		agentDir = join(tmpdir(), `coding-agent-auth-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(agentDir, { recursive: true });
		originalAgentDir = process.env[ENV_AGENT_DIR];
		process.env[ENV_AGENT_DIR] = agentDir;
	});

	afterEach(() => {
		if (originalAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = originalAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
	});

	test("migrates legacy OAuth and API-key credentials into the validated auth document", () => {
		writeFileSync(
			join(agentDir, "oauth.json"),
			JSON.stringify({
				legacyOauth: {
					refresh: "legacy-refresh",
					access: "legacy-access",
					expires: Date.now() + 60_000,
					projectId: "legacy-project",
				},
			}),
		);
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ theme: "dark", apiKeys: { legacyApi: "legacy-key" } }),
		);

		expect(migrateAuthToAuthJson()).toEqual(["legacyOauth", "legacyApi"]);

		const storage = createFileAuthStorage(join(agentDir, "auth.json"));
		expect(storage.get("legacyOauth")).toMatchObject({
			type: "oauth",
			projectId: "legacy-project",
		});
		expect(storage.get("legacyApi")).toEqual({ type: "api_key", key: "legacy-key" });
		expect(storage.drainErrors()).toEqual([]);
		expect(existsSync(join(agentDir, "oauth.json.migrated"))).toBe(true);
		expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"))).toEqual({ theme: "dark" });
	});

	test("uses the host-owned agent directory instead of the process default", () => {
		const explicitAgentDir = join(agentDir, "explicit-host-state");
		const workspace = join(agentDir, "workspace");
		mkdirSync(explicitAgentDir, { recursive: true });
		mkdirSync(workspace, { recursive: true });
		writeFileSync(
			join(explicitAgentDir, "oauth.json"),
			JSON.stringify({
				explicit: {
					refresh: "refresh-token",
					access: "access-token",
					expires: Date.now() + 60_000,
				},
			}),
		);

		const result = runMigrations({ cwd: workspace, agentDir: explicitAgentDir });

		expect(result.migratedAuthProviders).toEqual(["explicit"]);
		expect(existsSync(join(explicitAgentDir, "auth.json"))).toBe(true);
		expect(existsSync(join(agentDir, "auth.json"))).toBe(false);
	});
});
