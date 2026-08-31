import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSearchWorkerClient } from "./session-search-worker-client.js";
import type { SessionSearchWorkerRequest } from "./session-search-worker-protocol.js";

class FakeWorker extends EventEmitter {
	postMessage = vi.fn();
	unref = vi.fn();
	terminate = vi.fn(async () => 0);
}
const request: Extract<SessionSearchWorkerRequest, { type: "start" }> = {
	type: "start",
	requestId: "one",
	request: { query: "x" },
	sources: [],
	roots: [],
};
afterEach(() => vi.useRealTimers());

describe("SessionSearchWorkerClient", () => {
	it("cancels one request without delivering late results and releases the idle worker", () => {
		vi.useFakeTimers();
		const worker = new FakeWorker();
		const client = new SessionSearchWorkerClient(() => worker as unknown as Worker);
		const onEvent = vi.fn();
		const cancel = client.start(request, onEvent);
		cancel();
		cancel();
		worker.emit("message", { requestId: "one", done: true });
		expect(onEvent).not.toHaveBeenCalled();
		expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "cancel", requestId: "one" });
		vi.advanceTimersByTime(60_000);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
	it("retains a busy worker and recreates it after a crash without accepting old events", () => {
		vi.useFakeTimers();
		const first = new FakeWorker();
		const second = new FakeWorker();
		const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
		const client = new SessionSearchWorkerClient(spawn);
		const one = vi.fn();
		client.start(request, one);
		vi.advanceTimersByTime(60_000);
		expect(first.terminate).not.toHaveBeenCalled();
		first.emit("error", new Error("worker failed"));
		expect(one).toHaveBeenCalledWith({ requestId: "one", done: true, error: "search-failed" });
		const two = vi.fn();
		client.start(request, two);
		first.emit("message", { requestId: "one", done: true });
		expect(two).not.toHaveBeenCalled();
		second.emit("message", { requestId: "one", done: true });
		expect(two).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(60_000);
		expect(second.terminate).toHaveBeenCalledOnce();
	});
	it("does not retain a subscription if postMessage fails", () => {
		vi.useFakeTimers();
		const worker = new FakeWorker();
		worker.postMessage.mockImplementation(() => {
			throw new Error("clone failed");
		});
		const client = new SessionSearchWorkerClient(() => worker as unknown as Worker);
		const onEvent = vi.fn();
		expect(() => client.start(request, onEvent)).toThrow("clone failed");
		worker.emit("message", { requestId: "one", done: true });
		expect(onEvent).not.toHaveBeenCalled();
		vi.advanceTimersByTime(60_000);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
});
