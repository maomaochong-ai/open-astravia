import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SERVER_URL } from "@vetta/coding-agent/config";
import { afterEach, describe, expect, it } from "vitest";
import { createCliCodingAgentBootstrap } from "../src/coding-agent-bootstrap.js";

const temporaryDirectories: string[] = [];
const originalOffline = process.env.PI_OFFLINE;
const originalSkipVersionCheck = process.env.PI_SKIP_VERSION_CHECK;

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
	restoreEnvironment("PI_OFFLINE", originalOffline);
	restoreEnvironment("PI_SKIP_VERSION_CHECK", originalSkipVersionCheck);
});

describe("CLI Coding Agent bootstrap", () => {
	it("owns Node paths, offline environment and state storage", async () => {
		const root = await mkdtemp(join(tmpdir(), "cli-coding-agent-bootstrap-"));
		temporaryDirectories.push(root);
		const cwd = join(root, "workspace");
		const agentDir = join(root, "agent-state");
		await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
		await writeFile(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					test: {
						baseUrl: "https://example.test",
						api: "openai-responses",
						models: [
							{
								id: "plain-model",
								name: "Plain Model",
								reasoning: false,
								input: ["text"],
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
								contextWindow: 8_000,
								maxTokens: 1_000,
							},
						],
					},
				},
			}),
			"utf8",
		);

		const bootstrap = await createCliCodingAgentBootstrap({
			args: [
				"--offline",
				"--model",
				"test/plain-model",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
			],
			cwd,
			agentDir,
		});

		expect(bootstrap).toMatchObject({ cwd, agentDir, parsed: { model: "test/plain-model" } });
		expect(process.env.PI_OFFLINE).toBe("1");
		expect(process.env.PI_SKIP_VERSION_CHECK).toBe("1");
		expect(bootstrap.settingsManager.getServerUrl()).toBe(DEFAULT_SERVER_URL);
		expect(bootstrap.resourceLoader.getSkills()).toEqual({ skills: [], diagnostics: [] });
		const persistedSettings: unknown = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
		expect(persistedSettings).toMatchObject({ serverUrl: DEFAULT_SERVER_URL });
	});
});

function restoreEnvironment(name: "PI_OFFLINE" | "PI_SKIP_VERSION_CHECK", value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}
