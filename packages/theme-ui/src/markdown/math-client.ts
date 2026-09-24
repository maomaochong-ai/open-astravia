type Listener = (html: string | null) => void;
interface Job {
	id: number;
	key: string;
	source: string;
	display: boolean;
	listeners: Set<Listener>;
}

const cache = new Map<string, string | null>();
let cacheSize = 0;
const jobs = new Map<string, Job>();
let worker: Worker | null = null;
let running: Job | null = null;
let sequence = 0;
let deadline: ReturnType<typeof setTimeout> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;

function disposeWorker() {
	clearTimeout(deadline);
	clearTimeout(idle);
	worker?.terminate();
	worker = null;
}

function finish(html: string | null) {
	clearTimeout(deadline);
	const job = running;
	if (!job) return;
	running = null;
	jobs.delete(job.key);
	const size = job.key.length + (html?.length ?? 0);
	if (size <= 1_000_000) {
		while (cache.size >= 256 || cacheSize + size > 1_000_000) {
			const oldest = cache.keys().next().value;
			if (oldest === undefined) break;
			cacheSize -= oldest.length + (cache.get(oldest)?.length ?? 0);
			cache.delete(oldest);
		}
		cache.set(job.key, html);
		cacheSize += size;
	}
	for (const listener of job.listeners) listener(html);
	pump();
}

function pump() {
	if (running) return;
	const job = jobs.values().next().value;
	if (!job) {
		idle = setTimeout(disposeWorker, 30_000);
		return;
	}
	clearTimeout(idle);
	running = job;
	try {
		if (!worker) {
			const instance = new Worker(new URL("./math.worker.ts", import.meta.url), { type: "module" });
			worker = instance;
			instance.onmessage = (event: MessageEvent<unknown>) => {
				if (worker !== instance) return;
				const data = event.data;
				if (!data || typeof data !== "object" || !("id" in data) || !("html" in data)) return;
				if (data.id !== running?.id || (data.html !== null && typeof data.html !== "string")) return;
				finish(data.html);
			};
			instance.onerror = () => {
				if (worker !== instance) return;
				disposeWorker();
				finish(null);
			};
		}
		deadline = setTimeout(() => {
			disposeWorker();
			finish(null);
		}, 2000);
		worker.postMessage({ id: job.id, source: job.source, display: job.display });
	} catch {
		disposeWorker();
		finish(null);
	}
}

/** Deduplicated, serial and cancellable; detached formulas never keep queued work alive. */
export function requestFormula(source: string, display: boolean, listener: Listener): () => void {
	if (source.length > 8192) {
		listener(null);
		return () => {};
	}
	const key = JSON.stringify([source, display]);
	if (cache.has(key)) {
		listener(cache.get(key) ?? null);
		return () => {};
	}
	let job = jobs.get(key);
	if (!job) {
		if (jobs.size >= 128) {
			listener(null);
			return () => {};
		}
		job = { id: ++sequence, key, source, display, listeners: new Set() };
		jobs.set(key, job);
	}
	job.listeners.add(listener);
	pump();
	return () => {
		job.listeners.delete(listener);
		if (job.listeners.size !== 0) return;
		jobs.delete(key);
		if (running === job) {
			disposeWorker();
			running = null;
			pump();
		}
	};
}
