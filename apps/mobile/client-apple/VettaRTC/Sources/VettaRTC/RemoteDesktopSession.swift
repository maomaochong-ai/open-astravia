import Foundation
import Observation
import os
import VettaKit
@preconcurrency import WebRTC

private let log = Logger(subsystem: "com.openvetta.mobile", category: "remote-desktop")

/// One WebRTC session with the paired desktop, set up through the relay's viewer
/// signaling: the desktop offers, this phone answers. It carries the P2P control
/// channel `ChannelManager` talks over, and the screen with its input channel for the
/// remote desktop page (port of Android's `NativeRemoteDesktopSession`).
///
/// The screen's video slot exists from the start but stays empty until the page
/// subscribes (`screen.subscribe`, ADR-0140), so a session that only carries the
/// control channel costs neither side a capture.
///
/// Once connected directly, the session no longer needs the relay: if signaling drops
/// (the relay restarts, say) it reopens in the background and the link stays up.
///
/// WebRTC calls its delegates on its own threads; everything here hops to the main
/// actor first, since default main-actor isolation traps on any other thread.
@Observable
public final class RemoteDesktopSession {
	public enum Phase: Equatable, Sendable {
		case idle, connecting, connected, stopped
	}

	public let target: String
	public private(set) var phase: Phase = .idle
	/// The desktop's screen track, present from the offer on; frames arrive only while subscribed.
	public private(set) var videoTrack: RTCVideoTrack?
	/// How the picture travels right now, refreshed every second while connected.
	public private(set) var stats: RemoteStreamStats?
	/// The last steps of setting up the connection, newest last, for a page stuck connecting.
	/// Technical names only: never SDP, candidates or the pairing secret.
	public private(set) var trace: [String] = []

	@ObservationIgnored private let sessionId: String
	@ObservationIgnored private var peer: RTCPeerConnection?
	@ObservationIgnored private var delegate: PeerDelegate?
	@ObservationIgnored private var socket: URLSessionWebSocketTask?
	@ObservationIgnored private var urlSession: URLSession?
	@ObservationIgnored private var inputChannel: RTCDataChannel?
	@ObservationIgnored private var controlChannel: RTCDataChannel?
	@ObservationIgnored private var controlTransport: P2PControlTransport?
	@ObservationIgnored private var pendingCandidates: [RTCIceCandidate] = []
	@ObservationIgnored private var remoteDescriptionSet = false
	@ObservationIgnored private var nextSequence = 1
	@ObservationIgnored private var statsTask: Task<Void, Never>?
	@ObservationIgnored private var signalingRetry = SignalingRetry()
	@ObservationIgnored private var reconnectTask: Task<Void, Never>?
	/// The running totals at the last sample, to average over the last second only.
	@ObservationIgnored private var lastTotals: FrameTotals?

