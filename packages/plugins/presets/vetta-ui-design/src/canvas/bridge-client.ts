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

export interface BridgeHubEvents {
	onSelected(frameId: string, payload: SelectedElementPayload | null): void;
	onExitInspect(frameId: string): void;
	onHmrUpdated(frameId: string | null): void;
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
	private readonly onMessage = (event: MessageEvent): void => {
		const data = event.data as Record<string, unknown> | null;
		if (!data || data.vetd !== true) return;
		const frameId = this.frameIdForWindow(event.source);
		switch (data.type) {
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
	}

	register(frameId: string, iframe: HTMLIFrameElement | null): void {
		if (iframe) this.frames.set(frameId, iframe);
		else this.frames.delete(frameId);
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

	setMode(frameId: string, mode: "off" | "inspect"): void {
		this.post(frameId, { type: "set-mode", mode });
	}

	clearSelection(frameId: string): void {
		this.post(frameId, { type: "clear-selection" });
	}

	capture(frameId: string, options?: { keepHighlight?: boolean; timeoutMs?: number }): Promise<string> {
		const iframe = this.frames.get(frameId);
		if (!iframe) return Promise.reject(new Error(`frame not mounted: ${frameId}`));
		this.captureCounter += 1;
		const requestId = `cap-${this.captureCounter}`;
		return new Promise<string>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.captures.delete(requestId);
				reject(new Error("capture timed out"));
			}, options?.timeoutMs ?? 15_000);
			this.captures.set(requestId, { resolve, reject, timer });
			this.post(frameId, { type: "capture", requestId, keepHighlight: options?.keepHighlight === true });
		});
	}
}
