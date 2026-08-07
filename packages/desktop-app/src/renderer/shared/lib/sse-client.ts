type SSEEventHandler = (data: unknown) => void;
const HostEventSource = globalThis.EventSource;

export type SSEConnectionState = "disconnected" | "connecting" | "connected";

export interface SSEClient {
	connect: (baseUrl: string, token: string) => void;
	disconnect: () => void;
	on: (eventType: string, handler: SSEEventHandler) => () => void;
	getState: () => SSEConnectionState;
	onStateChange: (handler: (state: SSEConnectionState) => void) => () => void;
}

export function createSSEClient(): SSEClient {
	let eventSource: EventSource | null = null;
	let state: SSEConnectionState = "disconnected";
	let retryCount = 0;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let currentBaseUrl = "";
	let currentToken = "";

	const listeners = new Map<string, Set<SSEEventHandler>>();
	const stateListeners = new Set<(state: SSEConnectionState) => void>();

	function setState(newState: SSEConnectionState): void {
		if (state === newState) return;
		state = newState;
		for (const listener of stateListeners) {
			listener(newState);
		}
	}

	function getRetryDelay(): number {
		const base = Math.min(1000 * 2 ** retryCount, 30000);
		// jitter: +/- 20%
		return base * (0.8 + Math.random() * 0.4);
	}

	function emit(eventType: string, data: unknown): void {
		const handlers = listeners.get(eventType);
		if (!handlers) return;
		for (const handler of handlers) {
			try {
				handler(data);
			} catch (err) {
				console.error(`[SSE] handler error for "${eventType}":`, err);
			}
		}
	}

	function addCustomEventListener(es: EventSource, eventType: string): void {
		es.addEventListener(eventType, ((e: MessageEvent) => {
			try {
				const raw = JSON.parse(e.data);
				// 统一解包：如果服务端返回 {type, payload, timestamp} 结构，只传递 payload
				const data = raw != null && typeof raw === "object" && "payload" in raw ? raw.payload : raw;
				emit(eventType, data);
			} catch {
				// ignore
			}
		}) as EventListener);
	}

	function doConnect(): void {
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}

		setState("connecting");

		const url = `${currentBaseUrl}/events/stream?token=${encodeURIComponent(currentToken)}`;
		const es = new HostEventSource(url);
		eventSource = es;

		es.addEventListener("connected", (e) => {
			retryCount = 0;
			setState("connected");
			try {
				emit("connected", JSON.parse((e as MessageEvent).data));
			} catch {
				// ignore
			}
		});

		es.addEventListener("message", (e) => {
			try {
				const data = JSON.parse((e as MessageEvent).data);
				emit("message", data);
			} catch {
				// ignore
			}
		});

		// 重新绑定所有已注册的自定义事件类型
		for (const eventType of listeners.keys()) {
			if (eventType !== "connected" && eventType !== "message") {
				addCustomEventListener(es, eventType);
			}
		}

		es.onerror = () => {
			es.close();
			if (eventSource === es) {
				eventSource = null;
				setState("disconnected");
				scheduleRetry();
			}
		};
	}

	function scheduleRetry(): void {
		if (retryTimer) return;
		if (!currentToken) return;
		const delay = getRetryDelay();
		retryCount++;
		retryTimer = setTimeout(() => {
			retryTimer = null;
			if (currentToken) {
				doConnect();
			}
		}, delay);
	}

	function connect(baseUrl: string, token: string): void {
		currentBaseUrl = baseUrl;
		currentToken = token;
		retryCount = 0;
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		doConnect();
	}

	function disconnect(): void {
		currentToken = "";
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
		setState("disconnected");
	}

	function on(eventType: string, handler: SSEEventHandler): () => void {
		let handlers = listeners.get(eventType);
		if (!handlers) {
			handlers = new Set();
			listeners.set(eventType, handlers);

			// Register on EventSource if connected
			if (eventSource && eventType !== "connected" && eventType !== "message") {
				addCustomEventListener(eventSource, eventType);
			}
		}
		handlers.add(handler);

		return () => {
			handlers!.delete(handler);
			if (handlers!.size === 0) {
				listeners.delete(eventType);
			}
		};
	}

	return {
		connect,
		disconnect,
		on,
		getState: () => state,
		onStateChange: (handler) => {
			stateListeners.add(handler);
			return () => stateListeners.delete(handler);
		},
	};
}
