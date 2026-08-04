/**
 * Canvas-side of the design bridge. The engine iframe is cross-origin, so all
 * DOM inspection happens inside it (engine/src/bridge.ts) and this hub routes
 * postMessage traffic per frame iframe.
 */

export interface SelectedElementPayload {
	tag: string;
	domPath: string;
	classes: string;
	text: string;
	rect: { x: number; y: number; width: number; height: number };
	source: string | null;
}

/** 等 iframe 装好 bridge 的上限，超过就照发（真正的原因交给截图超时去报）。 */
const READY_TIMEOUT_MS = 8_000;

export interface BridgeHubEvents {
	onSelected(frameId: string, payload: SelectedElementPayload | null): void;
	onExitInspect(frameId: string): void;
	onHmrUpdated(frameId: string | null): void;
	/** The frame's app just rendered — the earliest point worth rasterizing it. */
	onRendered(frameId: string): void;
	/** 该 frame 编译/渲染失败（message）或恢复正常（null）。 */
	onFrameError(frameId: string, message: string | null): void;
}

interface PendingCapture {
	resolve(dataUrl: string): void;
	reject(error: Error): void;
	timer: number;
}

export class BridgeHub {
	private readonly frames = new Map<string, HTMLIFrameElement>();
	private readonly captures = new Map<string, PendingCapture>();
	private events: BridgeHubEvents | null = null;
	private captureCounter = 0;
	/** frameId → 期望的检查模式，供 iframe 重新挂载后补发。 */
	private readonly modes = new Map<string, "inspect">();
	/** 已经报过 ready（bridge 装好、能应答消息）的 frame。 */
	private readonly ready = new Set<string>();
	private readonly readyWaiters = new Map<string, Set<() => void>>();
	private readonly onMessage = (event: MessageEvent): void => {
		const data = event.data as Record<string, unknown> | null;
		if (!data || data.vetd !== true) return;
		const frameId = this.frameIdForWindow(event.source);
		switch (data.type) {
			case "ready": {
				if (!frameId) return;
				this.ready.add(frameId);
				const waiters = this.readyWaiters.get(frameId);
				if (waiters) {
					this.readyWaiters.delete(frameId);
					for (const waiter of waiters) waiter();
				}
				// 按需挂载的 frame：装好 bridge 后把它错过的模式补上。
				const wanted = this.modes.get(frameId);
				if (wanted) this.post(frameId, { type: "set-mode", mode: wanted });
				return;
			}
			case "rendered":
				if (frameId) this.events?.onRendered(frameId);
				return;
			case "frame-error":
				if (frameId) this.events?.onFrameError(frameId, typeof data.message === "string" ? data.message : null);
				return;
			case "selected":
				if (frameId) this.events?.onSelected(frameId, (data.payload as SelectedElementPayload | null) ?? null);
				return;
			case "exit-inspect":
				if (frameId) this.events?.onExitInspect(frameId);
				return;
			case "hmr-updated":
				this.events?.onHmrUpdated(frameId);
				return;
			case "captured": {
				const requestId = typeof data.requestId === "string" ? data.requestId : "";
				const pending = this.captures.get(requestId);
				if (!pending) return;
				this.captures.delete(requestId);
				window.clearTimeout(pending.timer);
				if (typeof data.dataUrl === "string") pending.resolve(data.dataUrl);
				else pending.reject(new Error(typeof data.error === "string" ? data.error : "capture failed"));
				return;
			}
			default:
				return;
		}
	};

	start(events: BridgeHubEvents): void {
		this.events = events;
		window.addEventListener("message", this.onMessage);
	}

	stop(): void {
		window.removeEventListener("message", this.onMessage);
		this.events = null;
		for (const pending of this.captures.values()) {
			window.clearTimeout(pending.timer);
			pending.reject(new Error("bridge stopped"));
		}
		this.captures.clear();
		this.frames.clear();
		this.ready.clear();
		for (const waiters of this.readyWaiters.values()) {
			for (const waiter of waiters) waiter();
		}
		this.readyWaiters.clear();
	}

	register(frameId: string, iframe: HTMLIFrameElement | null): void {
		if (iframe) {
			this.frames.set(frameId, iframe);
			return;
		}
		this.frames.delete(frameId);
		// iframe 卸了，下次挂上是全新的文档，得重新等它报 ready。
		this.ready.delete(frameId);
	}

	/**
	 * 等这一帧的 bridge 装好。iframe 是按需挂载的，截图往往紧跟着挂载发出，
	 * 消息发给一个还没装 bridge 的文档就石沉大海——表现是截图一路干等到超时。
	 * 等不到也照发：让后面统一的超时给出报错，别在这里多编一个原因。
	 */
	private waitReady(frameId: string, timeoutMs: number): Promise<void> {
		if (this.ready.has(frameId)) return Promise.resolve();
		return new Promise<void>((resolve) => {
			const waiters = this.readyWaiters.get(frameId) ?? new Set<() => void>();
			this.readyWaiters.set(frameId, waiters);
			let timer = 0;
			const done = (): void => {
				window.clearTimeout(timer);
				resolve();
			};
			timer = window.setTimeout(() => {
				waiters.delete(done);
				resolve();
			}, timeoutMs);
			waiters.add(done);
		});
	}

	private frameIdForWindow(source: MessageEventSource | null): string | null {
		for (const [frameId, iframe] of this.frames) {
			if (iframe.contentWindow === source) return frameId;
		}
		return null;
	}

	private post(frameId: string, message: Record<string, unknown>): void {
		const iframe = this.frames.get(frameId);
		iframe?.contentWindow?.postMessage({ vetd: true, ...message }, "*");
	}

	/**
	 * 记住目标模式再发：位图化之后 frame 的 iframe 是按需挂载的，双击进入的那一刻
	 * 它往往还不存在，这条消息会直接丢掉，进去就成了「hover 有高亮、点击选不中」。
	 * 真正的 iframe 装好 bridge 后会报 ready，那时再补发一次。
	 */
	setMode(frameId: string, mode: "off" | "inspect"): void {
		if (mode === "off") this.modes.delete(frameId);
		else this.modes.set(frameId, mode);
		this.post(frameId, { type: "set-mode", mode });
	}


	clearSelection(frameId: string): void {
		this.post(frameId, { type: "clear-selection" });
	}

	async capture(
		frameId: string,
		options?: { keepHighlight?: boolean; timeoutMs?: number; pixelRatio?: number; cacheBust?: boolean },
	): Promise<string> {
		if (!this.frames.has(frameId)) throw new Error(`frame not mounted: ${frameId}`);
		await this.waitReady(frameId, READY_TIMEOUT_MS);
		if (!this.frames.has(frameId)) throw new Error(`frame not mounted: ${frameId}`);
		this.captureCounter += 1;
		const requestId = `cap-${this.captureCounter}`;
		return new Promise<string>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.captures.delete(requestId);
				reject(new Error(`capture timed out for frame "${frameId}"`));
			}, options?.timeoutMs ?? 15_000);
			this.captures.set(requestId, { resolve, reject, timer });
			this.post(frameId, {
				type: "capture",
				requestId,
				keepHighlight: options?.keepHighlight === true,
				pixelRatio: options?.pixelRatio,
				cacheBust: options?.cacheBust === true,
			});
		});
	}
}
