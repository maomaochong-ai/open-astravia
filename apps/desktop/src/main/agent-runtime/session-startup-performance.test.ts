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
import { DesktopMcpResourceManager } from "./mcp-resource-manager.js";
import { createDesktopPromptRuntimeSources } from "./resource-runtime.js";

// Set VETTA_STARTUP_BENCHMARK_RUNS=5 for comparable timing samples. No wall-clock
// assertion: CI load must not turn a resource freshness regression into a flaky test.
// Set VETTA_TEAM_STARTUP_BENCHMARK=1 to model a four-member Team: a lightweight
// coordination session, leader-first admission, then sibling warmup after the
// leader's first response has completed.
// Set VETTA_STARTUP_BENCHMARK_MCP_DELAY_MS=10000 to model a slow MCP source
// without calling an external MCP service or provider.
it("creates a conversation, sends with installed skills and observes edits on the next turn", async () => {
	const root = await mkdtemp(join(tmpdir(), "vetta-startup-benchmark-"));
	vi.stubEnv("VETTA_HOME", root);
	vi.stubEnv("VETTA_CODING_AGENT_DIR", join(root, "agent"));
	vi.stubEnv("USERPROFILE", root);
	vi.stubEnv("HOME", root);
	const providerRequestReceivedAt: number[] = [];
	const server = await startOpenAiResponsesTestServer((_request, index) => {
		providerRequestReceivedAt[index] = performance.now();
		return {
			kind: "events",
			events: textResponseEvents("Ready."),
		};
	});
	const samples: Array<{
		createMs: number;
		prepareMs: number;
		readyMs: number;
		providerRequestReceivedMs: number;
		firstResponseEventMs: number;
		firstTextDeltaMs: number;
		promptCompletedMs: number;
		requestBytes: number;
		teamLeaderReadyMs?: number;
		teamAllReadyMs?: number;
		refreshes: number;
		refreshMs: number;
		mcpPrewarmMs?: number;
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
		const mcpDelayMs = Number(process.env.VETTA_STARTUP_BENCHMARK_MCP_DELAY_MS ?? 0);
		if (!Number.isInteger(mcpDelayMs) || mcpDelayMs < 0 || mcpDelayMs > 15_000) {
			throw new Error("Invalid benchmark MCP delay");
		}
		let mcpPrewarmMs: number | undefined;
		const mcpResources =
			mcpDelayMs > 0
				? new DesktopMcpResourceManager({
						createApplicationSource: async () => {
							await new Promise((resolve) => setTimeout(resolve, mcpDelayMs));
							return {
								source: { refresh: async () => ({ tools: [] }) },
								dispose: async () => undefined,
							};
						},
						createWorkspaceSource: async () => ({
							source: { refresh: async () => ({ tools: [] }) },
							dispose: async () => undefined,
						}),
					})
				: undefined;
		if (mcpResources) {
			const prewarmStartedAt = performance.now();
			await mcpResources.prewarmApplication(join(root, "agent"));
			mcpPrewarmMs = performance.now() - prewarmStartedAt;
		}
		try {
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
					...(mcpResources
						? {
								createMcpRuntimeSource: ({ cwd }: { cwd: string }) =>
									mcpResources.acquire({ cwd, agentDir: join(root, "agent") }),
							}
						: {}),
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
					const benchmarkTeam = process.env.VETTA_TEAM_STARTUP_BENCHMARK === "1";
					const created = await runtime.createSession({
						cwd,
						sessionDir: join(root, "sessions"),
						model,
						agent: createCodingAgentRuntimeSessionSelection({
							scenario: "conversation",
							includeAgentSkills: !benchmarkTeam,
							enableBackgroundTasks: false,
						}),
						executionMode: "full-access",
					});
					const createMs = performance.now() - start;
					let teamLeaderReadyMs: number | undefined;
					let teamAllReadyMs: number | undefined;
					let promptSessionId = created.sessionId;
					let teamMemberPromises: Array<Promise<{ sessionId: string }>> = [];
					let startRemainingTeamMembers: (() => void) | undefined;
					if (benchmarkTeam) {
						const createMember = (memberIndex: number) =>
							runtime.createSession({
								cwd,
								sessionDir: join(root, `team-member-${run}-${memberIndex}`),
								model,
								agent: createCodingAgentRuntimeSessionSelection({
									scenario: "conversation",
									includeAgentSkills: true,
									enableBackgroundTasks: false,
								}),
								executionMode: "full-access",
							});
						const leaderPromise = createMember(0);
						const leader = await leaderPromise;
						teamLeaderReadyMs = performance.now() - start;
						promptSessionId = leader.sessionId;
						startRemainingTeamMembers = () => {
							if (teamMemberPromises.length === 0) {
								teamMemberPromises = [leaderPromise, ...[1, 2, 3].map(createMember)];
							}
						};
					}
					let readyMs = 0;
					let firstResponseEventMs = 0;
					let firstTextDeltaMs = 0;
					const unsubscribe = runtime.subscribe(promptSessionId, (event) => {
						if (event.type === "model.request.started") {
							readyMs = performance.now() - start;
						}
						if (event.channel === "assistant" && event.type === "start" && firstResponseEventMs === 0) {
							firstResponseEventMs = performance.now() - start;
						}
						if (event.channel === "assistant" && event.type === "text_delta" && firstTextDeltaMs === 0) {
							firstTextDeltaMs = performance.now() - start;
						}
					});
					const providerRequestIndex = server.requests.length;
					await runtime.prompt(promptSessionId, { text: "Hello" });
					const promptCompletedMs = performance.now() - start;
					startRemainingTeamMembers?.();
					if (teamMemberPromises.length > 0) {
						await Promise.all(teamMemberPromises);
						teamAllReadyMs = performance.now() - start;
					}
					unsubscribe();
					expect(readyMs).toBeGreaterThan(createMs);
					const providerReceivedAt = providerRequestReceivedAt[providerRequestIndex];
					if (providerReceivedAt === undefined) throw new Error("Provider request timing was not captured");
					const providerRequestReceivedMs = providerReceivedAt - start;
					expect(providerRequestReceivedMs).toBeGreaterThanOrEqual(readyMs);
					expect(firstResponseEventMs).toBeGreaterThanOrEqual(providerRequestReceivedMs);
					expect(firstTextDeltaMs).toBeGreaterThanOrEqual(firstResponseEventMs);
					expect(server.requests.at(-1)?.rawBody).toContain("fixture-39");
					const request = server.requests[providerRequestIndex];
					if (!request) throw new Error("Provider request was not captured");
					expect(runtime.getMessages(promptSessionId).at(-1)).toMatchObject({
						role: "assistant",
						content: [{ type: "text", text: "Ready." }],
					});
					samples.push({
						createMs,
						prepareMs: readyMs - createMs,
						readyMs,
						providerRequestReceivedMs,
						firstResponseEventMs,
						firstTextDeltaMs,
						promptCompletedMs,
						requestBytes: Buffer.byteLength(request.rawBody),
						teamLeaderReadyMs,
						teamAllReadyMs,
						refreshes,
						refreshMs,
						mcpPrewarmMs,
					});
					expect(refreshes, "each created session validates resources once").toBeLessThanOrEqual(
						benchmarkTeam ? 6 : 2,
					);
					await writeFile(
						join(root, ".agents", "skills", "fixture-0", "SKILL.md"),
						skillDocument(0, `Updated fixture description ${run}`),
					);
					await runtime.prompt(promptSessionId, { text: "Continue" });
					expect(server.requests.at(-1)?.rawBody).toContain(`Updated fixture description ${run}`);
				} finally {
					await runtime.disposeAllSessions();
					await pool.dispose();
				}
			}
		} finally {
			await mcpResources?.dispose();
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
