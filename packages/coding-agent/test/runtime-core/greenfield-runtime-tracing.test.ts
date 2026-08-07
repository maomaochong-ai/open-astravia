import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentRuntimeModelSource } from "../../src/adapters/runtime-core/model-runtime-adapter.js";
import {
	type CodingAgentRuntimeCompositionOptions,
	createCodingAgentRuntimeComposition,
} from "../../src/composition/runtime-composition.js";

type TestTracer = NonNullable<CodingAgentRuntimeCompositionOptions["tracer"]>;
type TestObservation = ReturnType<TestTracer["startObservation"]>;
type TestObservationUpdate = Parameters<TestTracer["startObservation"]>[1];
type TestObservationOptions = Parameters<TestTracer["startObservation"]>[2];

interface ObservationRecord {
	readonly name: string;
	readonly parent?: string;
	readonly update?: TestObservationUpdate;
	readonly options?: TestObservationOptions;
}

describe("Greenfield Runtime tracing", () => {
	it("propagates one non-owned tracer and attributes every Turn to its real Session", async () => {
		const conversationDir = await mkdtemp(join(tmpdir(), "greenfield-runtime-tracing-"));
		const records: ObservationRecord[] = [];
		const flush = vi.fn(async () => {});
		const shutdown = vi.fn(async () => {});
		const tracer: TestTracer = {
			startObservation: (name, update, options) => createObservation(records, name, undefined, update, options),
			flush,
			shutdown,
		};
		const composition = await createCodingAgentRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			activation: { mode: "explicit", toolNames: [] },
			tracer,
			tracing: {
				captureContent: true,
				detail: "standard",
				traceName: "sdk-trace",
				metadata: { tenant: "test", sessionId: "stale-session" },
			},
			streamFn: () => new RecordedAssistantStream(assistantMessage("done")),
			createSystemPromptOptionsResolver: () => () => ({ customPrompt: "test", scenario: "cli" }),
		});

		try {
			for (const sessionId of ["root-session", "child-session"]) {
				const session = await composition.backend.create({ sessionId });
				await expect(session.prompt({ text: "hello" })).resolves.toMatchObject({ status: "completed" });
				await session.dispose();
			}

			const agentRuns = records.filter(({ name }) => name === "agent.run");
			expect(agentRuns.map(({ update }) => update?.sessionId)).toEqual(["root-session", "child-session"]);
			expect(agentRuns.map(({ update }) => update?.traceName)).toEqual(["sdk-trace", "sdk-trace"]);
			expect(agentRuns.map(({ update }) => update?.metadata)).toMatchObject([
				{ tenant: "test", sessionId: "root-session" },
				{ tenant: "test", sessionId: "child-session" },
			]);
			expect(records.filter(({ parent }) => parent === "agent.run").map(({ options }) => options?.type)).toEqual([
				"generation",
				"generation",
			]);
			expect(flush).toHaveBeenCalledTimes(2);
			expect(shutdown).not.toHaveBeenCalled();
		} finally {
			await composition.dispose().catch(() => undefined);
			await rm(conversationDir, { force: true, recursive: true });
		}
		expect(shutdown).not.toHaveBeenCalled();
	});
});

function createObservation(
	records: ObservationRecord[],
	name: string,
	parent: string | undefined,
	update?: TestObservationUpdate,
	options?: TestObservationOptions,
): TestObservation {
	records.push({ name, parent, update, options });
	return {
		id: `observation-${records.length}`,
		traceId: "trace-1",
		type: options?.type ?? "span",
		startObservation: (childName, childUpdate, childOptions) =>
			createObservation(records, childName, name, childUpdate, childOptions),
		update() {},
		end() {},
	};
}

class RecordedAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected assistant event");
			},
		);
		queueMicrotask(() => this.push({ type: "done", reason: "stop", message }));
	}
}

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
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
		timestamp: 2,
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
	id: "recorded-model",
	name: "Recorded Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
