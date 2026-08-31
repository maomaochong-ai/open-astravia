import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { SessionSearchControllerDependencies } from "./session-search-controller.js";
import { parseSessionSearchRequest, SessionSearchController } from "./session-search-controller.js";

class Owner extends EventEmitter {
	constructor(readonly id: number) {
		super();
	}
	isDestroyed() {
		return false;
	}
}

describe("SessionSearchController", () => {
	it.each([
		null,
		[],
		{ query: 1 },
		{ query: "x".repeat(201) },
		{ query: "x", limit: NaN },
		{ query: "x", limit: 101 },
		{ query: "x", sourceKind: "agent" },
		{ query: "x", projectCwd: 42 },
		{ query: "x", modifiedFrom: "2026-01-01" },
		{ query: "x", modifiedFrom: NaN },
		{ query: "x", modifiedBefore: Infinity },
		{ query: "x", modifiedBefore: 1.5 },
		{ query: "x", modifiedFrom: 8_640_000_000_000_001 },
		{ query: "x", modifiedFrom: 20, modifiedBefore: 10 },
		{ query: "x", modifiedFrom: 10, modifiedBefore: 10 },
	])("rejects malformed requests: %j", (request) => {
		expect(() => parseSessionSearchRequest(request)).toThrow();
	});
	it("preserves valid millisecond time bounds and permits open-ended ranges", () => {
		expect(parseSessionSearchRequest({ query: " x ", modifiedFrom: 0, modifiedBefore: 100 })).toMatchObject({
			query: "x",
			modifiedFrom: 0,
			modifiedBefore: 100,
		});
		expect(parseSessionSearchRequest({ query: "x", modifiedFrom: -100 })).toMatchObject({ modifiedFrom: -100 });
		expect(parseSessionSearchRequest({ query: "x", modifiedBefore: 100 })).toMatchObject({ modifiedBefore: 100 });
	});
	it("accepts an empty query for the unfiltered project catalog", () => {
		expect(parseSessionSearchRequest({ query: " " })).toEqual({
			query: "",
			limit: undefined,
			sourceKind: undefined,
			projectCwd: undefined,
		});
	});
	it("isolates window ownership and cancels old requests, including reused client ids", async () => {
		const calls: {
			id: string;
			signal: AbortSignal;
			emit: Parameters<SessionSearchControllerDependencies["run"]>[2];
			done: () => void;
		}[] = [];
		const send = vi.fn();
		const controller = new SessionSearchController({
			send,
			run: (id, _request, emit, signal) =>
				new Promise<void>((done) => {
					calls.push({ id, signal, emit, done });
				}),
		});
		const first = new Owner(1);
		const second = new Owner(2);
		controller.start(first, "same", { query: "a" });
		controller.start(second, "same", { query: "a" });
		expect(calls[0].id).not.toBe(calls[1].id);
		controller.cancel(second, "different");
		expect(calls[1].signal.aborted).toBe(false);
		controller.start(first, "same", { query: "b" });
		expect(calls[0].signal.aborted).toBe(true);
		calls[0].emit({ requestId: calls[0].id, done: true });
		expect(send).not.toHaveBeenCalled();
		calls[0].done();
		await Promise.resolve();
		await Promise.resolve();
		controller.cancel(first, "same");
		expect(calls[2].signal.aborted).toBe(true);
		expect(first.listenerCount("destroyed")).toBe(0);
		second.emit("destroyed");
		expect(calls[1].signal.aborted).toBe(true);
		for (const call of calls) call.done();
	});
	it("reports a sanitized failure and releases the owner listener", async () => {
		const owner = new Owner(1);
		let sent!: () => void;
		const event = new Promise<void>((done) => {
			sent = done;
		});
		const send = vi.fn(() => sent());
		const controller = new SessionSearchController({
			send,
			run: async () => {
				throw new Error("private file content");
			},
		});
		controller.start(owner, "one", { query: "x" });
		await event;
		await Promise.resolve();
		expect(send).toHaveBeenCalledWith(owner, { requestId: "one", done: true, error: "search-failed" });
		expect(owner.listenerCount("destroyed")).toBe(0);
	});
});