	private static let factory: RTCPeerConnectionFactory = {
		RTCInitializeSSL()
		return RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(), decoderFactory: RTCDefaultVideoDecoderFactory())
	}()

	init(target: String) {
		self.target = target
		sessionId = Self.sessionId(in: target)
	}

	public var isStopped: Bool { phase == .stopped }

	/// Whether taps and keys can go out now.
	public var canSendInput: Bool { inputChannel?.readyState == .open }

	func start() {
		guard phase == .idle else { return }
		phase = .connecting
		note("signaling connecting")
		let (url, token) = RemoteDesktopProtocol.splitTarget(target)
		guard let socketUrl = URL(string: url), !sessionId.isEmpty else {
			stop(reason: "remote desktop target is invalid")
			return
		}
		let delegate = PeerDelegate(owner: self)
		self.delegate = delegate
		let configuration = RTCConfiguration()
		configuration.iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
		configuration.sdpSemantics = .unifiedPlan
		configuration.continualGatheringPolicy = .gatherContinually
		let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
		guard let peer = Self.factory.peerConnection(with: configuration, constraints: constraints, delegate: delegate) else {
			stop(reason: "WebRTC peer connection could not be created")
			return
		}
		self.peer = peer
		urlSession = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: .main)
		openSignaling(socketUrl, token: token)
	}

	private func openSignaling(_ url: URL, token: String?) {
		guard let urlSession else { return }
		let socket = urlSession.webSocketTask(with: url, protocols: RemoteDesktopProtocol.subprotocols(token: token))
		socket.maximumMessageSize = 1024 * 1024
		self.socket = socket
		socket.resume()
		receive(on: socket)
		log.info("remote desktop signaling opened")
	}

	/// Ends the session for good, telling the desktop so it releases the screen at once
	/// instead of waiting for ICE to time out. A new session takes over from here.
	public func stop(reason: String = "closed") {
		guard phase != .stopped else { return }
		note("stopped: \(reason)")
		phase = .stopped
		if socket != nil, !sessionId.isEmpty {
			sendSignal(.end(sessionId: sessionId, reason: .peerClosed))
		}
		inputChannel?.close()
		controlChannel?.close()
		peer?.close()
		peer = nil
		videoTrack = nil
		statsTask?.cancel()
		statsTask = nil
		reconnectTask?.cancel()
		reconnectTask = nil
		stats = nil
		socket?.cancel(with: .normalClosure, reason: nil)
		socket = nil
		urlSession?.finishTasksAndInvalidate()
		urlSession = nil
		controlTransport?.channelClosed(reason)
		delegate = nil
		log.info("remote desktop session stopped: \(reason, privacy: .public)")
	}

	// MARK: Control channel

	/// The P2P control channel, claimed once by `ChannelManager`.
	func claimControlTransport() -> P2PControlTransport? {
		guard controlTransport == nil, phase != .stopped else { return nil }
		let transport = P2PControlTransport(session: self)
		controlTransport = transport
		if let controlChannel { transport.bind(controlChannel) }
		return transport
	}

	// MARK: Input

	/// Sends one input message; dropped while the input channel is not open.
	public func send(_ command: RemoteInputCommand) {
		guard let channel = inputChannel, channel.readyState == .open else { return }
		do {
			let text = try RemoteDesktopProtocol.encode(command, sequence: nextSequence)
			nextSequence += 1
			channel.sendData(RTCDataBuffer(data: Data(text.utf8), isBinary: false))
		} catch {
			log.warning("remote desktop input refused: \(String(describing: error), privacy: .public)")
		}
	}

	public func send(_ commands: [RemoteInputCommand]) {
		for command in commands { send(command) }
	}

	// MARK: Signaling

	private func receive(on socket: URLSessionWebSocketTask) {
		socket.receive { [weak self] result in
			Task { @MainActor in
				guard let self, self.phase != .stopped, self.socket === socket else { return }
				switch result {
				case let .success(.string(text)):
					self.handleSignals(text)
					self.receive(on: socket)
				case .success:
					self.stop(reason: "desktop signaling returned a binary frame")
				case let .failure(error):
					self.signalingLost("desktop signaling closed: \(error.localizedDescription)")
				}
			}
		}
	}

	/// Ends a session still setting up; keeps one connected directly and reopens signaling.
	private func signalingLost(_ reason: String) {
		guard phase != .stopped else { return }
		switch signalingRetry.dropped(directlyConnected: phase == .connected) {
		case .stop:
			stop(reason: reason)
		case let .reconnect(after):
			let dropped = socket
			socket = nil
			dropped?.cancel(with: .goingAway, reason: nil)
			note("signaling lost, direct link kept")
			log.info("remote desktop signaling lost, reopening in \(after, privacy: .public)s: \(reason, privacy: .public)")
			reconnectTask?.cancel()
			reconnectTask = Task { [weak self] in
				try? await Task.sleep(for: .seconds(after))
				guard !Task.isCancelled, let self, self.phase == .connected, self.socket == nil else { return }
				let (url, token) = RemoteDesktopProtocol.splitTarget(self.target)
				guard let socketUrl = URL(string: url) else { return }
				self.note("signaling reconnecting")
				self.openSignaling(socketUrl, token: token)
			}
		}
	}

	private func handleSignals(_ text: String) {
		let signals: [RemoteDesktopSignal]
		do {
			signals = try RemoteDesktopProtocol.parseSignals(text)
		} catch {
			stop(reason: "desktop signaling returned an invalid frame")
			return
		}
		for signal in signals {
			switch signal {
			case .peerReady, .answer:
				break
			case let .offer(id, sdp):
				guard id == sessionId else {
					note("offer for another session ignored")
					continue
				}
				note("offer received")
				answer(sdp)
			case let .ice(id, candidate, sdpMid, sdpMLineIndex):
				guard id == sessionId else { continue }
				let ice = RTCIceCandidate(sdp: candidate, sdpMLineIndex: Int32(sdpMLineIndex ?? 0), sdpMid: sdpMid)
				if remoteDescriptionSet { peer?.add(ice) { _ in } } else { pendingCandidates.append(ice) }
			case let .end(id, reason):
				guard id == sessionId else { continue }
				stop(reason: "desktop ended the session (\(reason.rawValue))")
			}
		}
	}

	private func answer(_ sdp: String) {
		guard let peer else { return }
		log.info("remote desktop offer received")
		Task {
			do {
				try await peer.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: sdp))
				guard self.peer === peer else { return }
				remoteDescriptionSet = true
				let early = pendingCandidates
				pendingCandidates.removeAll()
				for candidate in early { try? await peer.add(candidate) }
				let answer = try await peer.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
				try await peer.setLocalDescription(answer)
				guard self.peer === peer else { return }
				sendSignal(.answer(sessionId: sessionId, sdp: answer.sdp))
				note("answer sent")
				log.info("remote desktop answer sent")
			} catch {
				stop(reason: "WebRTC negotiation failed: \(error.localizedDescription)")
			}
		}
	}

	private func sendSignal(_ signal: RemoteDesktopSignal) {
		socket?.send(.string(RemoteDesktopProtocol.encode(signal) + "\n")) { _ in }
	}

	// MARK: Peer events (already on the main actor)

	fileprivate func peerGenerated(_ candidate: RTCIceCandidate) {
		guard phase != .stopped else { return }
		sendSignal(.ice(sessionId: sessionId, candidate: candidate.sdp, sdpMid: candidate.sdpMid, sdpMLineIndex: Int(candidate.sdpMLineIndex)))
	}

	fileprivate func peerChanged(_ state: RTCIceConnectionState) {
		note("ICE \(Self.name(state))")
		switch state {
		case .connected, .completed:
			if phase == .connecting {
				phase = .connected
				sampleStats()
			}
		case .failed, .closed:
			if phase != .stopped { stop(reason: "WebRTC ICE \(state == .failed ? "failed" : "closed")") }
		default:
			break
		}
	}

	fileprivate func peerOpened(_ channel: RTCDataChannel) {
		note("channel \(channel.label) open")
		switch channel.label {
		case RemoteDesktopProtocol.inputChannel:
			inputChannel = channel
		case RemoteDesktopProtocol.controlChannel:
			controlChannel = channel
			controlTransport?.bind(channel)
		default:
			channel.close()
		}
	}

	fileprivate func peerReceived(_ track: RTCMediaStreamTrack) {
		guard let video = track as? RTCVideoTrack else { return }
		videoTrack = video
		log.info("remote desktop video track attached")
	}

	fileprivate func signalingOpened(_ task: URLSessionTask) {
		guard task === socket else { return }
		signalingRetry.reopened()
		note("signaling open")
	}

	fileprivate func signalingClosed(_ task: URLSessionTask, _ reason: String) {
		guard task === socket else { return }
		signalingLost(reason)
	}

	// MARK: Statistics

	private func sampleStats() {
		statsTask?.cancel()
		statsTask = Task { [weak self] in
			while !Task.isCancelled {
				guard let self, let peer = self.peer, self.phase == .connected else { return }
				let report = await peer.statistics()
				self.read(report)
				try? await Task.sleep(for: .seconds(1))
			}
		}
	}

	private func read(_ report: RTCStatisticsReport) {
		let all = report.statistics
		func number(_ entry: RTCStatistics?, _ key: String) -> Double? { (entry?.values[key] as? NSNumber)?.doubleValue }
		func text(_ entry: RTCStatistics?, _ key: String) -> String? { entry?.values[key] as? String }
		var next = RemoteStreamStats()
		let pairs = all.values.filter { $0.type == "candidate-pair" && ($0.values["nominated"] as? NSNumber)?.boolValue == true }
		if let pair = pairs.first(where: { text($0, "state") == "succeeded" }) ?? pairs.first {
			next.roundTripMs = number(pair, "currentRoundTripTime").map { $0 * 1000 }
			next.route = RemoteStreamStats.route(
				local: text(text(pair, "localCandidateId").flatMap { all[$0] }, "candidateType"),
				remote: text(text(pair, "remoteCandidateId").flatMap { all[$0] }, "candidateType")
			)
		}
		if let video = all.values.first(where: { $0.type == "inbound-rtp" && text($0, "kind") == "video" }) {
			next.framesPerSecond = number(video, "framesPerSecond")
			next.frameWidth = number(video, "frameWidth").map { Int($0) }
			next.frameHeight = number(video, "frameHeight").map { Int($0) }
			let totals = FrameTotals(
				jitterDelay: number(video, "jitterBufferDelay") ?? 0,
				jitterFrames: number(video, "jitterBufferEmittedCount") ?? 0,
				decodeTime: number(video, "totalDecodeTime") ?? 0,
				decodedFrames: number(video, "framesDecoded") ?? 0
			)
			if let before = lastTotals {
				let frames = totals.jitterFrames - before.jitterFrames
				if frames > 0 { next.jitterBufferMs = (totals.jitterDelay - before.jitterDelay) / frames * 1000 }
				let decoded = totals.decodedFrames - before.decodedFrames
				if decoded > 0 { next.decodeMs = (totals.decodeTime - before.decodeTime) / decoded * 1000 }
			}
			lastTotals = totals
		}
		stats = next
	}

	private func note(_ step: String) {
		let time = Date().formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).second(.twoDigits))
		trace = Array((trace + ["\(time) \(step)"]).suffix(8))
		log.info("remote desktop step: \(step, privacy: .public)")
	}

	private static func name(_ state: RTCIceConnectionState) -> String {
		switch state {
		case .new: "new"
		case .checking: "checking"
		case .connected: "connected"
		case .completed: "completed"
		case .failed: "failed"
		case .disconnected: "disconnected"
		case .closed: "closed"
		case .count: "count"
		@unknown default: "unknown"
		}
	}

	private static func sessionId(in target: String) -> String {
		guard let range = target.range(of: #"/v2/desktop/([A-Za-z0-9_-]{16,128})/"#, options: .regularExpression) else { return "" }
		return target[range].split(separator: "/").dropFirst(2).first.map(String.init) ?? ""
	}
}

