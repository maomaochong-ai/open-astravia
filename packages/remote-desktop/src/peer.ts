import type { RemoteDesktopPeerOptions } from "./peer-types.js";
import { NOOP_REMOTE_DESKTOP_LOGGER } from "./peer-types.js";
import { decodeRemoteDesktopSignal, encodeRemoteInputMessage, parseRemoteInputMessage } from "./protocol.js";
import type { RemoteDesktopSignal, RemoteInputCommand, RemoteInputMessage } from "./types.js";
import { REMOTE_DESKTOP_PROTOCOL_VERSION } from "./types.js";

export type RemoteDesktopSignalSender = (signal: RemoteDesktopSignal) => void | Promise<void>;

export interface RemoteDesktopHostStartOptions {
	/** Wait for the relay to confirm that a viewer is online before creating an offer. */
	readonly waitForPeerReady?: boolean;
}

export class RemoteDesktopHost {
	private readonly peer: RTCPeerConnection;
	private readonly logger;
	private readonly pendingIce: RTCIceCandidateInit[] = [];
	private inputChannel: RTCDataChannel | undefined;
	private lastInputSequence = 0;
	private closed = false;
	private started = false;
	private peerReady = false;
	private hasNegotiated = false;
	private negotiation: Promise<void> | undefined;

	constructor(
		private readonly options: RemoteDesktopPeerOptions,
		private readonly sendSignal: RemoteDesktopSignalSender,
		private readonly onInput: (message: RemoteInputMessage) => void | Promise<void>,
	) {
		this.logger = options.logger ?? NOOP_REMOTE_DESKTOP_LOGGER;
		this.peer = createPeer(options);
		this.peer.onicecandidate = (event) => {
			if (!event.candidate) return;
			void this.sendSignal({
				type: "ice",
				protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
				sessionId: options.sessionId,
				candidate: event.candidate.candidate,
				sdpMid: event.candidate.sdpMid,
				sdpMLineIndex: event.candidate.sdpMLineIndex,
			});
		};
		this.peer.onconnectionstatechange = () => {
			this.logger.info("remote desktop host peer state", {
				sessionId: options.sessionId,
				state: this.peer.connectionState,
			});
		};
	}

	async start(stream: MediaStream, startOptions: RemoteDesktopHostStartOptions = {}): Promise<void> {
		if (this.closed) throw new Error("remote desktop host is closed");
		if (this.started) throw new Error("remote desktop host is already started");
		if (stream.getVideoTracks().length === 0) throw new Error("screen stream must contain a video track");
		for (const track of stream.getTracks()) this.peer.addTrack(track, stream);
		this.inputChannel = this.peer.createDataChannel("vetta-input-v1", { ordered: true });
		this.configureInputChannel(this.inputChannel);
		this.started = true;
		if (startOptions.waitForPeerReady !== true || this.peerReady) await this.negotiate();
	}

	async acceptSignal(signal: RemoteDesktopSignal): Promise<void> {
		const frame = decodeRemoteDesktopSignal(signal);
		if (frame.type === "peer_ready") {
			this.peerReady = true;
			if (this.started) await this.negotiate();
			return;
		}
		if (frame.sessionId !== this.options.sessionId) throw new Error("remote desktop signal session mismatch");
		if (frame.type === "answer") {
			await this.peer.setRemoteDescription({ type: "answer", sdp: frame.sdp });
			await this.flushPendingIce();
			return;
		}
		if (frame.type === "ice") {
			await this.addIce({ candidate: frame.candidate, sdpMid: frame.sdpMid, sdpMLineIndex: frame.sdpMLineIndex });
			return;
		}
		if (frame.type === "end") this.close(frame.reason);
	}

	close(reason: Extract<RemoteDesktopSignal, { type: "end" }>["reason"] = "completed"): void {
		if (this.closed) return;
		this.closed = true;
		this.inputChannel?.close();
		for (const sender of this.peer.getSenders()) sender.track?.stop();
		this.peer.close();
		void this.sendSignal({
			type: "end",
			protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
			sessionId: this.options.sessionId,
			reason,
		});
	}

	get connectionState(): RTCPeerConnectionState {
		return this.peer.connectionState;
	}

	private configureInputChannel(channel: RTCDataChannel): void {
		channel.onmessage = (event) => {
			if (typeof event.data !== "string") {
				this.logger.warn("remote desktop binary input rejected", { sessionId: this.options.sessionId });
				channel.close();
				return;
			}
			try {
				const message = parseRemoteInputMessage(event.data);
				if (message.sequence <= this.lastInputSequence) {
					this.logger.warn("remote desktop replayed input ignored", {
						sessionId: this.options.sessionId,
						sequence: message.sequence,
					});
					return;
				}
				this.lastInputSequence = message.sequence;
				void this.onInput(message);
			} catch {
				this.logger.warn("remote desktop invalid input rejected", { sessionId: this.options.sessionId });
				channel.close();
			}
		};
	}

	private async addIce(candidate: RTCIceCandidateInit): Promise<void> {
		if (!this.peer.remoteDescription) {
			this.pendingIce.push(candidate);
			return;
		}
		await this.peer.addIceCandidate(candidate);
	}

