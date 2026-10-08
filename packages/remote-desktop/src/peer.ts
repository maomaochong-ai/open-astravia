import type { RemoteDesktopPeerOptions } from "./peer-types.js";
import { NOOP_REMOTE_DESKTOP_LOGGER } from "./peer-types.js";
import {
	decodeRemoteDesktopSignal,
	encodeRemoteInputMessage,
	parseRemoteInputMessage,
	parseRemoteViewMessage,
} from "./protocol.js";
import type { ScreenSize } from "./screen-scale.js";
import { isSoftwareEncoder, screenScaleDown } from "./screen-scale.js";
import type { RemoteDesktopSignal, RemoteInputCommand, RemoteInputMessage } from "./types.js";
import { REMOTE_DESKTOP_PROTOCOL_VERSION } from "./types.js";

export type RemoteDesktopSignalSender = (signal: RemoteDesktopSignal) => void | Promise<void>;

export interface RemoteDesktopHostStartOptions {
	/** Wait for the relay to confirm that a viewer is online before creating an offer. */
	readonly waitForPeerReady?: boolean;
	/**
	 * A viewer came online after this host already offered to one. Each viewer is a new
	 * peer connection, which this one cannot reach again (its DTLS is spent, or its offer
	 * went to a viewer that is gone), so the host should start over. Without it the host
	 * offers again with an ICE restart.
	 *
	 * While the peer connection is up, a `peer_ready` is taken as the same viewer
	 * rejoining signaling (after a relay restart, say) and the connection is kept; only
	 * if the connection then fails, or stays disconnected for a few seconds, is the viewer
	 * treated as replaced.
	 */
	readonly onViewerReplaced?: () => void;
	/** Every change of the peer connection's state, e.g. to decide what a signaling drop means. */
	readonly onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

/**
 * A reliable ordered text channel that applications may use alongside screen
 * media. This package deliberately treats its payload as opaque text so the
 * remote-control protocol keeps ownership of validation and encryption.
 */
export interface RemoteDesktopTextChannelHandlers {
	onOpen?(): void;
	onMessage(message: string): void;
	onClose?(reason?: string): void;
}

export const REMOTE_DESKTOP_CONTROL_CHANNEL = "vetta-control-v2";
/**
 * The phone says how large it shows the screen (`RemoteViewMessage`). The desktop opens it,
 * so a phone only sends where a desktop listens; older phones close it.
 */
export const REMOTE_DESKTOP_VIEW_CHANNEL = "vetta-view-v1";
const MAX_CONTROL_MESSAGE_CHARS = 1_500_000;
/** How long a rejoined viewer may stay disconnected before it counts as replaced; the phone gives up after as long. */
const VIEWER_DISCONNECT_GRACE_MS = 5_000;

export class RemoteDesktopHost {
	private readonly peer: RTCPeerConnection;
	private readonly logger;
	private readonly pendingIce: RTCIceCandidateInit[] = [];
	private inputChannel: RTCDataChannel | undefined;
	private controlChannel: RTCDataChannel | undefined;
	private controlClosed = false;
	/** Set when started without a stream: the screen comes and goes through `replaceScreen`. */
	private screenSender: RTCRtpSender | undefined;
	private lastInputSequence = 0;
	private closed = false;
	private started = false;
	private peerReady = false;
	private hasNegotiated = false;
	private negotiation: Promise<void> | undefined;
	private offered = false;
	private onViewerReplaced: (() => void) | undefined;
	private onConnectionStateChange: ((state: RTCPeerConnectionState) => void) | undefined;
	/** A viewer came online while connected: it rejoined, unless the connection drops after all. */
	private viewerRejoined = false;
	private rejoinGrace: ReturnType<typeof setTimeout> | undefined;
	/** Chromium fell back from the hardware encoder; the picture is sent smaller meanwhile. */
	private softwareEncoder = false;
	private viewChannel: RTCDataChannel | undefined;
	/** How large the phone last said it shows the screen; unknown until it says. */
	private shown: ScreenSize | undefined;

