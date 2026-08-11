import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AuthStorage } from "../src/auth/index.js";
import { ENV_AGENT_DIR } from "../src/config.js";
import { migrateAuthToAuthJson } from "../src/migrations.js";

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

		const storage = AuthStorage.create(join(agentDir, "auth.json"));
		expect(storage.get("legacyOauth")).toMatchObject({
			type: "oauth",
			projectId: "legacy-project",
		});
		expect(storage.get("legacyApi")).toEqual({ type: "api_key", key: "legacy-key" });
		expect(storage.drainErrors()).toEqual([]);
		expect(existsSync(join(agentDir, "oauth.json.migrated"))).toBe(true);
		expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"))).toEqual({ theme: "dark" });
	});
});
