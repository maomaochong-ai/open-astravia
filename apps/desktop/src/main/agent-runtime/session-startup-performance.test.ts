import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import { createCodingAgentRuntimeSessionSelection } from "@vetta/coding-agent/composition";
import { RuntimeHost } from "@vetta/runtime-core";
import { DesktopRuntimeBackendPool } from "@vetta/runtime-desktop";
import { expect, it, vi } from "vitest";
import {
	startOpenAiResponsesTestServer,
	textResponseEvents,
} from "../../../../cli-host/test/support/openai-responses-test-server.js";
import { createDesktopPromptRuntimeSources } from "./resource-runtime.js";

// Set VETTA_STARTUP_BENCHMARK_RUNS=5 for comparable timing samples. No wall-clock
// assertion: CI load must not turn a resource freshness regression into a flaky test.
it("creates a conversation, sends with installed skills and observes edits on the next turn", async () => {
	const root = await mkdtemp(join(tmpdir(), "vetta-startup-benchmark-"));
	vi.stubEnv("VETTA_HOME", root);
	vi.stubEnv("VETTA_CODING_AGENT_DIR", join(root, "agent"));
	vi.stubEnv("USERPROFILE", root);
	vi.stubEnv("HOME", root);
	const server = await startOpenAiResponsesTestServer(() => ({
		kind: "events",
		events: textResponseEvents("Ready."),
	}));
	const samples: Array<{
		createMs: number;
		prepareMs: number;
		readyMs: number;
		refreshes: number;
		refreshMs: number;
	}> = [];
	try {
		await writeFile(join(root, ".git"), "");
		for (let skill = 0; skill < 40; skill += 1) {
			const directory = join(root, ".agents", "skills", `fixture-${skill}`);
			await mkdir(join(directory, "references"), { recursive: true });
			await writeFile(join(directory, "SKILL.md"), skillDocument(skill, "Original fixture description"));
			await Promise.all(
				Array.from({ length: 20 }, (_, index) =>
					writeFile(join(directory, "references", `${index}.md`), "Fixture reference."),
				),
			);
		}
		const runs = Number(process.env.VETTA_STARTUP_BENCHMARK_RUNS ?? 1);
		if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("Invalid benchmark runs");
		for (let run = 0; run < runs; run += 1) {
			const cwd = join(root, `conversation-${run}`);
			await mkdir(cwd);
			await writeFile(join(cwd, ".git"), "");
			const model: Model<Api> = {
				id: "startup-fixture",
				name: "Startup fixture",
				api: "openai-responses",
				provider: "test",
				baseUrl: server.baseUrl,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 1_000,
			};
			let refreshes = 0;
			let refreshMs = 0;
			const pool = new DesktopRuntimeBackendPool({
				compositionDefaults: {
					initialModel: model,
					initialThinkingLevel: "off",
					modelRegistry: {
						refresh() {},
						getAvailable: () => [model],
						find: () => model,
						getApiKey: async () => "test-key",
						setServerToken() {},
						loadRemoteModels: async () => undefined,
					},
					createPromptRuntimeSources: async (context) => {
						const sources = await createDesktopPromptRuntimeSources({
							...context,
							agentDir: join(root, "agent"),
						});
						const refresh = sources.resourceSource.refreshSkillsIfChanged.bind(sources.resourceSource);
						sources.resourceSource.refreshSkillsIfChanged = async (signal) => {
							const start = performance.now();
							refreshes += 1;
							try {
								return await refresh(signal);
							} finally {
								refreshMs += performance.now() - start;
							}
						};
						return sources;
					},
				},
			});
			const runtime = new RuntimeHost({ sessionBackend: pool, getDefaultExecutionMode: () => "full-access" });
			try {
				const start = performance.now();
				const created = await runtime.createSession({
					cwd,
					sessionDir: join(root, "sessions"),
					model,
					agent: createCodingAgentRuntimeSessionSelection({
						scenario: "conversation",
						includeAgentSkills: true,
						enableBackgroundTasks: false,
					}),
					executionMode: "full-access",
				});
				const createMs = performance.now() - start;
				let readyMs = 0;
				const unsubscribe = runtime.subscribe(created.sessionId, (event) => {
					if (event.type === "model.request.started") readyMs = performance.now() - start;
				});
				await runtime.prompt(created.sessionId, { text: "Hello" });
				unsubscribe();
				expect(readyMs).toBeGreaterThan(createMs);
				expect(server.requests.at(-1)?.rawBody).toContain("fixture-39");
				expect(runtime.getMessages(created.sessionId).at(-1)).toMatchObject({
					role: "assistant",
					content: [{ type: "text", text: "Ready." }],
				});
				samples.push({ createMs, prepareMs: readyMs - createMs, readyMs, refreshes, refreshMs });
				expect(refreshes, "preview and first turn each validate resources once").toBeLessThanOrEqual(2);
				await writeFile(
					join(root, ".agents", "skills", "fixture-0", "SKILL.md"),
					skillDocument(0, `Updated fixture description ${run}`),
				);
				await runtime.prompt(created.sessionId, { text: "Continue" });
				expect(server.requests.at(-1)?.rawBody).toContain(`Updated fixture description ${run}`);
			} finally {
				await runtime.disposeAllSessions();
				await pool.dispose();
			}
		}
		if (process.env.VETTA_STARTUP_BENCHMARK_RUNS) console.info("[startup-benchmark]", JSON.stringify(samples));
	} finally {
		await server.dispose();
		await rm(root, { recursive: true, force: true });
		vi.unstubAllEnvs();
	}
}, 120_000);

function skillDocument(index: number, description: string): string {
	return `---\nname: fixture-${index}\ndescription: ${description}\n---\nFixture skill instructions.\n`;
}
