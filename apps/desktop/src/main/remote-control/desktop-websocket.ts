import type { RemoteWebSocket, RemoteWebSocketFactory } from "@vetta/remote-control";
import type { RawData } from "ws";
import NodeWebSocket from "ws";

/** Minimal Node WebSocket surface kept separate from the platform-neutral transport. */
export interface NodeRemoteWebSocket {
	readonly readyState: number;
	on(event: "open", listener: () => void): this;
	on(event: "error", listener: (error: unknown) => void): this;
	on(event: "close", listener: (code: number, reason: Buffer) => void): this;
	on(event: "message", listener: (data: RawData, isBinary: boolean) => void): this;
	send(data: string): void;
	close(): void;
}

export function createDesktopWebSocketFactory(): RemoteWebSocketFactory {
	return (url, protocols) => adaptNodeWebSocket(new NodeWebSocket(url, protocols ? [...protocols] : undefined));
}

export function adaptNodeWebSocket(socket: NodeRemoteWebSocket): RemoteWebSocket {
	const adapter: RemoteWebSocket = {
		get readyState() {
			return socket.readyState;
		},
		onopen: null,
		onerror: null,
		onclose: null,
		onmessage: null,
		send(data) {
			socket.send(data);
		},
		close() {
			socket.close();
		},
	};
	socket.on("open", () => adapter.onopen?.());
	socket.on("error", () => adapter.onerror?.());
	socket.on("close", (_code, reason) => adapter.onclose?.({ reason: reason.toString() }));
	socket.on("message", (data, isBinary) => {
		adapter.onmessage?.({ data: isBinary ? data : rawDataToText(data) });
	});
	return adapter;
}

function rawDataToText(data: RawData): string {
	if (typeof data === "string") return data;
	if (Buffer.isBuffer(data)) return data.toString("utf8");
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
	return Buffer.concat(data).toString("utf8");
}
