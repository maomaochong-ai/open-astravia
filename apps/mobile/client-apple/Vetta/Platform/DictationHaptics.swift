import CoreHaptics

/// The feel of dictation starting: a firm knock, a faint echo just behind it,
/// and a low swell that fades out, so the phone seems to open up rather than
/// just tick. Warmed up when the finger lands so it fires the moment the hold
/// registers. Does nothing on hardware without haptics.
final class DictationHaptics {
	private var engine: CHHapticEngine?
	private var pattern: CHHapticPattern?

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
		prepare()
		guard let engine, let pattern, let player = try? engine.makePlayer(with: pattern) else { return }
		try? player.start(atTime: CHHapticTimeImmediate)
	}

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
		let swell: TimeInterval = 0.42
		let fade = CHHapticParameterCurve(
			parameterID: .hapticIntensityControl,
			controlPoints: [
				.init(relativeTime: 0, value: 0.2),
				.init(relativeTime: 0.08, value: 1),
				.init(relativeTime: swell, value: 0),
			],
			relativeTime: 0.02
		)
		return try CHHapticPattern(
			events: [
				event(.hapticTransient, at: 0, intensity: 1, sharpness: 0.55),
				event(.hapticTransient, at: 0.11, intensity: 0.35, sharpness: 0.3),
				event(.hapticContinuous, at: 0.02, intensity: 0.55, sharpness: 0.12, duration: swell),
			],
			parameterCurves: [fade]
		)
	}
}
