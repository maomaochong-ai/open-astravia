import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@vetta/ai";
import { RuntimeAgentRuntime } from "@vetta/runtime-core";
import type { RuntimeSnapshotLease } from "@vetta/runtime-core/kernel";
import { afterEach, describe, expect, it } from "vitest";
import type { CodingAgentRuntimeModelSource } from "../../src/adapters/runtime-core/model-runtime-adapter.js";
import {
	CODING_AGENT_BUILTIN_SOURCE,
	createCodingAgentExecutionRuntimeDefinition,
	publishCodingAgentExecutionRuntimeDefinition,
} from "../../src/composition/index.js";
import { createCodingAgentRuntimeComposition } from "../fixtures/conversation-persistence.js";

describe("Coding Agent Runtime Agent production composition", () => {
	const directories: string[] = [];
	const runtimes: RuntimeAgentRuntime[] = [];

	afterEach(async () => {
		for (const runtime of runtimes.splice(0).reverse()) await runtime.close().catch(() => undefined);
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("pins a Composition Instance to its published Definition while new Instances use the next revision", async () => {
		const runtime = new RuntimeAgentRuntime();
		runtimes.push(runtime);
		const firstPublication = publishCodingAgentExecutionRuntimeDefinition(runtime);
		const first = await createComposition(runtime, "first");
		expect(first.agentRuntime.revisionId).toBe(firstPublication.revision.id);

		const secondPublication = publishCodingAgentExecutionRuntimeDefinition(runtime, {
			source: { ...CODING_AGENT_BUILTIN_SOURCE, revision: "2" },
			definition: createCodingAgentExecutionRuntimeDefinition({
				transformSessionDefinition: (_context, definition) => ({
					...definition,
					capabilities: {
						...definition.capabilities,
						instructions: [
							{ id: "test.revision", content: "coding-agent-revision-2", priority: -1_000 },
							...definition.capabilities.instructions,
						],
					},
				}),
			}),
		});
		const second = await createComposition(runtime, "second");
		expect(second.agentRuntime.revisionId).toBe(secondPublication.revision.id);
		expect(first.agentRuntime.revisionId).not.toBe(second.agentRuntime.revisionId);

		const firstSession = await first.backend.create({ sessionId: "first-session" });
		const secondSession = await second.backend.create({ sessionId: "second-session" });
		let firstLease: RuntimeSnapshotLease | undefined;
		let secondLease: RuntimeSnapshotLease | undefined;
		try {
			firstLease = await runtime.requireSession("first-session").acquire(turn("first-session"));
			secondLease = await runtime.requireSession("second-session").acquire(turn("second-session"));
			expect(firstLease.snapshot.instructions.some(({ id }) => id === "test.revision")).toBe(false);
			expect(secondLease.snapshot.instructions).toContainEqual(
				expect.objectContaining({ id: "test.revision", content: "coding-agent-revision-2" }),
			);
		} finally {
			await firstLease?.release();
			await secondLease?.release();
			await firstSession.dispose();
			await secondSession.dispose();
			await first.dispose();
			await second.dispose();
		}

		expect(runtime.getSession("first-session")).toBeUndefined();
		expect(runtime.getSession("second-session")).toBeUndefined();
		expect(runtime.snapshot()).toMatchObject({ closed: false, instances: [] });
	});

	async function createComposition(runtime: RuntimeAgentRuntime, name: string) {
		const conversationDir = await mkdtemp(join(tmpdir(), `coding-agent-runtime-agent-${name}-`));
		directories.push(conversationDir);
		return createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			agentRuntime: { runtime },
		});
	}
});

function turn(sessionId: string) {
	return {
		sessionId,
		operationId: `inspect-${sessionId}`,
		reason: "preview" as const,
		signal: new AbortController().signal,
	};
}

function modelRegistry(): CodingAgentRuntimeModelSource {
	return {
		refresh() {},
		getAvailable: () => [MODEL],
		find: (provider, modelId) => (provider === MODEL.provider && modelId === MODEL.id ? MODEL : undefined),
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}

const MODEL: Model<Api> = {
	id: "runtime-agent-model",
	name: "Runtime Agent Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
