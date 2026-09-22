import { encodeRemoteFrame, parseRemoteFrame } from "../src/protocol.ts";
import { KEEPALIVE_PING, KEEPALIVE_PONG } from "../src/websocket-transport.ts";
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
		const match = /^\/v2\/relay\/([^/]+)\/(mobile|desktop)$/.exec(url.pathname);
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
				// The Cloudflare relay answers keepalives without waking the room; do the same.
				if (line === KEEPALIVE_PING) {
					socket.send(KEEPALIVE_PONG);
					continue;
				}
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
				if (frame.type !== "sealed") return closeInvalid(socket, "only sealed frames cross the relay");
				const peer = peerFor(socket);
				if (!peer?.data.hello) {
					socket.send(encodeRemoteFrame({ type: "peer_status", online: false }));
					continue;
				}
				peer.send(encodeRemoteFrame(frame));
			}
		},
		close(socket) {
			const room = rooms.get(socket.data.pairingId);
			if (!room || room[socket.data.role] !== socket) return;
			delete room[socket.data.role];
			peerFor(socket)?.send(encodeRemoteFrame({ type: "peer_status", online: false }));
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
			protocolVersion: 2,
			connectionId: mobile.data.hello.connectionId,
			peerDeviceId: desktop.data.hello.deviceId,
			peerIdentityKey: desktop.data.hello.identityKey,
			peerEphemeralKey: desktop.data.hello.ephemeralKey,
		}),
	);
	desktop.send(
		encodeRemoteFrame({
			type: "hello_ack",
			protocolVersion: 2,
			connectionId: desktop.data.hello.connectionId,
			peerDeviceId: mobile.data.hello.deviceId,
			peerIdentityKey: mobile.data.hello.identityKey,
			peerEphemeralKey: mobile.data.hello.ephemeralKey,
		}),
	);
}

function closeInvalid(socket: RelaySocket, reason: string): void {
	socket.close(1003, reason);
}
