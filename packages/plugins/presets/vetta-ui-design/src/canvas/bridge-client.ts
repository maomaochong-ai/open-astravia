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
	/**
	 * frame 内按了 Esc 且没有更上一层的元素可选。`hadSelection` 为 true 表示刚刚还
	 * 选着元素，这一下只是把元素选中清掉；为 false 表示已经什么都没选，该退出这个
	 * frame 了。焦点在 iframe 里时画布层收不到 keydown，Esc 只能从这里过来。
	 */
	onExitInspect(frameId: string, hadSelection: boolean): void;
	onHmrUpdated(frameId: string | null): void;
	/**
	 * 该 frame 的内容已经画到屏幕上（引擎侧在 Suspense 内提交后再等两帧才发）。
	 * 既是排队截图的时机，也是位图向活体交接的时机——早于它切过去会露出白底。
	 */
	onRendered(frameId: string): void;
	/** 该 frame 编译/渲染失败（message）或恢复正常（null）。 */
	onFrameError(frameId: string, message: string | null): void;
	/**
	 * 元素选择期间在 frame 内右键。坐标已经换算成视口坐标（clientX/Y），跟画布自己
	 * 那层 contextmenu 拿到的是同一套。
	 */
	onFrameContextMenu(frameId: string, clientX: number, clientY: number): void;
	/**
	 * 元素选择期间在 frame 内滚轮。跨源 iframe 会把 wheel 整个吃掉，画布容器上的监听
	 * 收不到，缩放/平移必须靠这条转发。坐标同样已换算成视口坐标。
	 */
	onFrameWheel(event: FrameWheel): void;
	/** frame 内按下/松开空格（临时托手工具）。焦点在 iframe 里时只能从这里过来。 */
	onFrameSpace(down: boolean): void;
}

export interface FrameWheel {
	clientX: number;
	clientY: number;
	deltaX: number;
	deltaY: number;
	ctrlKey: boolean;
	metaKey: boolean;
}

interface PendingCapture {
	frameId: string;
	resolve(dataUrl: string): void;
	reject(error: Error): void;
	timer: number;
}

interface PendingResolve {
	resolve(payload: SelectedElementPayload | null): void;
	timer: number;
}

/** 备注锚定的元素查询：按坐标（放置时 hit-test）或按 domPath（读取时保鲜）。 */
export type ElementQuery = { x: number; y: number } | { domPath: string };

