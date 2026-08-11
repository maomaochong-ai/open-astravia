import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createCodingAgentHostBootstrap,
	resolveCodingAgentInitialModel,
} from "../src/host/coding-agent-host-bootstrap.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

describe("Coding Agent Host Bootstrap", () => {
	it("shares parsed settings, credentials, model catalog and resources with host compositions", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-host-bootstrap-"));
		temporaryDirectories.push(root);
		const agentDir = join(root, "agent");
		const cwd = join(root, "workspace");
		await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(cwd, { recursive: true })]);
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

		const bootstrap = await createCodingAgentHostBootstrap({
			args: [
				"--mode",
				"rpc",
				"--scenario",
				"im-claw",
				"--model",
				"test/plain-model",
				"--thinking",
				"xhigh",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
			],
			cwd,
			agentDir,
		});
		const initial = await resolveCodingAgentInitialModel(bootstrap);

		expect(bootstrap).toMatchObject({
			cwd,
			agentDir,
			parsed: {
				mode: "rpc",
				scenario: "im-claw",
				model: "test/plain-model",
				thinking: "xhigh",
			},
		});
		expect(bootstrap.resourceLoader.getSkills()).toEqual({ skills: [], diagnostics: [] });
		expect(bootstrap.extensionRequirements).toEqual({
			extensionCount: 0,
			bootstrapContributions: { providers: [], flags: [] },
			registrations: [],
			requiredRuntimeCapabilities: [],
		});
		expect(initial).toMatchObject({
			model: { provider: "test", id: "plain-model" },
			thinkingLevel: "off",
			error: undefined,
		});
	});
});
