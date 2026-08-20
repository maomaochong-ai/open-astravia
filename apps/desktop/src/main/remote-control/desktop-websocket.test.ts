import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { adaptNodeWebSocket, createDesktopWebSocketFactory, type NodeRemoteWebSocket } from "./desktop-websocket.js";

class FakeNodeWebSocket extends EventEmitter implements NodeRemoteWebSocket {
	readonly readyState = 1;
	sent: string[] = [];
	closed = false;

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed = true;
	}
}

describe("desktop Node WebSocket adapter", () => {
	it("maps ws events to the platform-neutral transport contract", () => {
		const nodeSocket = new FakeNodeWebSocket();
		const socket = adaptNodeWebSocket(nodeSocket);
		let opened = false;
		let received = "";
		let closed = "";
		socket.onopen = () => {
			opened = true;
		};
		socket.onmessage = (event) => {
			received = String(event.data);
		};
		socket.onclose = (event) => {
			closed = event.reason ?? "";
		};

		nodeSocket.emit("open");
		nodeSocket.emit("message", Buffer.from("hello\n"), false);
		nodeSocket.emit("close", 1000, Buffer.from("done"));
		socket.send("outgoing");
		socket.close();

		expect(opened).toBe(true);
		expect(received).toBe("hello\n");
		expect(closed).toBe("done");
		expect(nodeSocket.sent).toEqual(["outgoing"]);
		expect(nodeSocket.closed).toBe(true);
	});

	it("connects with the Node ws implementation when no browser WebSocket global exists", async () => {
		const server = new WebSocketServer({ port: 0 });
		await new Promise<void>((resolve) => server.once("listening", resolve));
		const address = server.address();
		if (typeof address === "string" || address === null) throw new Error("WebSocket test server has no TCP port");

		const serverReceived = new Promise<string>((resolve) => {
			server.once("connection", (client) => {
				client.once("message", (data) => resolve(data.toString()));
				client.send("from-server");
			});
		});
		const socket = createDesktopWebSocketFactory()(`ws://127.0.0.1:${address.port}`);
		const clientReceived = new Promise<string>((resolve, reject) => {
			socket.onopen = () => socket.send("from-client");
			socket.onmessage = (event) => resolve(String(event.data));
			socket.onerror = () => reject(new Error("Node WebSocket adapter failed to connect"));
		});

		try {
			expect(await clientReceived).toBe("from-server");
			expect(await serverReceived).toBe("from-client");
		} finally {
			socket.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