export class BridgeHub {
	private readonly frames = new Map<string, HTMLIFrameElement>();
	private readonly captures = new Map<string, PendingCapture>();
	private readonly resolves = new Map<string, PendingResolve>();
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
				// 这一帧重新装了一次 bridge——它是个全新的文档，不认识之前发出去的
				// requestId。挂起的截图等到天荒地老也等不来回音，直接判死。
				this.abortCaptures(frameId, "the frame reloaded while capturing (a build error recovery or HMR reload)");
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
				if (frameId) this.events?.onExitInspect(frameId, data.hadSelection === true);
				return;
			case "context-menu": {
				if (!frameId) return;
				const point = this.toViewportPoint(frameId, data.x, data.y);
				if (!point) return;
				this.events?.onFrameContextMenu(frameId, point.x, point.y);
				return;
			}
			case "wheel": {
				if (!frameId) return;
				const point = this.toViewportPoint(frameId, data.x, data.y);
				if (!point) return;
				this.events?.onFrameWheel({
					clientX: point.x,
					clientY: point.y,
					deltaX: typeof data.deltaX === "number" ? data.deltaX : 0,
					deltaY: typeof data.deltaY === "number" ? data.deltaY : 0,
					ctrlKey: data.ctrlKey === true,
					metaKey: data.metaKey === true,
				});
				return;
			}
			case "space":
				this.events?.onFrameSpace(data.down === true);
				return;
			case "hmr-updated":
				this.events?.onHmrUpdated(frameId);
				return;
			case "element-resolved": {
				const requestId = typeof data.requestId === "string" ? data.requestId : "";
				const pending = this.resolves.get(requestId);
				if (!pending) return;
				this.resolves.delete(requestId);
				window.clearTimeout(pending.timer);
				pending.resolve((data.payload as SelectedElementPayload | null) ?? null);
				return;
			}
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
		for (const pending of this.resolves.values()) {
			window.clearTimeout(pending.timer);
			pending.resolve(null);
		}
		this.resolves.clear();
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
		this.abortCaptures(frameId, "the frame's iframe was unmounted while capturing");
	}

	/**
	 * 判掉这一帧所有挂起的截图。
	 *
	 * 没有这一步，「iframe 在截图途中重载/卸载」的表现就是干等满整个超时（工具侧
	 * 30s），报出来还是一句「capture timed out」——真正的原因（页面换了一个文档）
	 * 一点痕迹都不留。而这种重载恰恰是常态：编译失败恢复时 bridge 会整页 reload。
	 */
	private abortCaptures(frameId: string, reason: string): void {
		for (const [requestId, pending] of this.captures) {
			if (pending.frameId !== frameId) continue;
			this.captures.delete(requestId);
			window.clearTimeout(pending.timer);
			pending.reject(new Error(`capture aborted for frame "${frameId}": ${reason} — retry.`));
		}
	}

	/**
	 * 等这一帧的 bridge 装好，返回是否等到。iframe 是按需挂载的，截图往往紧跟着
	 * 挂载发出，消息发给一个还没装 bridge 的文档就石沉大海——表现是截图一路干等
	 * 到超时。等不到就别发了：那多半是引擎入口整个没起来（theme.css/styles.css
	 * 编译失败会连 bridge 一起带走），再等一轮截图超时只是把 8s 拖成 38s。
	 */
	private waitReady(frameId: string, timeoutMs: number): Promise<boolean> {
		if (this.ready.has(frameId)) return Promise.resolve(true);
		return new Promise<boolean>((resolve) => {
			const waiters = this.readyWaiters.get(frameId) ?? new Set<() => void>();
			this.readyWaiters.set(frameId, waiters);
			let timer = 0;
			const done = (): void => {
				window.clearTimeout(timer);
				resolve(true);
			};
			timer = window.setTimeout(() => {
				waiters.delete(done);
				resolve(false);
			}, timeoutMs);
			waiters.add(done);
		});
	}

	/**
	 * iframe 内坐标 → 视口坐标。iframe 整个挂在画布的 scale 变换下，所以除了平移还得
	 * 按缩放比换算；比例直接从渲染后的矩形与布局宽度取，不用把画布的 zoom 传进来。
	 */
	private toViewportPoint(frameId: string, rawX: unknown, rawY: unknown): { x: number; y: number } | null {
		const iframe = this.frames.get(frameId);
		if (!iframe) return null;
		const rect = iframe.getBoundingClientRect();
		const scale = iframe.offsetWidth > 0 ? rect.width / iframe.offsetWidth : 1;
		const x = typeof rawX === "number" ? rawX : 0;
		const y = typeof rawY === "number" ? rawY : 0;
		return { x: rect.left + x * scale, y: rect.top + y * scale };
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

	/**
	 * 备注锚定的元素查询。查不到、iframe 没挂、bridge 没就绪、超时都返回 null——
	 * 锚不上元素备注照样成立（frame 锚），这条路上没有值得抛给用户的错误。
	 */
	async resolveElement(frameId: string, query: ElementQuery, timeoutMs = 5_000): Promise<SelectedElementPayload | null> {
		if (!this.frames.has(frameId)) return null;
		if (!(await this.waitReady(frameId, READY_TIMEOUT_MS))) return null;
		if (!this.frames.has(frameId)) return null;
		this.captureCounter += 1;
		const requestId = `res-${this.captureCounter}`;
		return new Promise<SelectedElementPayload | null>((resolve) => {
			const timer = window.setTimeout(() => {
				this.resolves.delete(requestId);
				resolve(null);
			}, timeoutMs);
			this.resolves.set(requestId, { resolve, timer });
			this.post(frameId, { type: "resolve-element", requestId, ...query });
		});
	}

	async capture(
		frameId: string,
		options?: {
			keepHighlight?: boolean;
			timeoutMs?: number;
			pixelRatio?: number;
			/** 默认 png。画布位图化用 jpeg：同像素数下 dataUrl 小一个量级。 */
			format?: "png" | "jpeg";
			quality?: number;
		},
	): Promise<string> {
		if (!this.frames.has(frameId)) throw new Error(`frame not mounted: ${frameId}`);
		if (!(await this.waitReady(frameId, READY_TIMEOUT_MS))) {
			throw new Error(
				`frame "${frameId}" never loaded (no bridge after ${READY_TIMEOUT_MS / 1000}s) — the design engine likely failed to build`,
			);
		}
		if (!this.frames.has(frameId)) throw new Error(`frame not mounted: ${frameId}`);
		this.captureCounter += 1;
		const requestId = `cap-${this.captureCounter}`;
		const timeoutMs = options?.timeoutMs ?? 15_000;
		const iframe = this.frames.get(frameId);
		// 超时那一刻这些都取不到了（iframe 可能已经没了），先记下来。
		const size = iframe ? `${iframe.offsetWidth}x${iframe.offsetHeight}` : "unknown size";
		const ratio = options?.pixelRatio ?? 2;
		return new Promise<string>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.captures.delete(requestId);
				reject(
					new Error(
						`capture timed out for frame "${frameId}" after ${timeoutMs / 1000}s ` +
							`(${size} at ${ratio}x, ${this.captures.size} other capture(s) in flight). ` +
							`The frame is most likely too large or too heavy to rasterize — check for oversized images or a very tall page.`,
					),
				);
			}, timeoutMs);
			this.captures.set(requestId, { frameId, resolve, reject, timer });
			this.post(frameId, {
				type: "capture",
				requestId,
				keepHighlight: options?.keepHighlight === true,
				pixelRatio: options?.pixelRatio,
				format: options?.format ?? "png",
				quality: options?.quality,
			});
		});
	}
}
