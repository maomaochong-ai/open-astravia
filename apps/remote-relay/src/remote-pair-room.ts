import { DurableObject } from "cloudflare:workers";
import {
	encodeRemoteFrame,
	KEEPALIVE_PING,
	KEEPALIVE_PONG,
	parseRemoteFrame,
	REMOTE_PROTOCOL_VERSION,
	type RemoteFrame,
	type RemoteHello,
} from "@vetta/remote-control";
import type { RelayRole } from "./auth.js";
import { REMOTE_WEBSOCKET_PROTOCOL } from "./auth.js";
import { relayInfo, relayWarn } from "./relay-log.js";
import { RoomAuthorization } from "./room-authorization.js";

interface Env {
	readonly REMOTE_PAIR_ROOM: DurableObjectNamespace<RemotePairRoom>;
}

/** Kept small on purpose: it is serialized into the hibernatable socket. */
interface ConnectionAttachment {
	readonly role: RelayRole;
	readonly roomTag: string;
	readonly authenticated: boolean;
	readonly superseded?: boolean;
	readonly deviceId?: string;
	readonly connectionId?: string;
	readonly identityKey?: string;
	readonly ephemeralKey?: string;
}

const EXPIRES_AT_KEY = "expiresAt";
const ROOM_IDLE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_MESSAGE_CHARS = 1_500_000;

/**
 * One room per paired phone. The desktop registers it and stays parked while
 * the phone comes and goes. After each side's plaintext `hello`, the room only
 * copies public keys into `hello_ack`s and forwards sealed envelopes; it never
 * interprets session traffic and cannot decrypt it.
 */
