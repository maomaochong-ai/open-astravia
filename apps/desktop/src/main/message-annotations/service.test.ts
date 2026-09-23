import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@vetta/ai";
import type { HistoryEntry } from "@vetta/runtime-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationAsk, AnnotationChanged } from "../../shared/message-annotations.js";
import { annotationContext } from "./context.js";
import { type AnnotationCompletion, MessageAnnotationService } from "./service.js";
import { AnnotationStore, annotationFile } from "./store.js";

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "test",
		model: "test",
		timestamp: 1,
		stopReason: "stop",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}
const history: HistoryEntry[] = [
	{ type: "message", entryId: "user", message: { role: "user", content: "Explain queues", timestamp: 0 } },
	{ type: "message", entryId: "reply", message: assistant("First, inspect the event sequence") },
	{ type: "message", entryId: "reply-final", message: assistant("A queue preserves order") },
	{ type: "message", entryId: "later", message: { role: "user", content: "LATER SECRET", timestamp: 2 } },
];
const completion: AnnotationCompletion = {
	answer: "The queue serializes work",
	stopReason: "stop",
	usage: { input: 10, output: 5, totalTokens: 15 },
};

describe("message annotation lifecycle", () => {
	let directory: string;
	let path: string;
	let events: AnnotationChanged[];
	let request: AnnotationAsk;
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "vetta-annotations-"));
		path = join(directory, "session.jsonl");
		await writeFile(path, "main transcript");
		events = [];
		request = { id: randomUUID(), entryId: "reply", quote: "A queue preserves order", question: "Why?" };
	});
	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});
	const makeService = (
		source: () => { path: string; modelKey: string; history: HistoryEntry[] },
		complete = vi.fn(async () => completion),
	) => {
		const service = new MessageAnnotationService({ source, complete });
		service.onChanged((event) => events.push(event));
		return service;
	};

	it("asks, follows up, restores saved notes, and never writes the main conversation", async () => {
		const model = vi.fn(async () => completion);
		const source = () => ({ path, modelKey: "test/model", history: structuredClone(history) });
		const service = makeService(source, model);
		const first = await service.ask("session", request);
		expect(first.turns[0]).toMatchObject({
			question: "Why?",
			answer: completion.answer,
			status: "completed",
			usage: completion.usage,
		});
		expect(first).not.toHaveProperty("context");
		await service.ask("session", { ...request, question: "Give an example" });
		const restored = await makeService(source).list("session");
		expect(restored[0].turns.map((turn) => turn.question)).toEqual(["Why?", "Give an example"]);
		expect(await readFile(path, "utf8")).toBe("main transcript");
		const stored = await new AnnotationStore().read(path);
		expect(stored[0].context).toContain("A queue preserves order");
		expect(stored[0].context).not.toContain("LATER SECRET");
		expect(events.at(-1)?.annotation.turns).toHaveLength(2);
	});

	it("keeps its original snapshot when the main conversation changes", async () => {
		let sourceHistory = structuredClone(history);
		const service = makeService(() => ({ path, modelKey: "test/model", history: sourceHistory }));
		await service.ask("session", request);
		const before = (await new AnnotationStore().read(path))[0].context;
		sourceHistory = [];
		await service.ask("session", { ...request, question: "And then?" });
		expect((await new AnnotationStore().read(path))[0].context).toBe(before);
	});

	it("takes the whole merged assistant bubble, but only the selected user message", () => {
		expect(annotationContext(history, "reply")).toContain("A queue preserves order");
		expect(annotationContext(history, "reply")).not.toContain("LATER SECRET");
		expect(annotationContext(history, "user")).not.toContain("A queue preserves order");
		expect(() => annotationContext(history, "missing")).toThrow("unavailable");
	});

	it("uses the latest compaction summary before the selected message", () => {
		const compacted: HistoryEntry[] = [
			history[0],
			{ type: "compaction", summary: "Queue context summary", tokensBefore: 10, timestamp: "2026-09-23" },
			...history.slice(1),
		];
		const context = annotationContext(compacted, "reply");
		expect(context).toContain("Queue context summary");
		expect(context).toContain("A queue preserves order");
		expect(context).not.toContain("Explain queues");
		expect(context).not.toContain("LATER SECRET");
		expect(annotationContext(compacted, "user")).not.toContain("Queue context summary");
	});

	it("preserves independent notes when requests finish concurrently", async () => {
		const service = makeService(() => ({ path, modelKey: "test/model", history }));
		await Promise.all([
			service.ask("session", request),
			service.ask("session", { ...request, id: randomUUID(), question: "Alternative?" }),
		]);
		expect(await service.list("session")).toHaveLength(2);
	});

	it("cancels only the matching session note, retaining streamed text and retrying without duplicating the question", async () => {
		let entered!: () => void;
		const ready = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const service = new MessageAnnotationService({
			source: () => ({ path, modelKey: "test/model", history }),
			complete: async (_note, _model, signal, onText) => {
				onText("Partial explanation");
				entered();
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
				});
				return completion;
			},
		});
		const pending = service.ask("session", request);
		await ready;
		await expect(service.ask("session", request)).rejects.toThrow("already answering");
		expect((await service.list("session"))[0].turns[0]).toMatchObject({
			status: "pending",
			answer: "Partial explanation",
		});
		service.cancel("session", request.id);
		expect((await pending).turns[0]).toMatchObject({ status: "cancelled", answer: "Partial explanation" });
		const next = makeService(() => ({ path, modelKey: "test/model", history }));
		expect((await next.ask("session", { ...request, retry: true })).turns).toHaveLength(1);
	});

	it("recovers interrupted saved requests and rejects malformed records without overwriting them", async () => {
		await new AnnotationStore().put(path, {
			...request,
			context: "snapshot",
			createdAt: 1,
			turns: [{ question: "Why?", answer: "", modelKey: "test/model", status: "pending" }],
		});
		const service = makeService(() => ({ path, modelKey: "test/model", history }));
		expect((await service.list("session"))[0].turns[0].status).toBe("interrupted");
		await writeFile(annotationFile(path), '{"schemaVersion":999}');
		await expect(service.ask("session", request)).rejects.toThrow();
		expect(await readFile(annotationFile(path), "utf8")).toBe('{"schemaVersion":999}');
	});

	it("rejects source changes and unsafe inputs before calling the model", async () => {
		const model = vi.fn(async () => completion);
		const service = makeService(() => ({ path, modelKey: "test/model", history }), model);
		await expect(service.ask("session", { ...request, id: "../../escape" })).rejects.toThrow();
		await expect(service.ask("session", { ...request, entryId: "missing" })).rejects.toThrow();
		expect(model).not.toHaveBeenCalled();
		await service.ask("session", request);
		await expect(service.ask("session", { ...request, quote: "changed" })).rejects.toThrow("cannot change");
	});

	it("saves provider failure and removes sidecar records when the session is deleted", async () => {
		const service = makeService(
			() => ({ path, modelKey: "test/model", history }),
			vi.fn(async () => {
				throw new Error("provider failed");
			}),
		);
		expect((await service.ask("session", request)).turns[0].status).toBe("failed");
		await rm(path);
		await service.forget(path);
		await expect(readFile(annotationFile(path))).rejects.toMatchObject({ code: "ENOENT" });
		await expect(service.ask("session", request)).rejects.toThrow();
	});
});
