import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, AssistantMessageEventStream, type Model } from "@vetta/ai";
import {
	createCodingAgentRuntimeSessionSelection,
	publishCodingAgentExecutionRuntimeDefinition,
} from "@vetta/coding-agent/composition";
import { AGENT_CONFIGURATION_UPDATE } from "@vetta/coding-agent/session-extensions";
import { RuntimeHost, RuntimeObservationHub } from "@vetta/runtime-core";
import { DesktopRuntimeBackendPool } from "@vetta/runtime-desktop";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopAgentObservability } from "./composition.js";
import { LocalAgentObservationRepository } from "./local-observation-repository.js";

describe("Desktop Agent observability contract", () => {
	afterEach(() => vi.unstubAllEnvs());
	it("persists native execution and correlates instances, Turns and immutable configuration revisions", async () => {
		const directory = await mkdtemp(join(tmpdir(), "desktop-agent-trace-contract-"));
		await writeFile(join(directory, ".git"), "");
		vi.stubEnv("VETTA_HOME", directory);
		vi.stubEnv("VETTA_CODING_AGENT_DIR", join(directory, "agent"));
		vi.stubEnv("USERPROFILE", directory);
		vi.stubEnv("VETTA_TRACING", "");
		const path = join(directory, "agent-traces.json");
		const observability = createDesktopAgentObservability(directory, { warn: vi.fn() });
		const hub = new RuntimeObservationHub();
		hub.attach(observability.port, { id: "desktop.agent-observability" });
		let call = 0;
		await writeFile(join(directory, "input.txt"), "private-tool-result");
		const runtime = new RuntimeHost({
			observationPort: {
				record: (record) => hub.record(record),
				flush: () => hub.flush(),
				close: async () => {
					await hub.close();
					await observability.close();
				},
			},
			getDefaultExecutionMode: () => "full-access",
			createSessionBackend: ({ agents, observationPublisher }) => {
				publishCodingAgentExecutionRuntimeDefinition(agents);
				return new DesktopRuntimeBackendPool({
					observationPublisher,
					compositionDefaults: {
						agentRuntime: { runtime: agents },
						initialModel: MODEL,
						initialThinkingLevel: "off",
						hookConfigLayers: [],
						resolveSystemPromptOptions: () => ({ customPrompt: "private-system-prompt" }),
						modelRegistry: {
							refresh() {},
							getAvailable: () => [MODEL],
							find: () => MODEL,
							getApiKey: async () => "fake-key",
							setServerToken() {},
							loadRemoteModels: async () => undefined,
						},
						tracer: observability.tracer,
						streamFn: () => {
							const tool = call++ === 0;
							const stream = new AssistantMessageEventStream();
							stream.push({
								type: "done",
								reason: tool ? "toolUse" : "stop",
								message: {
									role: "assistant",
									api: MODEL.api,
									provider: MODEL.provider,
									model: MODEL.id,
									timestamp: Date.now(),
									stopReason: tool ? "toolUse" : "stop",
									content: tool
										? [
												{
													type: "toolCall",
													id: "read-1",
													name: "read",
													arguments: { path: join(directory, "input.txt") },
												},
											]
										: [{ type: "text", text: "private-assistant-output" }],
									usage: {
										input: 2,
										output: 1,
										totalTokens: 3,
										cacheRead: 0,
										cacheWrite: 0,
										cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
									},
								},
							});
							return stream;
						},
					},
				});
			},
		});
		try {
			const session = await runtime.createSession({
				cwd: directory,
				sessionDir: join(directory, "sessions"),
				model: MODEL,
				agent: createCodingAgentRuntimeSessionSelection({ includeAgentSkills: false }),
				executionMode: "full-access",
			});
			await runtime.invokeSessionExtension(session.sessionId, AGENT_CONFIGURATION_UPDATE, {
				expectedRevision: 0,
				selection: { template: null, overrides: { appendSystemPrompt: "private-config", tools: ["read"] } },
			});
			await runtime.prompt(session.sessionId, { text: "private-user-input" });
			const first = await observability.query({ sessionId: session.sessionId, limit: 200 });
			const root = first.records.find((record) => record.kind === "agent")!;
			expect(root).toBeDefined();
			expect(root.context).toMatchObject({
				agentId: expect.any(String),
				instanceId: expect.any(String),
				revisionId: expect.any(String),
				sessionId: session.sessionId,
				turnId: expect.any(String),
			});
			expect(root.metadata.configurationRevision).toBe(1);
			const children = first.records.filter((record) => record.parentSpanId === root.id);
			expect(children.filter((record) => record.kind === "generation")).toHaveLength(2);
			expect(children.find((record) => record.kind === "tool")?.context.toolCallId).toBe("read-1");
			expect(children.every((record) => record.context.instanceId === root.context.instanceId)).toBe(true);
			await runtime.invokeSessionExtension(session.sessionId, AGENT_CONFIGURATION_UPDATE, {
				expectedRevision: 1,
				selection: { template: null, overrides: { tools: [] } },
			});
			await runtime.prompt(session.sessionId, { text: "private-second-input" });
			await runtime.close();
			const restored = new LocalAgentObservationRepository({ path });
			const roots = (await restored.query({ sessionId: session.sessionId, limit: 200 })).records.filter(
				(record) => record.kind === "agent",
			);
			expect(roots.map((record) => record.metadata.configurationRevision).sort()).toEqual([1, 2]);
			expect(roots.every((record) => record.state === "completed")).toBe(true);
			expect(await readFile(path, "utf8")).not.toContain("private-");
		} finally {
			await runtime.close();
			await hub.close();
			await observability.close();
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);
});
const MODEL: Model<Api> = {
	id: "fake",
	name: "Fake",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8000,
	maxTokens: 1000,
};
