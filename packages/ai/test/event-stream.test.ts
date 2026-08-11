import { describe, expect, it } from "vitest";
import { EventStream, EventStreamEndedWithoutResultError } from "../src/utils/event-stream.js";

async function settlementState(
	promise: Promise<unknown>,
	timeoutMs = 50,
): Promise<"resolved" | "rejected" | "timeout"> {
	return Promise.race([
		promise.then(
			() => "resolved" as const,
			() => "rejected" as const,
		),
		new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
	]);
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const events: T[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

describe("EventStream terminal contract", () => {
	it("rejects the result when the producer ends without a terminal result", async () => {
		const stream = new EventStream<string, string>(
			() => false,
			(event) => event,
		);
		const events = collect(stream);

		stream.end();

		await expect(events).rejects.toBeInstanceOf(EventStreamEndedWithoutResultError);
		await expect(stream.result()).rejects.toMatchObject({
			code: "AI_STREAM_PROTOCOL_FAILED",
			metadata: { reason: "ended_without_result" },
		});
	});

	it("resolves an explicitly supplied terminal result", async () => {
		const stream = new EventStream<string, string>(
			() => false,
			(event) => event,
		);

		stream.end("complete");

		await expect(stream.result()).resolves.toBe("complete");
	});

	it("distinguishes an explicit undefined result from a missing result", async () => {
		const stream = new EventStream<string, undefined>(
			() => false,
			() => undefined,
		);

		stream.end(undefined);

		await expect(stream.result()).resolves.toBeUndefined();
	});

	it("delivers the terminal event before completing iteration", async () => {
		const stream = new EventStream<string, string>(
			(event) => event === "done",
			(event) => event,
		);
		const events = collect(stream);

		stream.push("partial");
		stream.push("done");

		await expect(events).resolves.toEqual(["partial", "done"]);
		await expect(stream.result()).resolves.toBe("done");
	});

	it("rejects iteration and result with the producer failure", async () => {
		const stream = new EventStream<string, string>(
			() => false,
			(event) => event,
		);
		const events = collect(stream);
		const failure = new Error("producer failed");

		stream.push("partial");
		stream.fail(failure);

		await expect(events).rejects.toBe(failure);
		await expect(stream.result()).rejects.toBe(failure);
	});

	it("turns terminal result extraction errors into stream failures", async () => {
		const failure = new Error("invalid terminal event");
		const stream = new EventStream<string, string>(
			() => true,
			() => {
				throw failure;
			},
		);
		const events = collect(stream);

		stream.push("done");

		await expect(events).rejects.toBe(failure);
		await expect(stream.result()).rejects.toBe(failure);
	});

	it("settles failures within the contract timeout", async () => {
		const stream = new EventStream<string, string>(
			() => false,
			(event) => event,
		);

		stream.fail(new Error("failed"));

		expect(await settlementState(stream.result())).toBe("rejected");
	});
});
