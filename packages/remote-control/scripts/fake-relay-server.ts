import { encodeRemoteFrame, parseRemoteFrame } from "../src/protocol.ts";
import type { RemoteHello, RemoteFrame, RemoteRole } from "../src/types.ts";

type ClientRole = Exclude<RemoteRole, "relay">;
type RelaySocket = ServerWebSocket<{ pairingId: string; role: ClientRole; hello?: RemoteHello }>;

interface RelayRoom {
	mobile?: RelaySocket;
	desktop?: RelaySocket;
}

const rooms = new Map<string, RelayRoom>();
const port = Number(process.env.VETTA_FAKE_RELAY_PORT ?? 8787);

const server = Bun.serve<{ pairingId: string; role: ClientRole }>({
	port,
	fetch(request, server) {
		const url = new URL(request.url);
		if (url.pathname === "/health") return Response.json({ ok: true, rooms: rooms.size });
		const match = /^\/relay\/([^/]+)\/(mobile|desktop)$/.exec(url.pathname);
		if (!match) return new Response("Not Found", { status: 404 });
		const upgraded = server.upgrade(request, {
			data: { pairingId: decodeURIComponent(match[1]), role: match[2] as ClientRole },
		});
		return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
	},
	websocket: {
		open(socket) {
			const room = rooms.get(socket.data.pairingId) ?? {};
			const current = room[socket.data.role];
			current?.close(1012, "replaced by a new connection");
			room[socket.data.role] = socket;
			rooms.set(socket.data.pairingId, room);
		},
		message(socket, message) {
			if (typeof message !== "string") return closeInvalid(socket, "only text frames are supported");
			for (const line of message.split("\n").filter(Boolean)) {
				let frame: RemoteFrame;
				try {
					frame = parseRemoteFrame(line);
				} catch {
					closeInvalid(socket, "invalid protocol frame");
					return;
				}
				if (frame.type === "hello") {
					socket.data.hello = frame;
					acknowledge(socket.data.pairingId);
					continue;
				}
				const peer = peerFor(socket);
				if (!peer?.data.hello) return closeInvalid(socket, "relay peer is offline");
				peer.send(encodeRemoteFrame(frame));
			}
		},
		close(socket) {
			const room = rooms.get(socket.data.pairingId);
			if (!room || room[socket.data.role] !== socket) return;
			delete room[socket.data.role];
			peerFor(socket)?.close(1011, "relay peer disconnected");
			if (!room.mobile && !room.desktop) rooms.delete(socket.data.pairingId);
		},
	},
});

console.info(`[fake-relay] listening on http://127.0.0.1:${server.port}`);

function peerFor(socket: RelaySocket): RelaySocket | undefined {
	const room = rooms.get(socket.data.pairingId);
	return socket.data.role === "mobile" ? room?.desktop : room?.mobile;
}

function acknowledge(pairingId: string): void {
	const room = rooms.get(pairingId);
	const mobile = room?.mobile;
	const desktop = room?.desktop;
	if (!mobile?.data.hello || !desktop?.data.hello) return;
	mobile.send(
		encodeRemoteFrame({
			type: "hello_ack",
			protocolVersion: 1,
			connectionId: mobile.data.hello.connectionId,
			peerDeviceId: desktop.data.hello.deviceId,
		}),
	);
	desktop.send(
		encodeRemoteFrame({
			type: "hello_ack",
			protocolVersion: 1,
			connectionId: desktop.data.hello.connectionId,
			peerDeviceId: mobile.data.hello.deviceId,
		}),
	);
}

function closeInvalid(socket: RelaySocket, reason: string): void {
	socket.close(1003, reason);
}
