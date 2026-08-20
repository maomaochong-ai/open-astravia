import { DurableObject } from "cloudflare:workers";
import {
	encodeRemoteDesktopSignal,
	parseRemoteDesktopSignal,
	REMOTE_DESKTOP_PROTOCOL_VERSION,
	REMOTE_DESKTOP_WEBSOCKET_PROTOCOL,
	type RemoteDesktopSignal,
} from "@vetta/remote-desktop/protocol";
import { relayInfo, relayWarn } from "./relay-log.js";
import { RoomAuthorization } from "./room-authorization.js";

interface Env {
	readonly REMOTE_DESKTOP_ROOM: DurableObjectNamespace<RemoteDesktopRoom>;
}

type DesktopRole = "host" | "viewer";

interface DesktopAttachment {
	readonly role: DesktopRole;
	readonly roomTag: string;
	readonly superseded?: boolean;
}

const EXPIRES_AT_KEY = "expiresAt";
const ROOM_IDLE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_SIGNAL_CHARS = 262_656;

export class RemoteDesktopRoom extends DurableObject<Env> {
	private readonly authorization = new RoomAuthorization(this.ctx);

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
			return response("WebSocket upgrade required", 426);
		const role = desktopRole(request.headers.get("X-Vetta-Desktop-Role"));
		const credentialHash = request.headers.get("X-Vetta-Credential-Hash");
		const roomTag = request.headers.get("X-Vetta-Room-Tag");
		if (!role || !credentialHash || !roomTag) return response("Invalid desktop relay request", 400);
		const authorized =
			role === "host"
				? await this.authorization.authorizeDesktop(credentialHash)
				: request.headers.get("X-Vetta-Preauthorized") === "mobile" ||
					Boolean(await this.authorization.authorizeMobile(credentialHash));
		if (!authorized) {
			relayWarn("desktop_connection_rejected", { roomTag, role, reason: "invalid_pairing" });
			return response("Pairing authorization failed", 401);
		}
		for (const existing of this.ctx.getWebSockets(role)) {
			const attachment = readAttachment(existing);
			existing.serializeAttachment({ ...attachment, superseded: true });
			existing.close(4001, "Connection replaced");
		}
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		server.serializeAttachment({ role, roomTag } satisfies DesktopAttachment);
		this.ctx.acceptWebSocket(server, [role]);
		this.notifyHostWhenPeerReady(role, server, roomTag);
		await this.refreshExpiry();
		relayInfo("desktop_socket_connected", { roomTag, role });
		return new Response(null, {
			status: 101,
			headers: { "Sec-WebSocket-Protocol": REMOTE_DESKTOP_WEBSOCKET_PROTOCOL },
			webSocket: client,
		});
	}

	async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const attachment = readAttachment(socket);
		if (typeof message !== "string" || message.length > MAX_SIGNAL_CHARS) {
			this.reject(socket, attachment, "invalid_message_shape");
			return;
		}
		let signal: RemoteDesktopSignal;
		try {
			signal = parseRemoteDesktopSignal(message);
		} catch {
			this.reject(socket, attachment, "invalid_signal");
			return;
		}
		if (
			signal.type === "peer_ready" ||
			(signal.type === "offer" && attachment.role !== "host") ||
			(signal.type === "answer" && attachment.role !== "viewer")
		) {
			this.reject(socket, attachment, "invalid_signal_direction");
			return;
		}
		const peer = this.ctx.getWebSockets(opposite(attachment.role))[0];
		if (!peer) {
			if (signal.type === "end") return;
			this.reject(socket, attachment, "peer_offline", 4004);
			return;
		}
		peer.send(message);
		relayInfo("desktop_signal_forwarded", {
			roomTag: attachment.roomTag,
			role: attachment.role,
			signalType: signal.type,
		});
	}

	async webSocketClose(socket: WebSocket): Promise<void> {
		const attachment = readAttachment(socket);
		if (!attachment.superseded)
			this.ctx.getWebSockets(opposite(attachment.role))[0]?.close(1012, "Peer disconnected");
		await this.refreshExpiry();
		relayInfo("desktop_socket_closed", {
			roomTag: attachment.roomTag,
			role: attachment.role,
			superseded: attachment.superseded,
		});
	}

	async webSocketError(socket: WebSocket): Promise<void> {
		const attachment = readAttachment(socket);
		relayWarn("desktop_socket_error", { roomTag: attachment.roomTag, role: attachment.role });
		socket.close(1011, "Desktop relay socket error");
	}

	async alarm(): Promise<void> {
		const expiresAt = await this.ctx.storage.get<number>(EXPIRES_AT_KEY);
		if (this.ctx.getWebSockets().length > 0 || (expiresAt !== undefined && expiresAt > Date.now())) {
			await this.refreshExpiry();
			return;
		}
		await this.ctx.storage.deleteAll();
		relayInfo("desktop_room_expired");
	}

	private reject(socket: WebSocket, attachment: DesktopAttachment, reason: string, code = 4002): void {
		relayWarn("desktop_socket_rejected", { roomTag: attachment.roomTag, role: attachment.role, reason });
		socket.close(code, "Invalid remote desktop signal");
	}

	private notifyHostWhenPeerReady(role: DesktopRole, socket: WebSocket, roomTag: string): void {
		const host = role === "host" ? socket : this.ctx.getWebSockets("host")[0];
		const viewer = role === "viewer" ? socket : this.ctx.getWebSockets("viewer")[0];
		if (!host || !viewer) return;
		host.send(
			encodeRemoteDesktopSignal({
				type: "peer_ready",
				protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
			}),
		);
		relayInfo("desktop_peer_ready", { roomTag });
	}

	private async refreshExpiry(): Promise<void> {
		const expiresAt = Date.now() + ROOM_IDLE_TTL_MS;
		await this.ctx.storage.put(EXPIRES_AT_KEY, expiresAt);
		await this.ctx.storage.setAlarm(expiresAt);
	}
}

function readAttachment(socket: WebSocket): DesktopAttachment {
	return socket.deserializeAttachment() as DesktopAttachment;
}

function desktopRole(value: string | null): DesktopRole | undefined {
	return value === "host" || value === "viewer" ? value : undefined;
}

function opposite(role: DesktopRole): DesktopRole {
	return role === "host" ? "viewer" : "host";
}

function response(message: string, status: number): Response {
	return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
