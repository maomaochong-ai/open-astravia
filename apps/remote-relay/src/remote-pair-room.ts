import { DurableObject } from "cloudflare:workers";
import { encodeRemoteFrame, parseRemoteFrame, type RemoteFrame, type RemoteHello } from "@vetta/remote-control";
import type { RelayRole } from "./auth.js";
import { REMOTE_WEBSOCKET_PROTOCOL } from "./auth.js";
import { relayInfo, relayWarn } from "./relay-log.js";
import { RoomAuthorization } from "./room-authorization.js";

interface Env {
	readonly REMOTE_PAIR_ROOM: DurableObjectNamespace<RemotePairRoom>;
}

interface ConnectionAttachment {
	readonly role: RelayRole;
	readonly roomTag: string;
	readonly authenticated: boolean;
	readonly superseded?: boolean;
	readonly deviceId?: string;
	readonly connectionId?: string;
	readonly credentialMode?: "desktop" | "bootstrap" | "resume" | "legacy";
	readonly resumeHash?: string;
}

const EXPIRES_AT_KEY = "expiresAt";
const ROOM_IDLE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_MESSAGE_CHARS = 1_048_576;

export class RemotePairRoom extends DurableObject<Env> {
	private readonly authorization = new RoomAuthorization(this.ctx);

	async fetch(request: Request): Promise<Response> {
		if (request.method === "POST" && new URL(request.url).pathname.endsWith("/authorize")) {
			const role = parseRole(request.headers.get("X-Vetta-Relay-Role"));
			const credentialHash = request.headers.get("X-Vetta-Credential-Hash");
			if (role !== "mobile" || !credentialHash) return response("Unauthorized", 401);
			const mode = await this.authorization.authorizeMobile(credentialHash);
			return mode ? new Response(null, { status: 204 }) : response("Unauthorized", 401);
		}
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return response("WebSocket upgrade required", 426);
		}
		const role = parseRole(request.headers.get("X-Vetta-Relay-Role"));
		const credentialHash = request.headers.get("X-Vetta-Credential-Hash");
		const roomTag = request.headers.get("X-Vetta-Room-Tag");
		if (!role || !credentialHash || !roomTag) return response("Invalid relay request", 400);
		const resumeHash = request.headers.get("X-Vetta-Resume-Hash") ?? undefined;
		const bootstrapHash = request.headers.get("X-Vetta-Bootstrap-Hash") ?? undefined;
		const authorization =
			role === "desktop"
				? (await this.authorization.authorizeDesktop(credentialHash, bootstrapHash))
					? "desktop"
					: false
				: await this.authorization.authorizeMobile(credentialHash);
		if (!authorization) {
			relayWarn("connection_rejected", {
				roomTag,
				role,
				reason: role === "mobile" ? "not_initialized_or_invalid" : "invalid",
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
		server.serializeAttachment({
			role,
			roomTag,
			authenticated: false,
			...(role === "mobile" ? { credentialMode: authorization, resumeHash } : {}),
		} satisfies ConnectionAttachment);
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
			// `hello` and the first request may arrive in one newline-delimited
			// WebSocket message. Re-read the attachment after each frame so the
			// synchronous hello transition is visible to the next frame.
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
			if (frame.type === "hello" || frame.type === "hello_ack") {
				this.rejectSocket(socket, attachment, "unexpected_handshake_frame");
				return;
			}
			this.forwardFrame(attachment, frame);
		}
	}

	async webSocketClose(socket: WebSocket): Promise<void> {
		const attachment = readAttachment(socket);
		if (!attachment.superseded) {
			for (const peer of this.authenticatedSockets(opposite(attachment.role))) {
				peer.close(1012, "Peer disconnected");
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
		if (attachment.role === "mobile" && attachment.credentialMode === "bootstrap") {
			void this.authorization.consumeBootstrap(attachment.resumeHash).then((consumed) => {
				if (!consumed) {
					this.rejectSocket(socket, attachment, "bootstrap_already_consumed");
					return;
				}
				this.finishHello(socket, attachment, hello);
			});
			return;
		}
		this.finishHello(socket, attachment, hello);
	}

	private finishHello(socket: WebSocket, attachment: ConnectionAttachment, hello: RemoteHello): void {
		socket.serializeAttachment({
			...attachment,
			authenticated: true,
			deviceId: hello.deviceId,
			connectionId: hello.connectionId,
		} satisfies ConnectionAttachment);
		relayInfo("handshake_accepted", { roomTag: attachment.roomTag, role: attachment.role });
		this.acknowledgePair();
	}

	private acknowledgePair(): void {
		const mobile = this.authenticatedSockets("mobile")[0];
		const desktop = this.authenticatedSockets("desktop")[0];
		if (!mobile || !desktop) return;
		const mobileAttachment = readAttachment(mobile);
		const desktopAttachment = readAttachment(desktop);
		if (
			!mobileAttachment.connectionId ||
			!mobileAttachment.deviceId ||
			!desktopAttachment.connectionId ||
			!desktopAttachment.deviceId
		) {
			return;
		}
		mobile.send(
			encodeRemoteFrame({
				type: "hello_ack",
				protocolVersion: 1,
				connectionId: mobileAttachment.connectionId,
				peerDeviceId: desktopAttachment.deviceId,
			}),
		);
		desktop.send(
			encodeRemoteFrame({
				type: "hello_ack",
				protocolVersion: 1,
				connectionId: desktopAttachment.connectionId,
				peerDeviceId: mobileAttachment.deviceId,
			}),
		);
		relayInfo("pair_online", { roomTag: mobileAttachment.roomTag });
	}

	private forwardFrame(attachment: ConnectionAttachment, frame: RemoteFrame): void {
		const peer = this.authenticatedSockets(opposite(attachment.role))[0];
		if (!peer) {
			if (frame.type === "request") {
				const own = this.authenticatedSockets(attachment.role)[0];
				own?.send(
					encodeRemoteFrame({
						type: "response",
						requestId: frame.requestId,
						success: false,
						error: { code: "transport_closed", message: "Remote peer is offline", retryable: true },
					}),
				);
			}
			return;
		}
		peer.send(encodeRemoteFrame(frame));
		relayInfo("frame_forwarded", {
			roomTag: attachment.roomTag,
			role: attachment.role,
			frameType: frame.type,
			method: frame.type === "request" ? frame.method : undefined,
			eventName: frame.type === "event" ? frame.name : undefined,
		});
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
