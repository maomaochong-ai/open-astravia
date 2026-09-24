import Foundation

/// Outbound event log for one peer (port of `event-journal.ts`). Outlives a
/// single transport so a peer that switches channel only receives what it
/// missed; bounded by count and age, beyond which the peer must resync.
public final class RemoteEventJournal {
	private struct Entry {
		let event: RemoteEvent
		let recordedAt: Double
	}

	private var entries: [Entry] = []
	private var sequence = 0
	private var oldestKeptSequence = 0
	private let capacity: Int
	private let maxAgeMs: Double
	private let now: () -> Double

	public init(capacity: Int = 512, maxAgeMs: Double = 5 * 60_000, now: @escaping () -> Double = WallClock.nowMs) {
		self.capacity = max(1, capacity)
		self.maxAgeMs = max(0, maxAgeMs)
		self.now = now
	}

	public var lastSequence: Int { sequence }

	public func nextSequence() -> Int {
		sequence += 1
		return sequence
	}

	public func remember(_ event: RemoteEvent) {
		entries.append(Entry(event: event, recordedAt: now()))
		evict()
	}

	public func acknowledge(_ sequence: Int) {
		while let first = entries.first, first.event.sequence <= sequence { entries.removeFirst() }
		oldestKeptSequence = max(oldestKeptSequence, sequence)
	}

	/// Events newer than `afterSequence`, or nil when they have already been evicted.
	public func replay(after afterSequence: Int) -> [RemoteEvent]? {
		evict()
		// Ahead of anything recorded here: this journal was recreated (the app
		// restarted), and the peer would drop every new event as already seen.
		if afterSequence > sequence { return nil }
		if afterSequence == sequence { return [] }
		if afterSequence < oldestKeptSequence { return nil }
		return entries.filter { $0.event.sequence > afterSequence }.map(\.event)
	}

	private func evict() {
		let cutoff = now() - maxAgeMs
		while let first = entries.first, entries.count > capacity || first.recordedAt < cutoff {
			entries.removeFirst()
			oldestKeptSequence = max(oldestKeptSequence, first.event.sequence)
		}
	}
}

public enum WallClock {
	/// Milliseconds since 1970, like `Date.now()`.
	nonisolated public static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }
}
