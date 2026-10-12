import Foundation

extension RemoteStreamStats {
	/// A copy of the SDK's scalar statistics, without SDK objects or thread ownership.
	public struct Entry: Sendable {
		public let id: String
		public let type: String
		public let values: [String: JSONValue]

		public init(id: String, type: String, values: [String: JSONValue]) {
			self.id = id
			self.type = type
			self.values = values
		}

		func text(_ key: String) -> String? { values[key]?.stringValue }
		func number(_ key: String) -> Double? { values[key]?.numberValue }
	}

	public struct FrameTotals: Sendable {
		let streamId: String
		let jitterDelay: Double
		let jitterFrames: Double
		let decodeTime: Double
		let decodedFrames: Double
	}

	public static func read(_ entries: [Entry], previous: FrameTotals?, interfaces: [RemoteNetworkInterface]) -> (stats: Self, totals: FrameTotals?) {
		let byId = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
		let video = entries.filter { $0.type == "inbound-rtp" && $0.text("kind") == "video" }
			.max { ($0.number("lastPacketReceivedTimestamp") ?? 0) < ($1.number("lastPacketReceivedTimestamp") ?? 0) }
		var next = Self()
		if let pair = selectedPair(entries, byId: byId, video: video) {
			next.roundTripMs = pair.number("currentRoundTripTime").flatMap { $0 >= 0 ? $0 * 1000 : nil }
			next.route = route(local: pair.text("localCandidateId").flatMap { byId[$0] },
				remote: pair.text("remoteCandidateId").flatMap { byId[$0] }, interfaces: interfaces)
		}
		guard let video else { return (next, nil) }
		next.framesPerSecond = video.number("framesPerSecond")
		next.frameWidth = video.number("frameWidth").flatMap(Int.init(exactly:))
		next.frameHeight = video.number("frameHeight").flatMap(Int.init(exactly:))
		let totals = FrameTotals(streamId: video.id,
			jitterDelay: video.number("jitterBufferDelay") ?? 0,
			jitterFrames: video.number("jitterBufferEmittedCount") ?? 0,
			decodeTime: video.number("totalDecodeTime") ?? 0,
			decodedFrames: video.number("framesDecoded") ?? 0)
		if let before = previous, before.streamId == totals.streamId {
			let emitted = totals.jitterFrames - before.jitterFrames
			if emitted > 0, totals.jitterDelay >= before.jitterDelay { next.jitterBufferMs = (totals.jitterDelay - before.jitterDelay) / emitted * 1000 }
			let decoded = totals.decodedFrames - before.decodedFrames
			if decoded > 0, totals.decodeTime >= before.decodeTime { next.decodeMs = (totals.decodeTime - before.decodeTime) / decoded * 1000 }
		}
		return (next, totals)
	}

	private static func selectedPair(_ entries: [Entry], byId: [String: Entry], video: Entry?) -> Entry? {
		let transport: Entry?
		if let id = video?.text("transportId") {
			transport = byId[id]
		} else {
			let active = entries.filter { $0.type == "transport" && $0.text("selectedCandidatePairId") != nil }
			transport = active.count == 1 ? active[0] : nil
		}
		guard let transport, transport.type == "transport",
			transport.text("iceState").map({ ["connected", "completed"].contains($0) }) ?? true,
			let id = transport.text("selectedCandidatePairId"), let pair = byId[id],
			pair.type == "candidate-pair", pair.text("state") == "succeeded" else { return nil }
		// Nominated/succeeded pairs can survive a route switch. Never use the first
		// one: only the transport's selected pair describes the current media path.
		return pair
	}
}
