import AVFoundation
import Speech
import VettaKit

/// Hold-to-talk dictation for the composer: live transcript and input level
/// while the finger is down, the final text when it lifts. Recognition runs on
/// device when the language supports it.
@Observable
final class SpeechDictation {
	enum Failure: Equatable {
		case denied, unavailable
	}

	private(set) var listening = false
	private(set) var transcript = ""
	/// Input loudness, 0...1, for the glow.
	private(set) var level: Double = 0
	private(set) var failure: Failure?

	@ObservationIgnored private var engine: SpeechEngine?
	@ObservationIgnored private var heardFinal = false

	func start() async {
		transcript = ""
		level = 0
		failure = nil
		heardFinal = false
		listening = true
		#if DEBUG
		if let script = Self.uiTestScript {
			await playScript(script)
			return
		}
		#endif
		guard await SpeechEngine.authorize() else {
			failure = .denied
			listening = false
			return
		}
		let onText: @Sendable (String, Bool) -> Void = { [weak self] text, isFinal in
			Task { @MainActor in self?.receive(text, isFinal: isFinal) }
		}
		let onLevel: @Sendable (Double) -> Void = { [weak self] level in
			Task { @MainActor in self?.level = level }
		}
		do {
			// Activating the audio session blocks for a moment; off the main thread the glow keeps moving.
			let started = try await Task.detached { try SpeechEngine(onText: onText, onLevel: onLevel) }.value
			// Let go while it was starting: nothing to listen for any more.
			guard listening else { return started.cancel() }
			engine = started
		} catch {
			failure = .unavailable
			listening = false
		}
	}

	/// Stops listening and returns what was heard, waiting briefly for the final result.
	func stop() async -> String {
		guard listening else { return transcript }
		if let engine {
			engine.finish()
			for _ in 0 ..< 8 where !heardFinal {
				try? await Task.sleep(for: .milliseconds(100))
			}
			engine.cancel()
		}
		engine = nil
		listening = false
		level = 0
		return transcript
	}

	func cancel() {
		engine?.cancel()
		engine = nil
		listening = false
		level = 0
		transcript = ""
	}

	private func receive(_ text: String, isFinal: Bool) {
		transcript = text
		if isFinal { heardFinal = true }
	}

	#if DEBUG
	/// UI tests cannot speak; `-VettaUITestDictation <text>` plays that text back word by word.
	private static var uiTestScript: String? {
		let arguments = ProcessInfo.processInfo.arguments
		guard let index = arguments.firstIndex(of: "-VettaUITestDictation"), index + 1 < arguments.count else { return nil }
		return arguments[index + 1]
	}

	private func playScript(_ script: String) async {
		for end in script.indices.dropFirst() + [script.endIndex] {
			try? await Task.sleep(for: .milliseconds(60))
			guard listening else { return }
			transcript = String(script[..<end])
			level = Double.random(in: 0.3 ... 0.9)
		}
	}
	#endif
}

/// The audio side. Its callbacks run on audio and recognition threads, so it is
/// deliberately not main-actor isolated (a main-actor closure traps there).
private nonisolated final class SpeechEngine: @unchecked Sendable {
	private let audio = AVAudioEngine()
	private let request = SFSpeechAudioBufferRecognitionRequest()
	private var task: SFSpeechRecognitionTask?

	static func authorize() async -> Bool {
		let speech = await withCheckedContinuation { (continuation: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
			SFSpeechRecognizer.requestAuthorization { @Sendable status in continuation.resume(returning: status) }
		}
		guard speech == .authorized else { return false }
		return await AVAudioApplication.requestRecordPermission()
	}

	init(onText: @escaping @Sendable (String, Bool) -> Void, onLevel: @escaping @Sendable (Double) -> Void) throws {
		guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
			throw SpeechUnavailable()
		}
		let session = AVAudioSession.sharedInstance()
		try session.setCategory(.record, mode: .measurement, options: .duckOthers)
		// Recording otherwise mutes the start cue's sound and vibration before they finish.
		try session.setAllowHapticsAndSystemSoundsDuringRecording(true)
		try session.setActive(true, options: .notifyOthersOnDeactivation)
		request.shouldReportPartialResults = true
		if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
		let input = audio.inputNode
		let format = input.outputFormat(forBus: 0)
		let request = request
		input.installTap(onBus: 0, bufferSize: 1024, format: format) { @Sendable buffer, _ in
			request.append(buffer)
			onLevel(Self.loudness(buffer))
		}
		task = recognizer.recognitionTask(with: request) { @Sendable result, _ in
			guard let result else { return }
			onText(result.bestTranscription.formattedString, result.isFinal)
		}
		audio.prepare()
		try audio.start()
	}

	/// Stop feeding audio; the recognizer delivers its final result shortly after.
	func finish() {
		audio.stop()
		audio.inputNode.removeTap(onBus: 0)
		request.endAudio()
	}

	func cancel() {
		if audio.isRunning { finish() }
		task?.cancel()
		task = nil
		try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
	}

	private static func loudness(_ buffer: AVAudioPCMBuffer) -> Double {
		guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
		var sum: Float = 0
		for index in 0 ..< Int(buffer.frameLength) { sum += samples[index] * samples[index] }
		let rms = (sum / Float(buffer.frameLength)).squareRoot()
		// Speech sits around -40...-10 dBFS; map that range onto 0...1.
		let decibels = 20 * log10(max(rms, 0.000_01))
		return Double(min(1, max(0, (decibels + 50) / 40)))
	}
}

private struct SpeechUnavailable: Error {}
