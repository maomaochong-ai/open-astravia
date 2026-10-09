import AVFoundation
import VettaKit

/// Reads replies aloud with the system voice: a whole answer when its button is
/// tapped, or a reply's sentences as they are written when auto-read is on.
@Observable
final class ReadAloud {
	static let shared = ReadAloud()
	static let autoReadKey = "vetta.autoRead"

	/// The turn being read, for its button.
	private(set) var turnId: String?

	@ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
	@ObservationIgnored private let delegate = Delegate()
	@ObservationIgnored private var queued: Set<ObjectIdentifier> = []
	/// Once a turn turns out Chinese it stays in that voice, so one reply does not switch speakers.
	@ObservationIgnored private var chinese = false
	/// The turn `chinese` belongs to, kept across the pauses of a reply still being written.
	@ObservationIgnored private var voiceTurn: String?

	private init() {
		synthesizer.delegate = delegate
		delegate.onFinish = { [weak self] in self?.finished($0) }
	}

	/// Reads a finished answer from the start, or stops if it is the one being read.
	func toggle(turnId: String, markdown: String) {
		if self.turnId == turnId { return stop() }
		stop()
		enqueue([SpeakableText.plain(markdown)], turnId: turnId)
	}

	/// Adds the next sentences of a reply being written; another turn's reading stops first.
	func enqueue(_ lines: [String], turnId: String) {
		let lines = lines.filter { !$0.isEmpty }
		guard !lines.isEmpty else { return }
		if self.turnId != turnId {
			stop()
			self.turnId = turnId
		}
		if voiceTurn != turnId {
			voiceTurn = turnId
			chinese = false
		}
		if queued.isEmpty { activate() }
		for line in lines {
			if line.contains(/\p{Han}/) { chinese = true }
			let utterance = AVSpeechUtterance(string: line)
			utterance.voice = AVSpeechSynthesisVoice(language: chinese ? Self.chineseVoice : "en-US")
			queued.insert(ObjectIdentifier(utterance))
			synthesizer.speak(utterance)
		}
	}

	func stop() {
		guard turnId != nil else { return }
		turnId = nil
		queued = []
		synthesizer.stopSpeaking(at: .immediate)
		deactivate()
	}

	/// Only this reading's own utterances count: one stopped earlier may still report in.
	private func finished(_ utterance: ObjectIdentifier) {
		guard queued.remove(utterance) != nil else { return }
		if queued.isEmpty {
			turnId = nil
			deactivate()
		}
	}

	/// Plays with the silent switch on and lowers other audio while speaking.
	private func activate() {
		let session = AVAudioSession.sharedInstance()
		try? session.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
		try? session.setActive(true)
	}

	private func deactivate() {
		try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
	}

	/// Taiwan and Hong Kong Chinese keep their own voice; any other reads Mandarin.
	private static var chineseVoice: String {
		let preferred = Locale.preferredLanguages.first { $0.hasPrefix("zh") } ?? ""
		if preferred.contains("Hant") || preferred.hasSuffix("TW") { return "zh-TW" }
		if preferred.hasSuffix("HK") { return "zh-HK" }
		return "zh-CN"
	}

	/// The synthesizer reports on its own queue; the count lives on the main actor.
	private nonisolated final class Delegate: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
		var onFinish: (@MainActor (ObjectIdentifier) -> Void)?

		func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
			let id = ObjectIdentifier(utterance)
			Task { @MainActor in self.onFinish?(id) }
		}
	}
}
