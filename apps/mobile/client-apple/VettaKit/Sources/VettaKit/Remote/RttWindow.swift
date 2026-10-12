/// The last few measured round trips. Their median is what is shown, so one sample slowed
/// by a hiccup neither makes the figure jump nor hides a lasting change for long.
struct RttWindow {
	private let size: Int
	private var samples: [Double] = []

	init(size: Int = 5) {
		self.size = size
	}

	/// Adds a round trip and returns the median of the window.
	mutating func add(_ ms: Double) -> Double {
		samples.append(ms)
		if samples.count > size { samples.removeFirst() }
		let sorted = samples.sorted()
		return sorted[sorted.count / 2]
	}

	mutating func clear() {
		samples.removeAll()
	}
}
