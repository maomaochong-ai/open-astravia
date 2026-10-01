import Foundation

/// Plays a streamed reply out at an even pace with a soft fading edge, the way
/// Gemini reveals its answers: deltas arrive from the desktop in bursts, so the
/// text is shown character by character at a steady rate that speeds up to
/// catch up with a large burst, and every newly shown character fades in
/// instead of popping. Times are in seconds on any monotonic clock.
public struct StreamReveal: Equatable, Sendable {
	/// Characters per second when little is waiting.
	public static let minimumRate = 45.0
	/// Whatever is waiting is shown within about this long, so the reply never lags far behind.
	public static let catchUp = 0.45
	/// How long one character takes to fade in.
	public static let fade = 0.32

	/// Characters shown so far, fractional between frames.
	private var head: Double
	/// Characters before this index are fully opaque.
	private var settled: Int
	/// When each still-fading character appeared, starting at `settled`.
	private var stamps: [Double] = []
	private var now: Double

	/// Starts with `shown` characters already on screen, at `time`.
	public init(shown: Int, at time: Double) {
		head = Double(shown)
		settled = shown
		now = time
	}

	/// Characters to lay out.
	public var shown: Int { Int(head) }

	/// Whether frames are still needed to reach `target` characters and finish fading.
	public func animating(toward target: Int) -> Bool {
		shown != target || !stamps.isEmpty
	}

	/// Moves to `time`, revealing towards `target` characters.
	public mutating func advance(to time: Double, target: Int) {
		let from = now
		let step = max(0, time - from)
		now = max(now, time)
		if target < shown {
			// The text was replaced by a shorter one (a refetch); show it as it is.
			head = Double(target)
			settled = min(settled, target)
			stamps = Array(stamps.prefix(max(0, target - settled)))
		}
		let backlog = Double(target) - head
		if backlog > 0, step > 0 {
			let rate = max(Self.minimumRate, backlog / Self.catchUp)
			let next = min(Double(target), head + rate * step)
			// Each character crossed in this step appears at the moment the head passed it.
			for index in shown ..< Int(next) {
				stamps.append(from + max(0, Double(index + 1) - head) / rate)
			}
			head = next
		}
		while let first = stamps.first, now - first >= Self.fade {
			stamps.removeFirst()
			settled += 1
		}
	}

	/// Opacity of the character at `index`, eased so the edge reads as a soft gradient.
	public func opacity(at index: Int) -> Double {
		if index < settled { return 1 }
		guard index < shown, index - settled < stamps.count else { return 0 }
		let progress = min(1, max(0, (now - stamps[index - settled]) / Self.fade))
		return progress * progress * (3 - 2 * progress)
	}
}
