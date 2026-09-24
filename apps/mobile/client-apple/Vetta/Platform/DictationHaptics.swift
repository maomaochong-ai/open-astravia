import AudioToolbox
import CoreHaptics

/// The cue for dictation starting: iOS's own "Slide" text tone together with
/// the vibration iOS pairs with it. The sound is read from the system at run
/// time rather than shipped, and is skipped if a future iOS moves it; as a
/// system sound it stays quiet when the phone is on silent. The haptic engine
/// is warmed up when the finger lands so both fire the moment the hold registers.
final class DictationHaptics {
	private var engine: CHHapticEngine?
	private var pattern: CHHapticPattern?
	private static let tone: SystemSoundID? = {
		let url = URL(fileURLWithPath: "/System/Library/PrivateFrameworks/ToneLibrary.framework/AlertTones/EncoreInfinitum/Slide-EncoreInfinitum.caf")
		var id: SystemSoundID = 0
		guard FileManager.default.fileExists(atPath: url.path),
		      AudioServicesCreateSystemSoundID(url as CFURL, &id) == kAudioServicesNoError
		else { return nil }
		return id
	}()

	/// Starts the engine ahead of time; a cold start would lag behind the hold.
	func prepare() {
		guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
		if engine == nil {
			engine = try? CHHapticEngine()
			engine?.playsHapticsOnly = true
			engine?.isAutoShutdownEnabled = true
			pattern = try? Self.makePattern()
		}
		try? engine?.start()
	}

	func play() {
		if let tone = Self.tone { AudioServicesPlaySystemSound(tone) }
		prepare()
		guard let engine, let pattern, let player = try? engine.makePlayer(with: pattern) else { return }
		try? player.start(atTime: CHHapticTimeImmediate)
	}

	/// iOS's synchronized vibration for Slide: a light tick, a firm tap, then a
	/// hum that holds briefly and fades out.
	private static func makePattern() throws -> CHHapticPattern {
		func event(_ type: CHHapticEvent.EventType, at time: TimeInterval, intensity: Float, sharpness: Float, duration: TimeInterval = 0) -> CHHapticEvent {
			CHHapticEvent(
				eventType: type,
				parameters: [
					CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
					CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
				],
				relativeTime: time,
				duration: duration
			)
		}
		let humStart: TimeInterval = 0.172
		let fade = CHHapticParameterCurve(
			parameterID: .hapticIntensityControl,
			controlPoints: [
				.init(relativeTime: 0, value: 1),
				.init(relativeTime: 0.08, value: 1),
				.init(relativeTime: 0.32, value: 0),
			],
			relativeTime: humStart
		)
		return try CHHapticPattern(
			events: [
				event(.hapticTransient, at: 0, intensity: 0.5, sharpness: 0.8),
				event(.hapticTransient, at: 0.091, intensity: 1, sharpness: 0.5),
				event(.hapticContinuous, at: humStart, intensity: 1, sharpness: 0.3, duration: 0.32),
			],
			parameterCurves: [fade]
		)
	}
}
