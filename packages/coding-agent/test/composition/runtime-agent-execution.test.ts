import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, AssistantMessageEventStream, type Model } from "@vetta/ai";
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

	it("pins running Sessions while new Sessions in the same Composition use the latest Definition", async () => {
		const runtime = new RuntimeAgentRuntime();
		runtimes.push(runtime);
		const firstPublication = publishCodingAgentExecutionRuntimeDefinition(runtime);
		const first = await createComposition(runtime, "first");
		expect(runtime.snapshot().instances).toEqual([]);
		const firstSession = await first.createSession({ sessionId: "first-session" });
		const firstIdentity = first.readSessionAgentIdentity("first-session");
		expect(firstIdentity?.revisionId).toBe(firstPublication.revision.id);

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
		const secondSession = await first.createSession({ sessionId: "second-session" });
		const secondIdentity = first.readSessionAgentIdentity("second-session");
		expect(secondIdentity?.revisionId).toBe(secondPublication.revision.id);
		expect(secondIdentity?.instanceId).not.toBe(firstIdentity?.instanceId);
		expect(first.readSessionAgentIdentity("first-session")).toEqual(firstIdentity);
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
		}

		expect(runtime.getSession("first-session")).toBeUndefined();
		expect(runtime.getSession("second-session")).toBeUndefined();
		expect(runtime.snapshot()).toMatchObject({ closed: false, instances: [] });
	});

	it("isolates concurrent conversations and releases only the closed Session's Instance", async () => {
		const runtime = new RuntimeAgentRuntime();
		runtimes.push(runtime);
		publishCodingAgentExecutionRuntimeDefinition(runtime);
		const composition = await createComposition(runtime, "isolated");
		try {
			const [first, second] = await Promise.all([
				composition.createSession({ sessionId: "first" }),
				composition.createSession({ sessionId: "second" }),
			]);
			const firstIdentity = composition.readSessionAgentIdentity("first");
			const secondIdentity = composition.readSessionAgentIdentity("second");
			expect(firstIdentity?.instanceId).toBeTruthy();
			expect(secondIdentity?.instanceId).not.toBe(firstIdentity?.instanceId);
			await Promise.all([first.prompt({ text: "first-private" }), second.prompt({ text: "second-private" })]);
			await first.prompt({ text: "first-followup" });
			expect(composition.readSessionAgentIdentity("first")).toEqual(firstIdentity);
			expect(JSON.stringify(first.readMessages())).toContain("first-private");
			expect(JSON.stringify(first.readMessages())).not.toContain("second-private");
			expect(JSON.stringify(second.readMessages())).not.toContain("first-private");
			await first.dispose();
			expect(composition.readSessionAgentIdentity("first")).toBeUndefined();
			expect(runtime.snapshot().instances.map(({ id }) => id)).toEqual([secondIdentity?.instanceId]);
			await expect(second.prompt({ text: "still-running" })).resolves.toMatchObject({ status: "completed" });
			await second.dispose();
			expect(runtime.snapshot().instances).toEqual([]);
		} finally {
			await composition.dispose();
		}
	});

	it("resumes persisted history with a fresh Instance without leaking another Composition's identity", async () => {
		const runtime = new RuntimeAgentRuntime();
		runtimes.push(runtime);
		publishCodingAgentExecutionRuntimeDefinition(runtime);
		const composition = await createComposition(runtime, "resume");
		const other = await createComposition(runtime, "other");
		try {
			const session = await composition.createSession({ sessionId: "persisted" });
			await session.prompt({ text: "remember-this" });
			const identity = composition.readSessionAgentIdentity("persisted");
			expect(other.readSessionAgentIdentity("persisted")).toBeUndefined();
			await session.dispose();
			const resumed = await composition.resumeSession({ sessionId: "persisted" });
			expect(composition.readSessionAgentIdentity("persisted")?.instanceId).not.toBe(identity?.instanceId);
			expect(JSON.stringify(resumed.readMessages())).toContain("remember-this");
			await resumed.dispose();
		} finally {
			await composition.dispose();
			await other.dispose();
		}
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
			streamFn: recordedResponse,
		});
	}
});

function recordedResponse(): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
	queueMicrotask(() => stream.push({ type: "done", reason: "stop", message }));
	return stream;
}

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