/// WebRTC's and the signaling socket's callbacks, moved onto the main actor.
private final class PeerDelegate: NSObject, RTCPeerConnectionDelegate, URLSessionWebSocketDelegate, @unchecked Sendable {
	/// Read only on the main queue, where every callback hops before touching it.
	nonisolated(unsafe) private weak var owner: RemoteDesktopSession?

	init(owner: RemoteDesktopSession) { self.owner = owner }

	/// In arrival order: a candidate must not overtake the answer it belongs after.
	nonisolated private func onMain(_ body: @escaping @MainActor (RemoteDesktopSession) -> Void) {
		DispatchQueue.main.async {
			MainActor.assumeIsolated {
				guard let owner = self.owner else { return }
				body(owner)
			}
		}
	}

	nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
	nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
	nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
	nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
	nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
	nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}

	nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
		onMain { $0.peerChanged(newState) }
	}

	nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
		onMain { $0.peerGenerated(candidate) }
	}

	nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
		onMain { $0.peerOpened(dataChannel) }
	}

	nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didStartReceivingOn transceiver: RTCRtpTransceiver) {
		guard let track = transceiver.receiver.track else { return }
		onMain { $0.peerReceived(track) }
	}

	nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
		onMain { $0.signalingOpened(webSocketTask) }
	}

	nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
		onMain { $0.signalingClosed(webSocketTask, "desktop signaling closed (\(closeCode.rawValue))") }
	}

	nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
		onMain { $0.signalingClosed(task, error?.localizedDescription ?? "desktop signaling closed") }
	}
}

/// WebRTC's running totals for the received picture.
private struct FrameTotals {
	var jitterDelay: Double
	var jitterFrames: Double
	var decodeTime: Double
	var decodedFrames: Double
}