	constructor(
		private readonly options: RemoteDesktopPeerOptions,
		private readonly sendSignal: RemoteDesktopSignalSender,
		private readonly onInput: (message: RemoteInputMessage) => void | Promise<void>,
		private readonly control?: RemoteDesktopTextChannelHandlers,
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
			const state = this.peer.connectionState;
			this.logger.info("remote desktop host peer state", { sessionId: options.sessionId, state });
			// ICE failure can leave SCTP reporting "open". Retire the control route
			// without waiting for a DataChannel close event that may never arrive.
			if (state === "failed" || state === "closed") this.closeControl(`peer ${state}`);
			this.onConnectionStateChange?.(state);
			if (!this.viewerRejoined || !this.onViewerReplaced || this.closed) return;
			if (state === "connected") {
				this.clearRejoinGrace();
				return;
			}
			// A brief network blip that ICE recovers from is still the same viewer.
			if (state === "disconnected") {
				this.rejoinGrace ??= setTimeout(() => this.viewerGone(state), VIEWER_DISCONNECT_GRACE_MS);
				return;
			}
			this.viewerGone(state);
		};
	}

	/**
	 * With a stream, the screen is shared for the whole session. Without one, the
	 * session opens with an empty video slot so the data channels work while nobody
	 * watches, and `replaceScreen` fills it on demand without renegotiating (ADR-0140).
	 */
	async start(stream?: MediaStream, startOptions: RemoteDesktopHostStartOptions = {}): Promise<void> {
		if (this.closed) throw new Error("remote desktop host is closed");
		if (this.started) throw new Error("remote desktop host is already started");
		if (stream) {
			if (stream.getVideoTracks().length === 0) throw new Error("screen stream must contain a video track");
			for (const track of stream.getTracks()) {
				if (track.kind === "video") track.contentHint = "detail";
				this.peer.addTrack(track, stream);
			}
			for (const transceiver of this.peer.getTransceivers?.() ?? []) preferHardwareCodec(transceiver);
		} else {
			const transceiver = this.peer.addTransceiver("video", { direction: "sendonly" });
			preferHardwareCodec(transceiver);
			this.screenSender = transceiver.sender;
		}
		this.inputChannel = this.peer.createDataChannel("vetta-input-v1", { ordered: true });
		this.configureInputChannel(this.inputChannel);
		if (this.control) {
			this.controlChannel = this.peer.createDataChannel(REMOTE_DESKTOP_CONTROL_CHANNEL, { ordered: true });
			this.configureControlChannel(this.controlChannel);
		}
		this.viewChannel = this.peer.createDataChannel(REMOTE_DESKTOP_VIEW_CHANNEL, { ordered: true });
		this.configureViewChannel(this.viewChannel);
		this.started = true;
		this.onViewerReplaced = startOptions.onViewerReplaced;
		this.onConnectionStateChange = startOptions.onConnectionStateChange;
		if (startOptions.waitForPeerReady !== true || this.peerReady) await this.negotiate();
	}

	async acceptSignal(signal: RemoteDesktopSignal): Promise<void> {
		const frame = decodeRemoteDesktopSignal(signal);
		if (frame.type === "peer_ready") {
			this.peerReady = true;
			if (this.offered && this.peer.connectionState === "connected") {
				// The direct connection never went through the relay, so it outlives signaling.
				this.viewerRejoined = true;
				this.logger.info("remote desktop viewer rejoined signaling", { sessionId: this.options.sessionId });
				return;
			}
			if (this.offered && this.onViewerReplaced) {
				this.logger.info("remote desktop viewer replaced", { sessionId: this.options.sessionId });
				this.onViewerReplaced();
				return;
			}
			if (this.started) await this.negotiate();
			return;
		}
		if (frame.sessionId !== this.options.sessionId) throw new Error("remote desktop signal session mismatch");
		if (frame.type === "answer") {
			await this.peer.setRemoteDescription({
				type: "answer",
				sdp: answerWithStartBitrate(answerForHardwareEncoding(frame.sdp)),
			});
			await this.flushPendingIce();
			this.logger.info("remote desktop answer applied", { sessionId: this.options.sessionId });
			// Encodings exist only once negotiated: a screen shared for the whole session is tuned here.
			for (const sender of this.peer.getSenders?.() ?? []) {
				if (sender.track?.kind === "video") await tuneScreenSender(sender, this.scaleFor(sender.track));
			}
			return;
		}
		if (frame.type === "ice") {
			await this.addIce({ candidate: frame.candidate, sdpMid: frame.sdpMid, sdpMLineIndex: frame.sdpMLineIndex });
			return;
		}
		if (frame.type === "end") this.close(frame.reason);
	}

