import { EventEmitter } from "node:events";
import type { IpcRenderer } from "electron";
import { describe, expect, it, vi } from "vitest";
import { SESSION_SEARCH_CHANNELS } from "../../shared/session-search.js";
import { subscribeSessionSearch } from "./session-search.js";

describe("session search preload subscription", () => {
	it("forwards time bounds unchanged with the other search filters", () => {
		const emitter = new EventEmitter();
		const invoke = vi.fn(async () => {});
		const request = { query: "hit", modifiedFrom: 123, modifiedBefore: 456, sourceKind: "project" as const };
		const cancel = subscribeSessionSearch(
			Object.assign(emitter, { invoke }) as unknown as IpcRenderer,
			request,
			vi.fn(),
		);
		expect(invoke).toHaveBeenCalledWith(SESSION_SEARCH_CHANNELS.start, expect.any(String), request);
		cancel();
	});
	it("receives events before invoke acknowledges and ignores unrelated ids", async () => {
		const emitter = new EventEmitter();
		const invoke = vi.fn(async (_channel: string, id: string) => {
			emitter.emit(SESSION_SEARCH_CHANNELS.event, {}, { requestId: "unrelated", done: false });
			emitter.emit(SESSION_SEARCH_CHANNELS.event, {}, { requestId: id, results: [], done: false });
			emitter.emit(SESSION_SEARCH_CHANNELS.event, {}, { requestId: id, done: true });
		});
		const onEvent = vi.fn();
		const cancel = subscribeSessionSearch(
			Object.assign(emitter, { invoke }) as unknown as IpcRenderer,
			{ query: "x" },
			onEvent,
		);
		expect(onEvent).toHaveBeenCalledTimes(2);
		expect(emitter.listenerCount(SESSION_SEARCH_CHANNELS.event)).toBe(0);
		cancel();
		expect(invoke).toHaveBeenCalledTimes(1);
	});
	it("cancels and unsubscribes even while start acknowledgement is pending", async () => {
		const emitter = new EventEmitter();
		let rejectStart!: (error: Error) => void;
		const invoke = vi.fn((channel: string) =>
			channel === SESSION_SEARCH_CHANNELS.start
				? new Promise<void>((_done, reject) => {
						rejectStart = reject;
					})
				: Promise.resolve(),
		);
		const onEvent = vi.fn();
		const cancel = subscribeSessionSearch(
			Object.assign(emitter, { invoke }) as unknown as IpcRenderer,
			{ query: "x" },
			onEvent,
		);
		cancel();
		cancel();
		expect(emitter.listenerCount(SESSION_SEARCH_CHANNELS.event)).toBe(0);
		expect(invoke).toHaveBeenCalledTimes(2);
		rejectStart(new Error("late rejection"));
		await Promise.resolve();
		expect(onEvent).not.toHaveBeenCalled();
	});
	it("turns invoke failures into one terminal event and releases its listener", async () => {
		const emitter = new EventEmitter();
		const invoke = vi.fn(async () => {
			throw new Error("private details");
		});
		const onEvent = vi.fn();
		subscribeSessionSearch(Object.assign(emitter, { invoke }) as unknown as IpcRenderer, { query: "x" }, onEvent);
		await Promise.resolve();
		expect(onEvent).toHaveBeenCalledWith({ requestId: expect.any(String), done: true, error: "search-failed" });
		expect(emitter.listenerCount(SESSION_SEARCH_CHANNELS.event)).toBe(0);
	});
});