	private async flushPendingIce(): Promise<void> {
		for (const candidate of this.pendingIce.splice(0)) await this.peer.addIceCandidate(candidate);
	}

	private async negotiate(): Promise<void> {
		if (this.negotiation) return this.negotiation;
		if (this.peer.signalingState !== "stable") {
			this.logger.debug("remote desktop host negotiation already pending", {
				sessionId: this.options.sessionId,
				state: this.peer.signalingState,
			});
			return;
		}
		const negotiation = (async () => {
			const offer = await this.peer.createOffer(this.hasNegotiated ? { iceRestart: true } : undefined);
			await this.peer.setLocalDescription(offer);
			if (!offer.sdp) throw new Error("WebRTC offer did not include SDP");
			await this.sendSignal({
				type: "offer",
				protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
				sessionId: this.options.sessionId,
				sdp: offer.sdp,
			});
			this.hasNegotiated = true;
		})();
		this.negotiation = negotiation;
		try {
			await negotiation;
		} finally {
			if (this.negotiation === negotiation) this.negotiation = undefined;
		}
	}
}

export class RemoteDesktopViewer {
	private readonly peer: RTCPeerConnection;
	private readonly logger;
	private readonly pendingIce: RTCIceCandidateInit[] = [];
	private inputChannel: RTCDataChannel | undefined;
	private closed = false;
	private nextSequence = 1;
	private inputReadyResolve: (() => void) | undefined;
	private readonly inputReady = new Promise<void>((resolve) => {
		this.inputReadyResolve = resolve;
	});

	constructor(
		private readonly options: RemoteDesktopPeerOptions,
		private readonly sendSignal: RemoteDesktopSignalSender,
		private readonly onStream: (stream: MediaStream) => void,
	) {
		this.logger = options.logger ?? NOOP_REMOTE_DESKTOP_LOGGER;
		this.peer = createPeer(options);
		this.peer.onicecandidate = (event) => {
			if (!event.candidate) return;
			void this.sendSignal({
				type: "ice",
				protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
				sessionId: options.sessionId,
				candidate: event.candidate.candidate,
				sdpMid: event.candidate.sdpMid,
				sdpMLineIndex: event.candidate.sdpMLineIndex,
			});
		};
		this.peer.ontrack = (event) => {
			const stream = event.streams[0] ?? new MediaStream([event.track]);
			this.onStream(stream);
		};
		this.peer.ondatachannel = (event) => {
			if (event.channel.label !== "vetta-input-v1" || this.inputChannel) {
				event.channel.close();
				return;
			}
			this.inputChannel = event.channel;
			event.channel.onopen = () => this.inputReadyResolve?.();
		};
		this.peer.onconnectionstatechange = () => {
			this.logger.info("remote desktop viewer peer state", {
				sessionId: options.sessionId,
				state: this.peer.connectionState,
			});
		};
	}

	async acceptSignal(signal: RemoteDesktopSignal): Promise<void> {
		const frame = decodeRemoteDesktopSignal(signal);
		if (frame.type === "peer_ready") return;
		if (frame.sessionId !== this.options.sessionId) throw new Error("remote desktop signal session mismatch");
		if (frame.type === "offer") {
			await this.peer.setRemoteDescription({ type: "offer", sdp: frame.sdp });
			await this.flushPendingIce();
			const answer = await this.peer.createAnswer();
			await this.peer.setLocalDescription(answer);
			if (!answer.sdp) throw new Error("WebRTC answer did not include SDP");
			await this.sendSignal({
				type: "answer",
				protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
				sessionId: this.options.sessionId,
				sdp: answer.sdp,
			});
			return;
		}
		if (frame.type === "ice") {
			await this.addIce({ candidate: frame.candidate, sdpMid: frame.sdpMid, sdpMLineIndex: frame.sdpMLineIndex });
			return;
		}
		if (frame.type === "end") this.close(frame.reason);
	}

	async sendInput(message: RemoteInputCommand): Promise<void> {
		await this.inputReady;
		if (!this.inputChannel || this.inputChannel.readyState !== "open") {
			throw new Error("remote input channel is not open");
		}
		this.inputChannel.send(
			encodeRemoteInputMessage({ ...message, sequence: this.nextSequence++ } as RemoteInputMessage),
		);
	}

	close(reason: Extract<RemoteDesktopSignal, { type: "end" }>["reason"] = "completed"): void {
		if (this.closed) return;
		this.closed = true;
		this.inputChannel?.close();
		this.peer.close();
		void this.sendSignal({
			type: "end",
			protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
			sessionId: this.options.sessionId,
			reason,
		});
	}

	get connectionState(): RTCPeerConnectionState {
		return this.peer.connectionState;
	}

	private async addIce(candidate: RTCIceCandidateInit): Promise<void> {
		if (!this.peer.remoteDescription) {
			this.pendingIce.push(candidate);
			return;
		}
		await this.peer.addIceCandidate(candidate);
	}

	private async flushPendingIce(): Promise<void> {
		for (const candidate of this.pendingIce.splice(0)) await this.peer.addIceCandidate(candidate);
	}
}

function createPeer(options: RemoteDesktopPeerOptions): RTCPeerConnection {
	return options.createPeerConnection?.(options.rtcConfiguration) ?? new RTCPeerConnection(options.rtcConfiguration);
}