	/** The rejoined viewer's connection is gone for good: it was a new viewer after all. */
	private viewerGone(state: RTCPeerConnectionState): void {
		this.clearRejoinGrace();
		if (!this.viewerRejoined || !this.onViewerReplaced || this.closed) return;
		this.viewerRejoined = false;
		this.logger.info("remote desktop viewer replaced", { sessionId: this.options.sessionId, state });
		this.onViewerReplaced();
	}

	private clearRejoinGrace(): void {
		if (this.rejoinGrace) clearTimeout(this.rejoinGrace);
		this.rejoinGrace = undefined;
	}

	close(reason: Extract<RemoteDesktopSignal, { type: "end" }>["reason"] = "completed"): void {
		if (this.closed) return;
		this.closed = true;
		this.clearRejoinGrace();
		this.inputChannel?.close();
		this.controlChannel?.close();
		this.viewChannel?.close();
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

	/** The connection's statistics, for diagnostics: counts, codec names and timing only. */
	getStats(): Promise<RTCStatsReport> {
		return this.peer.getStats();
	}

	/** Puts a new screen track in the video slot, or empties it with null; the previous track is stopped. */
	async replaceScreen(track: MediaStreamTrack | null): Promise<void> {
		if (this.closed) {
			track?.stop();
			return;
		}
		if (!this.screenSender) throw new Error("remote desktop host shares a fixed screen stream");
		const previous = this.screenSender.track;
		if (track) track.contentHint = "detail";
		await this.screenSender.replaceTrack(track);
		if (previous && previous !== track) previous.stop();
		if (track) await tuneScreenSender(this.screenSender, this.scaleFor(track));
	}

	/**
	 * Which encoder the screen goes through, from the stats. Chromium can drop from the
	 * hardware encoder to its software one partway through a session; the picture is then
	 * sent smaller until the hardware one is back. WebRTC sets the encoder up again when
	 * the size changes, trying the hardware one first, so that can also bring it back.
	 */
	async noteEncoder(implementation: string): Promise<void> {
		const software = isSoftwareEncoder(implementation);
		if (this.closed || software === this.softwareEncoder) return;
		this.softwareEncoder = software;
		this.logger.info("remote desktop encoder changed", {
			sessionId: this.options.sessionId,
			encoder: implementation,
			software,
		});
		await this.rescaleScreen();
	}

	private async rescaleScreen(): Promise<void> {
		const sender = this.screenSender ?? this.peer.getSenders().find((entry) => entry.track?.kind === "video");
		if (sender?.track) await tuneScreenSender(sender, this.scaleFor(sender.track));
	}

	private scaleFor(track: MediaStreamTrack): number {
		const settings = typeof track.getSettings === "function" ? track.getSettings() : undefined;
		const capture =
			settings?.width && settings.height ? { width: settings.width, height: settings.height } : undefined;
		return screenScaleDown(capture, this.softwareEncoder, this.shown);
	}

	private configureViewChannel(channel: RTCDataChannel): void {
		channel.onmessage = (event) => {
			if (this.closed) return;
			try {
				if (typeof event.data !== "string") throw new Error("binary view message");
				this.shown = parseRemoteViewMessage(event.data);
			} catch {
				this.logger.warn("remote desktop invalid view rejected", { sessionId: this.options.sessionId });
				return;
			}
			void this.rescaleScreen();
		};
	}

	sendControl(message: string): void {
		if (this.closed || this.controlClosed || !this.controlChannel || this.controlChannel.readyState !== "open") {
			throw new Error("remote control channel is not open");
		}
		this.controlChannel.send(message);
	}

	private configureControlChannel(channel: RTCDataChannel): void {
		channel.onopen = () => {
			if (!this.controlClosed) this.control?.onOpen?.();
		};
		channel.onclose = () => this.closeControl("data channel closed");
		channel.onerror = () => this.closeControl("data channel failed");
		channel.onmessage = (event) => {
			if (this.controlClosed) return;
			if (typeof event.data !== "string" || event.data.length > MAX_CONTROL_MESSAGE_CHARS) {
				this.logger.warn("remote desktop invalid control payload rejected", { sessionId: this.options.sessionId });
				channel.close();
				return;
			}
			this.control?.onMessage(event.data);
		};
	}

	private closeControl(reason: string): void {
		if (this.controlClosed) return;
		this.controlClosed = true;
		this.control?.onClose?.(reason);
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
		this.offered = true;
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
			this.logger.info("remote desktop offer sent", {
				sessionId: this.options.sessionId,
				restart: this.hasNegotiated,
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

/**
 * H.264 first: desktops and phones encode and decode it in hardware, where VP8, the
 * default, is encoded in software and falls behind on a large screen, dropping frames
 * while the picture moves. Other codecs stay as fallbacks.
 */
function preferHardwareCodec(transceiver: RTCRtpTransceiver): void {
	if (typeof transceiver.setCodecPreferences !== "function" || typeof RTCRtpReceiver === "undefined") return;
	// Chromium checks preferences against what it can receive, even for a send-only slot.
	const codecs = RTCRtpReceiver.getCapabilities?.("video")?.codecs;
	if (!codecs?.length) return;
	const h264 = codecs.filter((codec) => codec.mimeType.toLowerCase() === "video/h264");
	if (h264.length === 0) return;
	try {
		transceiver.setCodecPreferences([...h264, ...codecs.filter((codec) => !h264.includes(codec))]);
	} catch {
		// Left to the browser's default order.
	}
}

/**
 * Phones accept H.264 only as constrained baseline (42e0..), which Chromium on macOS
 * encodes in software (OpenH264): a large screen then manages a dozen frames a second
 * and the picture falls behind. As baseline (4200..) it goes to the hardware encoder.
 * The encoder uses no tool constrained baseline forbids, so the phone decodes it as before.
 */
function answerForHardwareEncoding(sdp: string): string {
	return sdp.replace(/(profile-level-id=)42e0([0-9a-f]{2})/gi, "$14200$2");
}

/**
 * Where the bandwidth estimate starts. WebRTC starts at 300 kbps and climbs over seconds,
 * while one frame of a large screen is hundreds of KB, so on every new connection the
 * first frames queued for one to two seconds. The estimate still backs off on a slower link.
 */
const SCREEN_START_BITRATE_KBPS = 4_000;

/** Sets the start on each video codec of the answer: the sending side reads it from there. */
function answerWithStartBitrate(sdp: string): string {
	const video = new Set<string>();
	for (const match of sdp.matchAll(/^a=rtpmap:(\d+) (?:H264|H265|VP8|VP9|AV1)\//gim)) video.add(match[1] ?? "");
	return sdp.replace(/^a=fmtp:(\d+) [^\r\n]*/gm, (line, payload: string) =>
		video.has(payload) && !line.includes("x-google-start-bitrate")
			? `${line};x-google-start-bitrate=${SCREEN_START_BITRATE_KBPS}`
			: line,
	);
}

/** The most the screen may spend: sharp text at a large capture, still well within a LAN. */
const SCREEN_MAX_BITRATE = 12_000_000;

/**
 * A phone zooms in to read the screen and drags things across it, so text should stay
 * sharp and motion smooth. "balanced" trades a little of each under load instead of
 * dropping frames to hold full resolution, which made dragging stutter (ADR-0140).
 * `scale` sends the picture smaller than captured. Best effort; a browser without these
 * parameters keeps its defaults.
 */
async function tuneScreenSender(sender: RTCRtpSender, scale: number): Promise<void> {
	if (typeof sender.getParameters !== "function") return;
	try {
		const parameters = sender.getParameters();
		parameters.degradationPreference = "balanced";
		for (const encoding of parameters.encodings ?? []) {
			encoding.maxBitrate = SCREEN_MAX_BITRATE;
			encoding.scaleResolutionDownBy = scale;
		}
		await sender.setParameters(parameters);
	} catch {
		// Unsupported here: the defaults still work.
	}
}

function createPeer(options: RemoteDesktopPeerOptions): RTCPeerConnection {
	return options.createPeerConnection?.(options.rtcConfiguration) ?? new RTCPeerConnection(options.rtcConfiguration);
}