export class RemotePairRoom extends DurableObject<Env> {
	private readonly authorization = new RoomAuthorization(this.ctx);

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// Keepalives are answered by the runtime while the object stays
		// hibernated, so an idle pair costs no billable duration.
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE_PING, KEEPALIVE_PONG));
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method === "POST" && new URL(request.url).pathname.endsWith("/authorize")) {
			// Check-only lookup for the WebRTC room; never registers a fresh room.
			const role = parseRole(request.headers.get("X-Vetta-Relay-Role"));
			const credentialHash = request.headers.get("X-Vetta-Credential-Hash");
			if (!role || !credentialHash) return response("Unauthorized", 401);
			const authorized =
				role === "desktop"
					? await this.authorization.authorizeDesktop(credentialHash)
					: await this.authorization.authorizeMobile(credentialHash);
			return authorized ? new Response(null, { status: 204 }) : response("Unauthorized", 401);
		}
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return response("WebSocket upgrade required", 426);
		}
		const role = parseRole(request.headers.get("X-Vetta-Relay-Role"));
		const credentialHash = request.headers.get("X-Vetta-Credential-Hash");
		const roomTag = request.headers.get("X-Vetta-Room-Tag");
		if (!role || !credentialHash || !roomTag) return response("Invalid relay request", 400);
		const peerHash = request.headers.get("X-Vetta-Peer-Hash") ?? undefined;
		const authorized =
			role === "desktop"
				? await this.authorization.authorizeDesktop(credentialHash, peerHash)
				: await this.authorization.authorizeMobile(credentialHash);
		if (!authorized) {
			relayWarn("connection_rejected", {
				roomTag,
				role,
				reason: role === "mobile" ? "not_registered_or_invalid" : "invalid_or_missing_peer_hash",
			});
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
		server.serializeAttachment({ role, roomTag, authenticated: false } satisfies ConnectionAttachment);
		this.ctx.acceptWebSocket(server, [role]);
		await this.refreshExpiry();
		relayInfo("socket_connected", { roomTag, role });
		return new Response(null, {
			status: 101,
			headers: { "Sec-WebSocket-Protocol": REMOTE_WEBSOCKET_PROTOCOL },
			webSocket: client,
		});
	}

	async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		let attachment = readAttachment(socket);
		if (typeof message !== "string" || message.length > MAX_MESSAGE_CHARS) {
			this.rejectSocket(socket, attachment, "invalid_message_shape");
			return;
		}
		const lines = message.split("\n").filter(Boolean);
		if (lines.length === 0) {
			this.rejectSocket(socket, attachment, "empty_message");
			return;
		}
		for (const line of lines) {
			if (line === KEEPALIVE_PING || line === KEEPALIVE_PONG) continue;
			// `hello` and the first sealed frame may arrive in one message.
			// Re-read the attachment so the synchronous hello transition is
			// visible to the next line.
			attachment = readAttachment(socket);
			let frame: RemoteFrame;
			try {
				frame = parseRemoteFrame(line);
			} catch {
				this.rejectSocket(socket, attachment, "invalid_frame");
				return;
			}
			if (!attachment.authenticated) {
				if (frame.type !== "hello" || frame.role !== attachment.role) {
					this.rejectSocket(socket, attachment, "invalid_handshake");
					return;
				}
				this.acceptHello(socket, attachment, frame);
				continue;
			}
			if (frame.type !== "sealed") {
				this.rejectSocket(socket, attachment, "plaintext_after_handshake");
				return;
			}
			this.forwardSealed(socket, attachment, frame);
		}
	}

	async webSocketClose(socket: WebSocket): Promise<void> {
		const attachment = readAttachment(socket);
		if (!attachment.superseded && attachment.authenticated) {
			for (const peer of this.authenticatedSockets(opposite(attachment.role))) {
				peer.send(encodeRemoteFrame({ type: "peer_status", online: false }));
			}
		}
		await this.refreshExpiry();
		relayInfo("socket_closed", {
			roomTag: attachment.roomTag,
			role: attachment.role,
			superseded: attachment.superseded,
		});
	}

	async webSocketError(socket: WebSocket): Promise<void> {
		const attachment = readAttachment(socket);
		relayWarn("socket_error", { roomTag: attachment.roomTag, role: attachment.role });
		socket.close(1011, "Relay socket error");
	}

	async alarm(): Promise<void> {
		const expiresAt = await this.ctx.storage.get<number>(EXPIRES_AT_KEY);
		if (this.ctx.getWebSockets().length > 0 || (expiresAt !== undefined && expiresAt > Date.now())) {
			await this.refreshExpiry();
			return;
		}
		await this.ctx.storage.deleteAll();
		relayInfo("room_expired");
	}

	private acceptHello(socket: WebSocket, attachment: ConnectionAttachment, hello: RemoteHello): void {
		socket.serializeAttachment({
			...attachment,
			authenticated: true,
			deviceId: hello.deviceId,
			connectionId: hello.connectionId,
			identityKey: hello.identityKey,
			ephemeralKey: hello.ephemeralKey,
		} satisfies ConnectionAttachment);
		relayInfo("handshake_accepted", { roomTag: attachment.roomTag, role: attachment.role });
		this.acknowledgePair();
	}

	/** Re-run on every completed hello so a reconnecting phone re-keys the parked desktop. */
	private acknowledgePair(): void {
		const mobile = this.authenticatedSockets("mobile")[0];
		const desktop = this.authenticatedSockets("desktop")[0];
		if (!mobile || !desktop) return;
		const mobileAttachment = readAttachment(mobile);
		const desktopAttachment = readAttachment(desktop);
		if (!isComplete(mobileAttachment) || !isComplete(desktopAttachment)) return;
		mobile.send(
			encodeRemoteFrame({
				type: "hello_ack",
				protocolVersion: REMOTE_PROTOCOL_VERSION,
				connectionId: mobileAttachment.connectionId,
				peerDeviceId: desktopAttachment.deviceId,
				peerIdentityKey: desktopAttachment.identityKey,
				peerEphemeralKey: desktopAttachment.ephemeralKey,
			}),
		);
		desktop.send(
			encodeRemoteFrame({
				type: "hello_ack",
				protocolVersion: REMOTE_PROTOCOL_VERSION,
				connectionId: desktopAttachment.connectionId,
				peerDeviceId: mobileAttachment.deviceId,
				peerIdentityKey: mobileAttachment.identityKey,
				peerEphemeralKey: mobileAttachment.ephemeralKey,
			}),
		);
		relayInfo("pair_online", { roomTag: mobileAttachment.roomTag });
	}

	private forwardSealed(socket: WebSocket, attachment: ConnectionAttachment, frame: RemoteFrame): void {
		const peer = this.authenticatedSockets(opposite(attachment.role))[0];
		if (!peer) {
			socket.send(encodeRemoteFrame({ type: "peer_status", online: false }));
			return;
		}
		peer.send(encodeRemoteFrame(frame));
		relayInfo("frame_forwarded", { roomTag: attachment.roomTag, role: attachment.role, frameType: frame.type });
	}

	private authenticatedSockets(role: RelayRole): WebSocket[] {
		return this.ctx.getWebSockets(role).filter((socket) => readAttachment(socket).authenticated);
	}

	private rejectSocket(socket: WebSocket, attachment: ConnectionAttachment, reason: string): void {
		relayWarn("socket_rejected", { roomTag: attachment.roomTag, role: attachment.role, reason });
		socket.close(4002, "Invalid remote protocol frame");
	}

	private async refreshExpiry(): Promise<void> {
		const expiresAt = Date.now() + ROOM_IDLE_TTL_MS;
		await this.ctx.storage.put(EXPIRES_AT_KEY, expiresAt);
		await this.ctx.storage.setAlarm(expiresAt);
	}
}

type CompleteAttachment = ConnectionAttachment &
	Required<Pick<ConnectionAttachment, "deviceId" | "connectionId" | "identityKey" | "ephemeralKey">>;

function isComplete(attachment: ConnectionAttachment): attachment is CompleteAttachment {
	return Boolean(attachment.deviceId && attachment.connectionId && attachment.identityKey && attachment.ephemeralKey);
}

function readAttachment(socket: WebSocket): ConnectionAttachment {
	return socket.deserializeAttachment() as ConnectionAttachment;
}

function opposite(role: RelayRole): RelayRole {
	return role === "mobile" ? "desktop" : "mobile";
}

function parseRole(value: string | null): RelayRole | undefined {
	return value === "mobile" || value === "desktop" ? value : undefined;
}

function response(message: string, status: number): Response {
	return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
