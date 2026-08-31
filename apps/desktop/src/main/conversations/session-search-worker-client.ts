import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { DesktopSessionSearchEvent } from "../../shared/session-search.js";
import type { SessionSearchWorkerRequest } from "./session-search-worker-protocol.js";

const HOST_DIR = dirname(fileURLToPath(import.meta.url));

/** One lazily-created worker; completed queries share a bounded index until the idle timeout. */
export class SessionSearchWorkerClient {
	private worker?: Worker;
	private idleTimer?: ReturnType<typeof setTimeout>;
	private readonly listeners = new Map<string, (event: DesktopSessionSearchEvent) => void>();

	constructor(
		private readonly spawn = () =>
			new Worker(join(HOST_DIR, "session-search-worker.js"), { resourceLimits: { maxOldGenerationSizeMb: 512 } }),
	) {}

	start(
		request: Extract<SessionSearchWorkerRequest, { type: "start" }>,
		onEvent: (event: DesktopSessionSearchEvent) => void,
	): () => void {
		clearTimeout(this.idleTimer);
		const worker = this.getWorker();
		this.listeners.set(request.requestId, onEvent);
		try {
			worker.postMessage(request);
		} catch (error) {
			this.listeners.delete(request.requestId);
			this.scheduleIdleStop();
			throw error;
		}
		return () => {
			if (!this.listeners.delete(request.requestId)) return;
			if (this.worker === worker)
				worker.postMessage({ type: "cancel", requestId: request.requestId } satisfies SessionSearchWorkerRequest);
			this.scheduleIdleStop();
		};
	}

	invalidate(): void {
		this.worker?.postMessage({ type: "invalidate" } satisfies SessionSearchWorkerRequest);
	}

	private getWorker(): Worker {
		if (this.worker) return this.worker;
		const worker = this.spawn();
		this.worker = worker;
		worker.on("message", (event: DesktopSessionSearchEvent) => {
			if (this.worker !== worker) return;
			const listener = this.listeners.get(event.requestId);
			if (event.done) this.listeners.delete(event.requestId);
			listener?.(event);
			this.scheduleIdleStop();
		});
		const failed = () => {
			if (this.worker !== worker) return;
			this.worker = undefined;
			const pending = [...this.listeners];
			this.listeners.clear();
			for (const [requestId, listener] of pending) listener({ requestId, done: true, error: "search-failed" });
		};
		worker.on("error", failed);
		worker.on("exit", failed);
		worker.unref();
		return worker;
	}

	private scheduleIdleStop(): void {
		if (this.listeners.size > 0) return;
		clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			const worker = this.worker;
			this.worker = undefined;
			void worker?.terminate();
		}, 60_000);
		this.idleTimer.unref();
	}
}
