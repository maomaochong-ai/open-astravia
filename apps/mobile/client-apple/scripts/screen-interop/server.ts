/** Local, ephemeral v2 control/signaling fixture for the iPhone video test. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RemoteTransport, RemoteTransportHandlers } from "@vetta/remote-control";
import {
	buildPairingUri,
	encodeRemoteFrame,
	generateIdentityKeyPair,
	KEEPALIVE_PING,
	KEEPALIVE_PONG,
	parseRemoteFrame,
	RemoteConnection,
	RemoteEventJournal,
	randomToken,
	toBase64Url,
} from "@vetta/remote-control";
import { decodeRemoteDesktopSignal } from "@vetta/remote-desktop";
import type { ServerWebSocket } from "bun";

type SocketData = { role: "lan" | "host" | "viewer"; handlers?: RemoteTransportHandlers };
type Socket = ServerWebSocket<SocketData>;
const infoFile = process.argv[2];
if (!infoFile) throw new Error("Expected an output info file");
const identity = generateIdentityKeyPair();
const pairingId = randomToken(18);
const secret = randomToken(32);
const journal = new RemoteEventJournal();
let host: Socket | undefined;
let viewer: Socket | undefined;
let control: RemoteTransportHandlers | undefined;
const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, "host.ts")], target: "browser" });
if (!bundle.success) throw new Error("Screen host bundle failed");
const hostScript = await bundle.outputs[0].text();

function connect(transport: RemoteTransport) {
	const connection = new RemoteConnection(transport, {
		role: "desktop",
		handshake: "accept",
		identity,
		deviceId: "screen-fixture",
		deviceName: "Screen Fixture",
		capabilities: { chat: true, sessionRead: true, screen: true },
		journal,
		onHello: () => ({ kind: "approve" }),
	});
	connection.onEvent((event) => {
		if (event.type === "state" && event.state === "online") {
			void connection.emitEvent("device.status", {
				deviceName: "Screen Fixture",
				lanEndpoints: [`127.0.0.1:${server.port}`],
				relayEnabled: true,
				relayBaseUrl: `ws://127.0.0.1:${server.port}`,
				screen: true,
				desktopControl: true,
				runningSessionCount: 0,
			});
		}
		if (event.type !== "remote-request") return;
		const request = event.request;
		let payload: unknown = {};
		if (request.method === "session.list") payload = { sessions: [] };
		if (request.method === "project.list") payload = { projects: [] };
		if (request.method === "model.list") payload = { models: [] };
		if (request.method === "screen.subscribe") {
			const body = request.payload;
			const active = !!body && typeof body === "object" && "active" in body && body.active === true;
			host?.send(JSON.stringify({ type: "screen", active }));
			payload = { screen: active ? "streaming" : "stopped", input: "ready" };
		}
		void connection.respond(request.requestId, { success: true, payload });
	});
	void connection.connect();
}

const server = Bun.serve<SocketData>({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request, server) {
		const url = new URL(request.url);
		if (url.pathname === "/")
			return new Response('<script type="module" src="/host.js"></script>', {
				headers: { "content-type": "text/html" },
			});
		if (url.pathname === "/host.js")
			return new Response(hostScript, { headers: { "content-type": "text/javascript" } });
		if (url.pathname === "/config") return Response.json({ pairingId });
		if (url.pathname === "/ready") return new Response(null, { status: host ? 200 : 503 });
		let role: SocketData["role"] | undefined;
		if (url.pathname === "/host") role = "host";
		if (url.pathname === `/v2/lan/${pairingId}`) role = "lan";
		if (url.pathname === `/v2/desktop/${pairingId}/viewer`) role = "viewer";
		if (!role) return new Response(null, { status: 404 });
		const protocols =
			request.headers
				.get("sec-websocket-protocol")
				?.split(",")
				.map((value) => value.trim()) ?? [];
		if (role !== "host" && !protocols.includes(`vetta.pairing.${secret}`)) return new Response(null, { status: 401 });
		return server.upgrade(request, {
			data: { role },
			headers: protocols.length ? { "sec-websocket-protocol": protocols[0] } : undefined,
		})
			? undefined
			: new Response(null, { status: 400 });
	},
	websocket: {
		open(socket) {
			if (socket.data.role === "host") host = socket;
			if (socket.data.role === "viewer") viewer = socket;
			if (host && viewer)
				host.send(JSON.stringify({ type: "signal", signal: { type: "peer_ready", protocolVersion: 1 } }));
			if (socket.data.role === "lan")
				connect({
					async connect(handlers) {
						socket.data.handlers = handlers;
					},
					async send(frame) {
						socket.send(encodeRemoteFrame(frame));
					},
					async close() {
						socket.close();
					},
				});
		},
		message(socket, data) {
			if (typeof data !== "string") return;
			try {
				if (socket.data.role === "lan") {
					for (const line of data.split("\n").filter(Boolean)) {
						if (line === KEEPALIVE_PING) socket.send(KEEPALIVE_PONG);
						else socket.data.handlers?.onFrame(parseRemoteFrame(line));
					}
					return;
				}
				if (socket.data.role === "viewer") {
					for (const line of data.split("\n").filter(Boolean)) {
						host?.send(JSON.stringify({ type: "signal", signal: decodeRemoteDesktopSignal(JSON.parse(line)) }));
					}
					return;
				}
				const message: unknown = JSON.parse(data);
				if (!message || typeof message !== "object" || !("type" in message)) return;
				if (message.type === "signal" && "signal" in message)
					viewer?.send(`${JSON.stringify(decodeRemoteDesktopSignal(message.signal))}\n`);
				if (message.type === "control-open") {
					control?.onClose("replaced");
					connect({
						async connect(handlers) {
							control = handlers;
						},
						async send(frame) {
							host?.send(JSON.stringify({ type: "control", text: encodeRemoteFrame(frame) }));
						},
						async close() {
							control = undefined;
						},
					});
				}
				if (message.type === "control" && "text" in message && typeof message.text === "string")
					control?.onFrame(parseRemoteFrame(message.text.trim()));
				if (message.type === "control-close") control?.onClose("channel closed");
			} catch {
				// Never log the encrypted control payload, SDP or pairing credentials.
				console.error("Invalid screen fixture message");
				socket.close(1002);
			}
		},
		close(socket) {
			if (socket === viewer) viewer = undefined;
			if (socket === host) {
				host = undefined;
				control?.onClose("host closed");
			}
			socket.data.handlers?.onClose("closed");
		},
	},
});
writeFileSync(
	infoFile,
	JSON.stringify({
		port: server.port,
		invite: buildPairingUri({
			version: 2,
			pairingId,
			mobileSecret: secret,
			desktopIdentityKey: toBase64Url(identity.publicKey),
			desktopName: "Screen Fixture",
			lanEndpoints: [`127.0.0.1:${server.port}`],
			relayBaseUrl: `ws://127.0.0.1:${server.port}`,
		}),
	}),
);
